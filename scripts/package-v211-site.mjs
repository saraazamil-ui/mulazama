/** Package only the verified synthetic app; never package the repository/content tree. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const profile = JSON.parse(await readFile(resolve(root, 'deployment/v211-private.json'), 'utf8'));
const source = resolve(root, 'dist-v211');
const manifest = JSON.parse(await readFile(resolve(source, 'preview-manifest.json'), 'utf8'));
if (manifest.hostedOrigin !== profile.origin || manifest.productionReady !== false || manifest.quranDisplay !== false || profile.audience !== 'owner-only') throw Error('HOSTED_PREVIEW_NOT_VERIFIED');
const assets = {};
for (const entry of manifest.files) {
  if (!/^(?:index\.html|v211\.html|assets\/[A-Za-z0-9_-]+\.(?:js|css))$/.test(entry.path)) throw Error('UNEXPECTED_HOSTED_ASSET');
  const bytes = await readFile(resolve(source, entry.path));
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error('HOSTED_ASSET_HASH_MISMATCH');
  const type = entry.path.endsWith('.js') ? 'text/javascript; charset=utf-8' : entry.path.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';
  assets['/' + entry.path] = { body: bytes.toString('utf8'), type };
}
assets['/'] = assets['/index.html'];
assets['/preview-manifest.json'] = { body: JSON.stringify(manifest), type: 'application/json; charset=utf-8' };
const worker = `// Private synthetic MULAZAMA V2.1.1. Authentication is enforced by Sites owner-only access.
// No database bindings, API endpoints, external requests, raw Quran, or source files.
const ORIGIN=${JSON.stringify(profile.origin)};
const ASSETS=${JSON.stringify(assets)};
export default { async fetch(request) {
 const headers = {
  'Cache-Control':'no-store', 'X-Robots-Tag':'noindex, nofollow',
  'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
 };
 const url = new URL(request.url);
 if(url.origin!==ORIGIN)return new Response('PRIVATE_PREVIEW_ONLY',{status:403,headers});
 if(!['GET','HEAD'].includes(request.method))return new Response('METHOD_NOT_ALLOWED',{status:405,headers});
 const asset=Object.hasOwn(ASSETS,url.pathname)?ASSETS[url.pathname]:null;
 if(!asset)return new Response('NOT_FOUND',{status:404,headers});
 headers['Content-Type']=asset.type;
 return new Response(request.method==='HEAD'?null:asset.body,{status:200,headers});
}};
`;
const output = resolve(root, 'dist-v211-hosted');
await mkdir(resolve(output, 'dist/server'), { recursive: true });
await mkdir(resolve(output, '.openai'), { recursive: true });
await writeFile(resolve(output, 'dist/server/index.js'), worker);
await writeFile(resolve(output, '.openai/hosting.json'), JSON.stringify({ project_id: profile.project_id }, null, 2) + '\n');
const module = await import('data:text/javascript;base64,' + Buffer.from(worker).toString('base64'));
for (const [path, asset] of Object.entries(assets)) {
  const response = await module.default.fetch(new Request(profile.origin + path));
  if (response.status !== 200 || await response.text() !== asset.body) throw Error('WORKER_RESPONSE_MISMATCH');
}
for (const path of ['/content/06l2/tanzil-uthmani-1.1.txt', '/src/testing/v211.tsx', '/.git/config', '/content/06l2/review.html', '/api/sync']) {
  if ((await module.default.fetch(new Request(profile.origin + path))).status !== 404) throw Error('WORKER_PATH_EXPOSED');
}
if ((await module.default.fetch(new Request('https://mulazama.com/'))).status !== 403) throw Error('OFFICIAL_ORIGIN_NOT_BLOCKED');
if ((await module.default.fetch(new Request(profile.origin, { method: 'POST' }))).status !== 405) throw Error('WORKER_WRITE_NOT_BLOCKED');
console.log(JSON.stringify({ output, origin: profile.origin, workerBytes: Buffer.byteLength(worker), productionReady: false, quranDisplay: false, databaseBindings: [], checkedPaths: Object.keys(assets).length + 7 }));
