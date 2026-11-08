import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const exec=promisify(execFile);
const source=new URL('../build-offline.mjs',import.meta.url);
async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'mulazama-shell10c-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'scripts'));
  await mkdir(join(root,'dist','assets'),{recursive:true});
  await copyFile(source,join(root,'scripts','build-offline.mjs'));
  await writeFile(join(root,'dist','index.html'),'<main>Artificial app shell only</main>');
  await writeFile(join(root,'dist','assets','app.js'),'/* artificial application */');
  await writeFile(join(root,'dist','404.html'),'<main>Artificial missing page</main>');
  return {
    root,
    run:()=>exec(process.execPath,[join(root,'scripts','build-offline.mjs')]),
    manifest:async()=>JSON.parse(await readFile(join(root,'dist','offline-assets.json'),'utf8')),
    worker:()=>readFile(join(root,'dist','sw.js'),'utf8'),
  };
}

test('preserves the exact app shell without including generated outputs or page assets',async t=>{
  const f=await fixture(t);
  await mkdir(join(f.root,'dist','mushaf','artificial-edition'),{recursive:true});
  await writeFile(join(f.root,'dist','mushaf','artificial-edition','001.png'),'synthetic raster placeholder, not Quran');
  await writeFile(join(f.root,'dist','sw.js'),'previous worker');
  await writeFile(join(f.root,'dist','offline-assets.json'),'previous manifest');
  const {stdout}=await f.run(),manifest=await f.manifest(),worker=await f.worker();
  assert.deepEqual(manifest.files,['404.html','assets/app.js','index.html']);
  assert.equal(JSON.parse(stdout).assetCount,3);
  const handlers={},cached=[];
  runInNewContext(worker,{
    URL,Response,
    self:{location:new URL('https://preview.example/sw.js'),addEventListener:(name,handler)=>{handlers[name]=handler;}},
    caches:{open:async()=>({addAll:async files=>cached.push(...files),match:async()=>new Response('artificial cached shell')})},
  });
  let installed;
  handlers.install({waitUntil:promise=>{installed=promise;}});
  await installed;
  assert.deepEqual(cached,manifest.files);
  let pageIntercepted=false;
  handlers.fetch({request:{method:'GET',url:'https://preview.example/mushaf/artificial-edition/001.png',mode:'cors'},respondWith:()=>{pageIntercepted=true;}});
  assert.equal(pageIntercepted,false);
  let applicationResponse;
  handlers.fetch({request:{method:'GET',url:'https://preview.example/assets/app.js',mode:'cors'},respondWith:promise=>{applicationResponse=promise;}});
  assert.equal(await (await applicationResponse).text(),'artificial cached shell');
});

test('never descends into or fingerprints mushaf files, including unreadable dangling links',async t=>{
  const f=await fixture(t);
  await f.run();
  const baseline=await f.manifest(),worker=await f.worker();
  await mkdir(join(f.root,'dist','mushaf','artificial-edition'),{recursive:true});
  const page=join(f.root,'dist','mushaf','artificial-edition','001.png');
  await writeFile(page,'first artificial bytes');
  await symlink(join(f.root,'nonexistent-target'),join(f.root,'dist','mushaf','unreadable.png'));
  await f.run();
  assert.deepEqual(await f.manifest(),baseline);
  assert.equal(await f.worker(),worker);
  await writeFile(page,'changed artificial page bytes');
  await f.run();
  assert.deepEqual(await f.manifest(),baseline);
  assert.equal(await f.worker(),worker);
});

test('still updates the shell version when an application asset changes',async t=>{
  const f=await fixture(t);
  await f.run();
  const initial=await f.manifest();
  await writeFile(join(f.root,'dist','assets','app.js'),'/* changed artificial application */');
  await f.run();
  const updated=await f.manifest();
  assert.notEqual(updated.version,initial.version);
  assert.deepEqual(updated.files,initial.files);
});

test('rejects symbolic links in shell assets instead of reading outside the artifact',async t=>{
  const f=await fixture(t);
  await writeFile(join(f.root,'outside.txt'),'artificial file outside dist');
  await symlink(join(f.root,'outside.txt'),join(f.root,'dist','assets','linked.js'));
  await assert.rejects(f.run(),error=>{
    assert.match(error.stderr,/Unsupported symbolic link in offline app shell: assets\/linked\.js/);
    return true;
  });
  await assert.rejects(f.manifest(),{code:'ENOENT'});
});
