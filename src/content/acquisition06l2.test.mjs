// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  verifyPublisherPayload,
  unicodeInventory,
  runSupplementalAudit,
} from "../../scripts/content-06l2-audit.mjs";
const bytes = (s) => new TextEncoder().encode(s),
  hash = (b) => createHash("sha256").update(b).digest("hex");
const synthetic = bytes("1|1|SYNTHETIC_NOT_QURAN\n");
const input = (patch) => ({
  bytes: synthetic,
  status: 200,
  contentType: "text/plain",
  sourceUrl: "https://tanzil.net/test-fixture-only",
  publisherHost: "tanzil.net",
  expectedSha256: hash(synthetic),
  ...patch,
});
describe("06-L2 acquisition fails closed without changing source bytes", () => {
  it("accepts only the pinned indexed bytes without claiming approval", async () => {
    const before = synthetic.slice();
    const r = await verifyPublisherPayload(input());
    expect(r.recordCount).toBe(1);
    expect(r.scientificApproval).toBe(false);
    expect(r.productionActivation).toBe(false);
    expect(synthetic).toEqual(before);
  });
  it("rejects an actual HTTP200 official maintenance page", async () => {
    const html = new Uint8Array(
      await readFile("docs/06l2/evidence/content/publisher-page.html"),
    );
    await expect(
      verifyPublisherPayload(
        input({
          bytes: html,
          expectedSha256: hash(html),
          contentType: "text/html",
        }),
      ),
    ).rejects.toThrow("HTML_IS_NOT_QURAN_SOURCE");
  });
  it("detects HTML even with misleading plain MIME", async () => {
    const b = bytes("<!doctype html><html>Maintenance</html>");
    await expect(
      verifyPublisherPayload(input({ bytes: b, expectedSha256: hash(b) })),
    ).rejects.toThrow("HTML_IS_NOT_QURAN_SOURCE");
  });
  it("rejects an HTTP error with plausible body", async () => {
    await expect(
      verifyPublisherPayload(input({ status: 404 })),
    ).rejects.toThrow("HTTP_STATUS_NOT_ACCEPTED");
  });
  it("rejects a changed body despite valid syntax", async () => {
    await expect(
      verifyPublisherPayload(
        input({ bytes: bytes("1|1|CHANGED_SYNTHETIC\n") }),
      ),
    ).rejects.toThrow("SOURCE_HASH_MISMATCH");
  });
  it("rejects no pin", async () => {
    await expect(
      verifyPublisherPayload(input({ expectedSha256: null })),
    ).rejects.toThrow("PINNED_SOURCE_HASH_REQUIRED");
  });
  it("rejects a mirror host", async () => {
    await expect(
      verifyPublisherPayload(
        input({ sourceUrl: "https://mirror.invalid/file" }),
      ),
    ).rejects.toThrow("PUBLISHER_OR_TRANSPORT_MISMATCH");
  });
  it("rejects insecure transport", async () => {
    await expect(
      verifyPublisherPayload(input({ sourceUrl: "http://tanzil.net/file" })),
    ).rejects.toThrow("PUBLISHER_OR_TRANSPORT_MISMATCH");
  });
  it("rejects empty data", async () => {
    await expect(
      verifyPublisherPayload(input({ bytes: new Uint8Array() })),
    ).rejects.toThrow("SOURCE_SIZE_NOT_ACCEPTED");
  });
  it("rejects invalid UTF8, not repair it", async () => {
    const b = new Uint8Array([0xc0, 0xaf]);
    await expect(
      verifyPublisherPayload(input({ bytes: b, expectedSha256: hash(b) })),
    ).rejects.toThrow();
  });
  it("rejects hidden transport control characters", async () => {
    const b = bytes("1|1|BAD\u0000DATA\n");
    await expect(
      verifyPublisherPayload(input({ bytes: b, expectedSha256: hash(b) })),
    ).rejects.toThrow();
  });
  it("reports repeated text separately from identifiers and preserves codepoints", () => {
    const r = unicodeInventory([
      { surah: 1, ayah: 1, text: "A\u0651" },
      { surah: 1, ayah: 2, text: "A\u0651" },
    ]);
    expect(r.repeatedTextGroups).toEqual([["1:1", "1:2"]]);
    expect(r.codepoints).toContainEqual({
      codepoint: "U+0651",
      count: 2,
      category: "combining-mark",
    });
  });
  it("audits actual publisher bytes and rejects their use as an independent second source", async () => {
    const beforeReport = await readFile(
      "docs/06l2/evidence/content-supplemental-audit.json",
    );
    const beforeIndex = await readFile("content/06l2/source-slice-index.json");
    const r = await runSupplementalAudit();
    expect(r.primary.structuralStatus).toBe("passed");
    expect(r.primary.counts).toEqual({ surahs: 114, ayahs: 6236 });
    expect(r.perAyahSourceSlicesExact).toBe(true);
    expect(r.independenceGuard.blockers).toContain(
      "REFERENCE_IS_NOT_INDEPENDENT",
    );
    expect(r.productionActivation).toBe(false);
    expect(
      await readFile("docs/06l2/evidence/content-supplemental-audit.json"),
    ).toEqual(beforeReport);
    expect(await readFile("content/06l2/source-slice-index.json")).toEqual(
      beforeIndex,
    );
  });
});
