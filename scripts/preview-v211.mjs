/** Build the synthetic journey; local serving stays loopback-only. Hosted packaging is explicit. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(root, 'dist-v211');
const hosted = process.argv.includes('--hosted');
const profile = hosted ? JSON.parse(await readFile(resolve(root, 'deployment/v211-private.json'), 'utf8')) : null;
if (profile && (new URL(profile.origin).origin !== profile.origin || !profile.origin.startsWith('https://') || !new URL(profile.origin).hostname.endsWith('.chatgpt.site') || profile.audience !== 'owner-only' || profile.syntheticOnly !== true || profile.productionReady !== false || profile.quranDisplay !== false)) throw Error('INVALID_PRIVATE_HOSTING_PROFILE');
const build = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.v211.config.ts', '--mode', 'test'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, V211_PRIVATE_SITE_ORIGIN: profile?.origin ?? '' },
});
if (build.status !== 0) process.exit(build.status ?? 1);
await writeFile(resolve(dist, 'index.html'), await readFile(resolve(dist, 'v211.html')));

const files = [];
async function collect(dir = dist, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name), name = prefix + entry.name;
    if (entry.isSymbolicLink()) throw Error('PREVIEW_SYMLINK_REJECTED');
    if (entry.isDirectory()) await collect(path, name + '/');
    else if (entry.isFile()) files.push(name);
  }
}
await collect();
files.sort();
if (files.some(name => !/\.(html|js|css)$/.test(name) || /(?:quran|tanzil|source-slice|review\.html)/i.test(name))) throw Error('UNEXPECTED_PREVIEW_ASSET');
const source = await readFile(resolve(root, 'content/06l2/tanzil-uthmani-1.1.txt'), 'utf8');
const verses = source.split(/\r?\n/).filter(line => /^\d+\|\d+\|/.test(line)).map(line => line.slice(line.indexOf('|', line.indexOf('|') + 1) + 1)).filter(text => text.length >= 32);
const entries = [];
for (const path of files) {
  const bytes = await readFile(resolve(dist, path));
  const text = bytes.toString('utf8');
  if (verses.some(verse => text.includes(verse))) throw Error('UNAPPROVED_CONTENT_IN_PREVIEW');
  entries.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const manifest = { kind: 'v211-private-synthetic-preview', productionReady: false, quranDisplay: false, storage: 'isolated-local-indexeddb', hostedOrigin: profile?.origin ?? null, files: entries };
await writeFile(resolve(dist, 'preview-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ kind: manifest.kind, assets: entries.length, quranDisplay: false, productionReady: false }));

if (process.argv.includes('--serve')) {
  const port = 4182;
  const allowed = new Set([...files, 'preview-manifest.json']);
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    if (!['127.0.0.1:' + port, 'localhost:' + port].includes(req.headers.host ?? '')) { res.writeHead(403); res.end('LOOPBACK_ONLY'); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end('METHOD_NOT_ALLOWED'); return; }
    try {
      const url = new URL(req.url, 'http://127.0.0.1:' + port);
      const path = decodeURIComponent(url.pathname).slice(1) || 'index.html';
      if (!allowed.has(path)) { res.writeHead(404); res.end('NOT_FOUND'); return; }
      const target = resolve(dist, path);
      if (!(await lstat(target)).isFile()) throw Error('ASSET_UNAVAILABLE');
      const bytes = await readFile(target);
      res.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
      res.writeHead(200); res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { res.writeHead(503); res.end('PREVIEW_UNAVAILABLE'); }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok); });
  console.log(JSON.stringify({ url: 'http://127.0.0.1:' + port, loopbackOnly: true, productionReady: false }));
  const close = () => server.close(() => process.exit(0));
  process.on('SIGINT', close); process.on('SIGTERM', close);
}
