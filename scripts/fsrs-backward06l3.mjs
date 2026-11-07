/** Run the unmodified L2 portable-backup reader against synthetic L3 streams.
 * This uses a disposable extraction; it never opens IndexedDB or learner files. */
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const args=process.argv.slice(2),option=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
const fullBaseline=option('--baseline'),fixture=resolve('references/06l2-backup-reader');
const baseline=fullBaseline?resolve(fullBaseline):join(fixture,'source.zip');
const pinnedReceiptSHA256='73af3c02dd575b7a7bbcdb8d1fe3da0f35c5f61c0595dfb3622cf060752e197a';
const receiptBytes=await readFile(join(fixture,'receipt.json'));
assert.equal(createHash('sha256').update(receiptBytes).digest('hex'),pinnedReceiptSHA256);
const receipt=JSON.parse(receiptBytes);
const output=resolve(option('--output')??'docs/06l3/evidence/fsrs-backward-reader.json');
const expected='eae1213dae28f6eaa3ede0207602c6e046c6c19b8817364a16692b3e3208a1cf';
assert.equal(receipt.sourceDeliverySHA256,expected);
const baselineSHA256=createHash('sha256').update(await readFile(baseline)).digest('hex');
assert.equal(baselineSHA256,fullBaseline?expected:receipt.sourceZipSHA256);
const scratch=await mkdtemp(join(tmpdir(),'mulazama-l3-old-reader-'));
const require=createRequire(import.meta.url),{build}=await import(createRequire(require.resolve('vite')).resolve('esbuild'));
const load=async entry=>{
  const result=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,define:{'import.meta.env.MODE':'"test"'}});
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
};
try {
  const extractor=`import sys,zipfile,json,hashlib,pathlib,stat
raw=pathlib.Path(sys.argv[3]).read_bytes();assert hashlib.sha256(raw).hexdigest()==sys.argv[5];m=json.loads(raw)
entries=m['files'];paths=[e['path'] for e in entries];assert len(paths)==len(set(paths))
with zipfile.ZipFile(sys.argv[1]) as z:
 prefix=m['sourceArchiveRoot'] if sys.argv[4]=='full' else ''
 if not prefix:assert sorted(z.namelist())==sorted(paths)
 for e in entries:
  path=pathlib.PurePosixPath(e['path']);assert e['path'].startswith(('src/core/','src/persistence/')) and not path.is_absolute() and '..' not in path.parts
  info=z.getinfo(prefix+e['path']);assert not stat.S_ISLNK(info.external_attr>>16)
  b=z.read(info);assert len(b)==e['bytes'] and hashlib.sha256(b).hexdigest()==e['sha256']
  p=pathlib.Path(sys.argv[2])/e['path'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
print(len(entries))`;
  const extracted=Number(execFileSync('python3',['-c',extractor,baseline,scratch,join(fixture,'receipt.json'),fullBaseline?'full':'subset',pinnedReceiptSHA256],{encoding:'utf8'}));
  const old=await load(`export * from ${JSON.stringify(join(scratch,'src/persistence/backup.ts'))};`);
  const current=await load("export * from './src/persistence/backup'; export {MemoryEventStore} from './src/persistence/event-store'; export {CompositeApplication} from './src/application/composite-application'; export * from './src/testing/fsrs-integration06l2'; export {createSyntheticLearningAccess} from './src/testing/learning-access';");
  const access=await current.createSyntheticLearningAccess([current.fsrsUnit06l2]),password='synthetic-old-reader-06l3';
  const streams=[];
  for(const scheduling of ['legacy','reference-06e1']) {
    const store=new current.MemoryEventStore(),app=await current.CompositeApplication.open(store,{access,scheduling});
    await app.learning.send({type:'UnitRegistered',unit:current.fsrsUnit06l2},{at:current.offset06l2(current.baseTime06l2,-10000)});
    await current.recordFsrsAttempt06l2({app,store,access},current.rubricScenarios06l2[2]);
    streams.push({scheduling,snapshot:await store.load(),store,app});
  }
  const legacy=streams[0],corrected=streams[1],before=JSON.stringify(corrected.snapshot);
  assert.doesNotThrow(()=>old.validateBackupSnapshot(legacy.snapshot));
  assert.throws(()=>old.validateBackupSnapshot(corrected.snapshot),error=>error.code==='UNSUPPORTED_VERSION');
  const legacyExport=await old.exportEncryptedBackup(legacy.snapshot,password);
  const modernRead=await current.inspectEncryptedBackup(legacyExport,password);assert.deepEqual(modernRead.snapshot,legacy.snapshot);
  const correctedExport=await current.exportEncryptedBackup(corrected.snapshot,password);
  await assert.rejects(()=>old.inspectEncryptedBackup(correctedExport,password),error=>error.code==='UNSUPPORTED_VERSION');
  const reread=await current.inspectEncryptedBackup(correctedExport,password);assert.deepEqual(reread.snapshot,corrected.snapshot);
  assert.equal(JSON.stringify(await corrected.store.load()),before);
  const report={checkedAt:new Date().toISOString(),baselineSHA256:expected,baselineReader:'unmodified src/persistence/backup.ts from verified L2 ZIP',baselineAcquisition:{mode:fullBaseline?'full-delivery-archive':'portable-source-subset',archiveSHA256:baselineSHA256,receiptSHA256:pinnedReceiptSHA256,sourceDeliverySHA256:expected},baselineFilesExtractedAndVerified:extracted,syntheticDataOnly:true,actualIndexedDbUsed:false,
    checks:{legacySnapshotAcceptedByL2:true,correctedSnapshotRejectedByL2:'UNSUPPORTED_VERSION',oldEncryptedBackupAcceptedByL3:true,correctedEncryptedBackupRejectedByL2:'UNSUPPORTED_VERSION',correctedEncryptedBackupAcceptedByL3:true,rawSourceUnchanged:true},
    result:'passed',checksPassed:6,checksFailed:0,checksSkipped:0,productionMigrationPerformed:false,
    rollbackRule:'An L2 code downgrade cannot read a newly elected reference stream. Retain legacy streams unchanged; an isolated reference QA rollback requires its pre-change backup and matching reader. No production election or data downgrade authorized.'};
  for(const stream of streams)stream.app.close();
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await rm(scratch,{recursive:true,force:true});}
