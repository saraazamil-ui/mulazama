import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadContentAudit } from './content-audit-loader.mjs';

const args = process.argv.slice(2);
function option(name) { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; }
const inputPath = option('--input'), destinationPath = option('--destination'), receiptPath = option('--receipt');
if (!inputPath || !destinationPath || !receiptPath || args.length !== 6) {
  console.error('Usage: node scripts/import-quran-candidate.mjs --input <publisher-file> --receipt <download-receipt.json> --destination <new-quarantine-directory>'); process.exit(64);
}
const { decodeSourceUtf8, sourceSha256 } = await loadContentAudit();
const info = await stat(resolve(inputPath));
if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error('Candidate must be a regular text file of at most 32 MiB.');
const bytes = new Uint8Array(await readFile(resolve(inputPath))); decodeSourceUtf8(bytes);
const receipt = JSON.parse(await readFile(resolve(receiptPath), 'utf8'));
if (receipt.schemaVersion !== 1 || typeof receipt.publisher !== 'string' || !receipt.publisher.trim() || typeof receipt.version !== 'string' || !receipt.version.trim() ||
    typeof receipt.downloadedAt !== 'string' || !Number.isFinite(Date.parse(receipt.downloadedAt))) throw new Error('A complete publisher download receipt is required.');
const url = new URL(receipt.sourceUrl);
if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Receipt source must identify the HTTPS publisher endpoint.');
const hash = await sourceSha256(bytes), destination = resolve(destinationPath);
// A newly created directory avoids overwriting a previously reviewed source.
await mkdir(destination, { recursive: false });
let completed = false;
try {
  await writeFile(resolve(destination, 'publisher-source.bin'), bytes, { flag: 'wx' });
  const actual = new Uint8Array(await readFile(resolve(destination, 'publisher-source.bin')));
  if (actual.length !== bytes.length || actual.some((v, i) => v !== bytes[i])) throw new Error('Quarantine copy does not match source bytes.');
  await writeFile(resolve(destination, 'download-receipt.json'), JSON.stringify({ ...receipt, byteLength: bytes.length, sha256: hash,
    importStatus: 'quarantined-not-approved', productionActivation: 'unavailable' }, null, 2) + '\n', { flag: 'wx' });
  completed = true; console.log(JSON.stringify({ sha256: hash, byteLength: bytes.length, status: 'quarantined-not-approved' }));
} finally { if (!completed) await rm(destination, { recursive: true, force: true }); }
