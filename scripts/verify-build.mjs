import {readFile,stat} from 'node:fs/promises';
const root=new URL('../dist/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('offline-assets.json',root),'utf8'));
for(const file of manifest.files)if(!(await stat(new URL(file,root))).isFile())throw Error('Missing offline asset '+file);
const index=await readFile(new URL('index.html',root),'utf8');
if(!index.includes('مُلازَمَة')||!index.includes('MULAZAMA')||!index.includes('dir="rtl"'))throw Error('Identity/RTL mismatch');
const scripts=manifest.files.filter(f=>f.endsWith('.js'));
for(const script of scripts){const text=await readFile(new URL(script,root),'utf8');if(['SYNTHETIC_TEST_ONLY','mintSyntheticLearningAccess','synthetic-reviewer','test-ephemeral-verifier'].some(marker=>text.includes(marker)))throw Error('Synthetic authorization leaked into production bundle');if(text.includes('itqan.prototype.v1')||text.includes('source:"mock"')||text.includes('نطاق عرض تجريبي من السورة'))throw Error('Prototype data leaked into production bundle');}
console.log(JSON.stringify({buildArtifacts:'passed',identity:'MULAZAMA',rtl:true,offlineAssets:manifest.files.length,prototypeStorageKeyPresent:false,offlineBrowserExecution:'not-verified'}));
