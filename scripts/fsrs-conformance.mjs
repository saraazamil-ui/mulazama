import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {loadTsFsrsReference} from './fsrs-reference-loader.mjs';

const require=createRequire(import.meta.url);
// Use Vite's already pinned compiler dependency; install/lockfiles are untouched.
const {build}=await import(createRequire(require.resolve('vite')).resolve('esbuild'));
const args=process.argv.slice(2),value=key=>{const i=args.indexOf(key);return i<0?null:args[i+1];};
const output=resolve(value('--output')??'docs/05b/evidence/fsrs-conformance.json');
const compiled=await build({stdin:{contents:"export * from './src/conformance/fsrs-conformance'; export { FSRS_WEIGHTS } from './src/core/fsrs'; export { roundedCandidateProbe } from './src/conformance/fsrs-rounded-probe';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {compareFsrsReference,FSRS_WEIGHTS,roundedCandidateProbe}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
let reference=null,referenceFailure=null;
try{reference=await loadTsFsrsReference(resolve(value('--reference')??'node_modules/ts-fsrs'),value('--receipt'),FSRS_WEIGHTS);}
catch(error){referenceFailure=error.code==='ENOENT'?'REFERENCE_ARTIFACT_UNAVAILABLE':error.code??'REFERENCE_RETRIEVAL_OR_VALIDATION_FAILED';}
const report=compareFsrsReference(reference,args.includes('--rounded-candidate')?roundedCandidateProbe:undefined);
if(args.includes('--rounded-candidate'))report.candidate={...report.candidate,algorithmVersion:'hme-fsrs6-ts542-round8-0.1.0',precision:'stage-rounded-8-decimal',runtimeSelected:false};
report.checkedAt=new Date().toISOString();
report.environment={node:process.version,platform:process.platform,arch:process.arch};
const hashes=[];for(const path of ['src/core/fsrs.ts','src/core/fsrs-rounded.ts','src/conformance/fsrs-rounded-probe.ts','scripts/fsrs-source-provenance.mjs','src/core/hme.ts','src/core/hme-types.ts','src/conformance/fsrs-suite.ts','src/conformance/fsrs-conformance.ts','scripts/fsrs-reference-loader.mjs','scripts/fsrs-reference-prepare.mjs','scripts/fsrs-conformance.mjs'])hashes.push({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')});
report.candidate.sourceFiles=hashes;
report.candidate.weightsSha256=createHash('sha256').update(JSON.stringify(FSRS_WEIGHTS)).digest('hex');
if(referenceFailure)report.blockers.push(referenceFailure);
report.referenceProvenance=reference?{receiptSha256:reference.receiptSha256,review:reference.provenanceReview}:null;
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,status:report.status,summary:report.summary,coverage:report.coverage,blockers:report.blockers},null,2));
// 2 = blocked, 1 = real comparison mismatch, 0 = arithmetic comparison passed.
// Exit 0 never grants production approval; release evidence has separate trust.
process.exitCode=report.status==='conformant'?0:report.status==='blocked'?2:1;
