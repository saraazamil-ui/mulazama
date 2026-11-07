/** Supplemental source audit, not a content installer or release authority. */
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { loadContentAudit } from "./content-audit-loader.mjs";

/** HTTP success alone is insufficient: the official site returned maintenance HTML with 200. */
export async function verifyPublisherPayload({
  bytes,
  status,
  contentType,
  sourceUrl,
  publisherHost,
  expectedSha256,
}) {
  const url = new URL(sourceUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hostname !== publisherHost
  )
    throw new Error("PUBLISHER_OR_TRANSPORT_MISMATCH");
  if (status !== 200) throw new Error("HTTP_STATUS_NOT_ACCEPTED");
  if (
    !(bytes instanceof Uint8Array) ||
    !bytes.length ||
    bytes.length > 32 * 1024 * 1024
  )
    throw new Error("SOURCE_SIZE_NOT_ACCEPTED");
  if (
    typeof expectedSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(expectedSha256)
  )
    throw new Error("PINNED_SOURCE_HASH_REQUIRED");
  const { decodeSourceUtf8, sourceSha256, parseIndexedAyahSource } =
    await loadContentAudit();
  const original = decodeSourceUtf8(bytes);
  if (
    /text\/html|application\/xhtml/i.test(contentType ?? "") ||
    /^\s*(?:\uFEFF)?\s*(?:<!doctype\s+html|<html\b)/i.test(original)
  )
    throw new Error("HTML_IS_NOT_QURAN_SOURCE");
  const hash = await sourceSha256(bytes);
  if (hash !== expectedSha256) throw new Error("SOURCE_HASH_MISMATCH");
  const parsed = parseIndexedAyahSource(original);
  if (parsed.issues.length) throw new Error("INDEXED_SOURCE_INVALID");
  return {
    sha256: hash,
    byteLength: bytes.length,
    recordCount: parsed.records.length,
    inputUnchanged: true,
    scientificApproval: false,
    productionActivation: false,
  };
}

export function unicodeInventory(records) {
  const counts = new Map(),
    textGroups = new Map();
  for (const record of records) {
    for (const char of record.text)
      counts.set(
        char.codePointAt(0),
        (counts.get(char.codePointAt(0)) ?? 0) + 1,
      );
    const keys = textGroups.get(record.text) ?? [];
    keys.push(`${record.surah}:${record.ayah}`);
    textGroups.set(record.text, keys);
  }
  return {
    codepoints: [...counts]
      .sort((a, b) => a[0] - b[0])
      .map(([cp, count]) => ({
        codepoint: "U+" + cp.toString(16).toUpperCase().padStart(4, "0"),
        count,
        category: /\p{M}/u.test(String.fromCodePoint(cp))
          ? "combining-mark"
          : cp === 0x640
            ? "tatweel"
            : cp >= 0x6d6 && cp <= 0x6ed
              ? "quranic-mark-range"
              : cp === 0x20
                ? "space"
                : "other",
      })),
    invisibleOrBidiCodepoints: [...counts.keys()].filter((cp) =>
      [
        0x061c, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c,
        0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff,
      ].includes(cp),
    ),
    repeatedTextGroups: [...textGroups.values()].filter(
      (keys) => keys.length > 1,
    ),
    note: "Repeated verse text is reported for review, not treated as duplicate identifiers. Mark inventory does not certify correct tashkeel or waqf semantics.",
  };
}

