/** Offline-reproducible verification of fresh official downloads. Fetch receipts
 * record acquisition separately; this command never treats an inherited hash as
 * an independent network fetch or a Sigstore provenance verification. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { verifyReferenceArtifact } from './fsrs-reference-loader.mjs';
const directory = 'docs/06e1/evidence/online-reference/';
const json = async name => JSON.parse(await readFile(directory + name, 'utf8'));
const hash = (value, kind = 'sha256', encoding = 'hex') => createHash(kind).update(value).digest(encoding);
const require = (value, reason) => { if (!value) throw Error(reason); };
const metadata = await json('registry.json'), keys = await json('registry-keys.json');
const archive = await readFile(directory + 'ts-fsrs-5.4.2.tgz');
require(metadata.name === 'ts-fsrs' && metadata.version === '5.4.2', 'REFERENCE_IDENTITY_MISMATCH');
require(metadata.dist.tarball === 'https://registry.npmjs.org/ts-fsrs/-/ts-fsrs-5.4.2.tgz', 'REFERENCE_URL_MISMATCH');
require(metadata.dist.integrity === 'sha512-' + hash(archive, 'sha512', 'base64'), 'REFERENCE_INTEGRITY_MISMATCH');
require(hash(archive) === hash(await readFile('references/ts-fsrs-5.4.2-verified/ts-fsrs-5.4.2.tgz')), 'PINNED_BYTES_DIFFER_FROM_OFFICIAL_DOWNLOAD');
const signatures = metadata.dist.signatures.map(signature => {
  const key = keys.keys.find(value => value.keyid === signature.keyid);
  require(key && key.scheme === 'ecdsa-sha2-nistp256', 'REGISTRY_KEY_UNSUPPORTED');
  require(key.expires === null || Date.parse(key.expires) > Date.now(), 'REGISTRY_KEY_EXPIRED');
  const publicKey = createPublicKey({ key: Buffer.from(key.key, 'base64'), format: 'der', type: 'spki' });
  const valid = verify('sha256', Buffer.from(`${metadata.name}@${metadata.version}:${metadata.dist.integrity}`), publicKey, Buffer.from(signature.sig, 'base64'));
  require(valid, 'REGISTRY_SIGNATURE_INVALID');
  return { keyId: key.keyid, expires: key.expires, algorithm: 'ECDSA-P256-SHA256', verified: valid };
});
require(signatures.length > 0, 'REGISTRY_SIGNATURE_MISSING');
const commit = await json('commit.json'), release = await json('release.json');
const pin = 'bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d';
require(commit.sha === pin && commit.html_url === `https://github.com/open-spaced-repetition/ts-fsrs/commit/${pin}`, 'SOURCE_COMMIT_MISMATCH');
require(release.tag_name === 'v5.4.2' && release.html_url === 'https://github.com/open-spaced-repetition/ts-fsrs/releases/tag/v5.4.2', 'RELEASE_TAG_MISMATCH');
const source = await readFile(directory + 'algorithm.ts', 'utf8');
const map = JSON.parse(await readFile('references/ts-fsrs-5.4.2-verified/package/dist/index.mjs.map', 'utf8'));
const index = map.sources.indexOf('../src/algorithm.ts');
require(index >= 0 && map.sourcesContent[index] === source, 'UPSTREAM_SOURCE_MAP_MISMATCH');
const artifact = await verifyReferenceArtifact('references/ts-fsrs-5.4.2-verified/package', 'references/ts-fsrs-5.4.2-verified/receipt.json');
const receipt = {
  checkedAt: new Date().toISOString(), status: 'verified-for-independent-core-comparison',
  sourceCommit: pin, reference: artifact.identity, artifactMatchesFreshOfficialDownload: true,
  registrySignatures: signatures, sourceMapAlgorithmMatchesOfficialCommit: true,
  githubReportsCommitSignatureVerified: commit.commit.verification.verified,
  githubReportedVerificationReason: commit.commit.verification.reason,
  evidenceSources: ['https://registry.npmjs.org/ts-fsrs/5.4.2', 'https://registry.npmjs.org/-/npm/v1/keys',
    release.html_url, commit.html_url, `https://github.com/open-spaced-repetition/ts-fsrs/blob/${pin}/packages/fsrs/src/algorithm.ts`],
  trustLimits: ['Registry public key trust relies on the separately fetched official HTTPS endpoint',
    'GitHub commit signature status is GitHub API evidence, not a local Git GPG verification',
    'npm registry signature verified locally; Sigstore certificate/transparency provenance NOT verified',
    'No production release attestation, scientific approval or migration election created'],
  sigstoreCryptographicProvenanceVerified: false, productionApproval: false,
};
await writeFile('docs/06e1/evidence/reference-verification.json', JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ status: receipt.status, officialArchiveMatches: true, registrySignatures: signatures,
  sourceMapMatches: true, pinnedFilesVerified: artifact.identity.filesVerified, sigstoreVerified: false }, null, 2));
