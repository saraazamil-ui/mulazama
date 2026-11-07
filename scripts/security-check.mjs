import { readFile,readdir } from 'node:fs/promises';
import { join } from 'node:path';
const paths=[];
async function scan(dir){for(const d of await readdir(dir,{withFileTypes:true})){const p=join(dir,d.name);if(d.isDirectory())await scan(p);else if(/\.(tsx?|html|mjs|json)$/.test(d.name)&&!d.name.includes('.test.'))paths.push(p);}}
await scan('src');paths.push('index.html');
const patterns=[['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['aws-access-key',/\bAKIA[0-9A-Z]{16}\b/],['openai-secret',/\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/]];
const findings=[];for(const p of paths){const source=await readFile(p,'utf8');for(const [kind,pattern]of patterns)if(pattern.test(source))findings.push({file:p,kind});}
for(const p of ['src/App.tsx','src/main.tsx','src/application/service.ts']){
 const source=await readFile(p,'utf8');
 if(/from\s+["'][^"']*(?:domain\/(?:mock|storage))["']/.test(source))findings.push({file:p,kind:'prototype-production-import'});
}
const report={kind:'bounded-static-security-check',scannedFiles:paths.length,findings,dependencyAudit:'not-run-by-this-command',penetrationTest:'not-performed'};
console.log(JSON.stringify(report,null,2));if(findings.length)process.exitCode=1;
