/** Run from the L1 project root; --baseline points to the unchanged E1 extraction. */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
const root=process.cwd(), require=createRequire(resolve(root,'package.json'));
const {build}=await import(createRequire(require.resolve('vite')).resolve('esbuild'));
const base=process.argv[process.argv.indexOf('--baseline')+1];
if(!process.argv.includes('--baseline')||!base)throw Error('An extracted, hash-verified E1 baseline is required.');
async function compile(source){const r=await build({stdin:{contents:source,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,define:{'import.meta.env.MODE':'"test"'}});return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}`);}
const current=await compile("export {HistoryApplication} from './src/application/history-application';export {MemoryEventStore} from './src/persistence/event-store';export {canonical} from './src/core/types';");
const old=await compile(`export {replayProduct} from ${JSON.stringify(resolve(base,'src/application/service.ts'))};`);
const store=new current.MemoryEventStore(), owner=await current.HistoryApplication.open(store);
try {
 const before=await store.load();
 await owner.product.configureOnboarding({commandId:'synthetic-l1-e1-readback',config:{...owner.product.state.config,configured:true,persona:'returning',goal:'maintain'},ranges:[{id:'synthetic-declaration',kind:'surah',start:1,end:1,editionId:'prototype-unverified',status:'declared_unassessed'}]});
 const after=await store.load(), interpreted=old.replayProduct(after);
 const result={legacyE1ReaderAcceptsL1Setup:current.canonical(interpreted)===current.canonical(owner.product.state),originalEventsUnchanged:current.canonical(after.events.slice(0,before.events.length))===current.canonical(before.events),eventCount:after.events.length,declaredOnly:interpreted.ranges.every(r=>r.status==='declared_unassessed'),migrationExecuted:false,serviceRollbackExecuted:false};
 await writeFile('docs/06l1/evidence/backward-readback.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
 if(!result.legacyE1ReaderAcceptsL1Setup||!result.originalEventsUnchanged||!result.declaredOnly)throw Error('Readback regression');
} finally {owner.close();}