export async function runSupplementalAudit(
  root = process.cwd(),
  { writeOutputs = false } = {},
) {
  const base = resolve(root, "content/06l2"),
    out = resolve(root, "docs/06l2/evidence");
  const json = async (name) =>
    JSON.parse(await readFile(resolve(base, name), "utf8"));
  const receipt = await json("download-receipt.json"),
    request = await json("audit-request.json"),
    profile = await json("numbering-profile.json");
  const source = new Uint8Array(
    await readFile(resolve(base, request.primary.sourcePath)),
  );
  const {
    auditContentBytes,
    compareIndependentSources,
    sourceSha256,
    decodeSourceUtf8,
  } = await loadContentAudit();
  const acquisition = await verifyPublisherPayload({
    bytes: source,
    status: receipt.httpStatus,
    contentType: receipt.responseContentType,
    sourceUrl: receipt.sourceUrl,
    publisherHost: "tanzil.net",
    expectedSha256: receipt.sha256,
  });
  const metadataBytes = new Uint8Array(
      await readFile(resolve(base, "quran-data.xml")),
    ),
    metadata = decodeSourceUtf8(metadataBytes);
  if ((await sourceSha256(metadataBytes)) !== profile.provenance.documentSha256)
    throw Error("METADATA_HASH_MISMATCH");
  const section = /<suras\b[^>]*>([\s\S]*?)<\/suras>/.exec(metadata)?.[1];
  if (!section) throw Error("METADATA_SURAS_SECTION_MISSING");
  const declared = [
    ...section.matchAll(/<sura\s+index="([0-9]+)"\s+ayas="([0-9]+)"[^>]*\/>/g),
  ].map((match) => ({ index: Number(match[1]), ayas: Number(match[2]) }));
  if (
    declared.length !== 114 ||
    declared.some(
      (s, i) =>
        s.index !== i + 1 || s.ayas !== profile.expectedAyahsPerSurah[i],
    )
  )
    throw Error("NUMBERING_PROFILE_DIFFERS_FROM_PINNED_METADATA");
  const licenseBytes = new Uint8Array(
    await readFile(resolve(base, receipt.rightsFile)),
  );
  if ((await sourceSha256(licenseBytes)) !== receipt.rightsSHA256)
    throw Error("LICENSE_RECEIPT_HASH_MISMATCH");
  const audit = await auditContentBytes({
    bytes: source,
    profile,
    expectedSha256: receipt.sha256,
    provenance: request.primary.provenance,
  });
  const { sourceText, records, ...summary } = audit;
  // An index into the unchanged original is a review aid, never a new Quran text.
  const reviewIndex = {
    schemaVersion: 1,
    sourceFile: request.primary.sourcePath,
    sourceSha256: receipt.sha256,
    coordinateSystem:
      "UTF-16 code unit offsets into the fatal UTF-8 decoded original; end exclusive, not byte offsets",
    scientificApproval: false,
    records: records.map(({ surah, ayah, sourceStart, sourceEnd, line }) => ({
      surah,
      ayah,
      sourceStart,
      sourceEnd,
      line,
    })),
  };
  if (writeOutputs)
    await writeFile(
      resolve(base, "source-slice-index.json"),
      JSON.stringify(reviewIndex, null, 2) + "\n",
    );
  const report = {
    checkedAt: new Date().toISOString(),
    purpose: "supplemental source mechanical audit only",
    acquisition,
    primary: summary,
    metadataAgreement: {
      separatePublisherArtifact: true,
      independentPublisher: false,
      surahs: declared.length,
      ayas: declared.reduce((n, s) => n + s.ayas, 0),
    },
    perAyahSourceSlicesExact: records.every(
      (r) => sourceText.slice(r.sourceStart, r.sourceEnd) === r.text,
    ),
    inventory: unicodeInventory(records),
    independenceGuard: compareIndependentSources(audit, audit),
    independentComparison: {
      status: "blocked",
      reason:
        "No independently acquired compatible official edition. A second download or metadata from Tanzil is not independent.",
    },
    officialKfgqpcSourceAcquired: false,
    humanScientificApproval: "pending",
    fontApproval: "pending",
    productionActivation: false,
  };
  if (writeOutputs)
    await writeFile(
      resolve(out, "content-supplemental-audit.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  if (audit.structuralStatus !== "passed" || !report.perAyahSourceSlicesExact)
    throw Error("SOURCE_STRUCTURAL_CHECK_FAILED");
  return report;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const report = await runSupplementalAudit(process.cwd(), {
    writeOutputs: true,
  });
  console.log(
    JSON.stringify({
      structural: report.primary.structuralStatus,
      counts: report.primary.counts,
      exactSourceSlices: report.perAyahSourceSlicesExact,
      independentComparison: "blocked",
      humanApproval: "pending",
      productionActivation: false,
    }),
  );
  process.exitCode = 2; // Mechanical pass is never sufficient to close G01/G10.
}
