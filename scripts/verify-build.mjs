import {readFile,stat} from 'node:fs/promises';
const root=new URL('../dist/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('offline-assets.json',root),'utf8'));
for(const file of manifest.files)if(!(await stat(new URL(file,root))).isFile())throw Error('Missing offline asset '+file);
const index=await readFile(new URL('index.html',root),'utf8');
if(!index.includes('مُلازَمَة')||!index.includes('MULAZAMA')||!index.includes('dir="rtl"'))throw Error('Identity/RTL mismatch');
const scripts=manifest.files.filter(f=>f.endsWith('.js'));
for(const script of scripts){const text=await readFile(new URL(script,root),'utf8');if(['SYNTHETIC_TEST_ONLY','mintSyntheticLearningAccess','synthetic-reviewer','test-ephemeral-verifier'].some(marker=>text.includes(marker)))throw Error('Synthetic authorization leaked into production bundle');if(text.includes('itqan.prototype.v1')||text.includes('source:"mock"')||text.includes('نطاق عرض تجريبي من السورة'))throw Error('Prototype data leaked into production bundle');}
console.log(JSON.stringify({buildArtifacts:'passed',identity:'MULAZAMA',rtl:true,offlineAssets:manifest.files.length,prototypeStorageKeyPresent:false,offlineBrowserExecution:'not-verified'}));

const pwa=JSON.parse(await readFile(new URL('manifest.webmanifest',root),'utf8'));
for(const size of [192,512]) {
 const icon=pwa.icons?.find(i=>i.sizes===`${size}x${size}`&&i.type==='image/png');
 if(!icon)throw Error('Missing install icon '+size);
 const bytes=await readFile(new URL(icon.src,root));
 if(bytes.toString('hex',0,8)!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)!==size||bytes.readUInt32BE(20)!==size)throw Error('Invalid PNG dimensions '+size);
}
for(const page of ['privacy.html','terms.html','support.html']) {
 if(!manifest.files.includes(page))throw Error('Policy/support unavailable offline '+page);
 const html=await readFile(new URL(page,root),'utf8');
 if(!html.includes('dir="rtl"')||!html.includes('<main>'))throw Error('Policy/support structure invalid '+page);
}
console.log(JSON.stringify({pwaIcons:'192/512 PNG verified',localPolicyPages:3,deviceInstallTest:'not-executed'}));
