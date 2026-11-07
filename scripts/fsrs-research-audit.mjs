import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {build}=await import(createRequire(require.resolve('vite')).resolve('esbuild'));
const compiled=await build({stdin:{contents:"export * from './src/core/fsrs';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {FsrsAdapter,FSRS_PROVENANCE}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const fixturePath='src/core/fixtures/fsrs6-research-reference.json',fixtureBytes=await readFile(fixturePath),fixture=JSON.parse(fixtureBytes);
const adapter=new FsrsAdapter(),at=days=>new Date(Date.UTC(2026,0,1)+days*86400000).toISOString();
const seed=()=>({stability:5,difficulty:5,lastReviewAt:at(0),model:'FSRS-6',algorithmVersion:FSRS_PROVENANCE.algorithmVersion});
const comparisons=[];
const compare=(id,metric,expected,actual)=>comparisons.push({id,metric,expected,actual,delta:actual-expected,absoluteTolerance:1e-12,passed:Math.abs(actual-expected)<=1e-12});
for(const grade of [1,2,3,4]){
  const initial=adapter.review(null,grade,at(0)),sameDay=adapter.review(seed(),grade,at(0));
  compare(`HME-INIT-${grade}`,'stability',fixture.initialization_all_grades[grade].S,initial.state.stability);
  compare(`HME-INIT-${grade}`,'difficulty',fixture.initialization_all_grades[grade].D,initial.state.difficulty);
  compare(`HME-SAME-${grade}`,'stability',fixture.same_day_all_grades_from_S5_D5[grade].S,sameDay.state.stability);
  compare(`HME-SAME-${grade}`,'difficulty',fixture.same_day_all_grades_from_S5_D5[grade].D,sameDay.state.difficulty);
}
const day5=adapter.review(seed(),3,at(5)),day12=adapter.review(day5.state,1,at(12));
for(const [id,row,actual]of [['HME-DAY5',fixture.rows[0],day5],['HME-DAY12',fixture.rows[1],day12]]){
  compare(id,'stability',row.state_after.S,actual.state.stability);
  compare(id,'difficulty',row.state_after.D,actual.state.difficulty);
  compare(id,'retrievabilityBefore',row.R_before,actual.retrievabilityBefore);
}
compare('HME-DAY42','predictionOnly',fixture.rows[2].R_before,adapter.retrievability(day12.state,at(42)));
compare('HME-RETENTION','I95/I90',fixture.I95_to_I90_ratio,adapter.exactInterval(5,.95)/adapter.exactInterval(5,.9));
const passed=comparisons.filter(c=>c.passed).length;
const report={schemaVersion:1,kind:'fsrs-research-arithmetic-audit',checkedAt:new Date().toISOString(),
  model:FSRS_PROVENANCE.model,algorithmVersion:FSRS_PROVENANCE.algorithmVersion,
  source:{path:fixturePath,sha256:createHash('sha256').update(fixtureBytes).digest('hex'),origin:'HME §19 prior independently executed Python binary64 research calculator, not ts-fsrs'},
  status:passed===comparisons.length?'passed':'failed',libraryConformance:'not-established',
  environment:{node:process.version,platform:process.platform,arch:process.arch},
  summary:{passed,failed:comparisons.length-passed},comparisons};
await mkdir('docs/05b/evidence',{recursive:true});await writeFile('docs/05b/evidence/fsrs-research-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,summary:report.summary,libraryConformance:report.libraryConformance},null,2));
process.exitCode=report.status==='passed'?0:1;
