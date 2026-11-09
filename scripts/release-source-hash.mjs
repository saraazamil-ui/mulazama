import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative,sep} from 'node:path';
const directories=['src','scripts','public','deployment','e2e','e2e-offline','e2e-deployment','e2e-journey','e2e-journey-offline','e2e-mushaf','e2e-reader-preview','.github'];
const configs=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','vite.config.ts','tsconfig.json','index.html','playwright.config.ts','playwright.offline.config.ts','playwright.deployment.config.ts','playwright.journey.config.ts','playwright.journey-offline.config.ts','playwright.mushaf.config.ts','playwright.reader-preview.config.ts','vite.engineering.config.ts','engineering.html','vite.reader-preview.config.ts','reader-preview.html'];
const excluded=new Set(['src/release/build-context.generated.ts','src/release/release-input.json']);
/** Signed envelopes are excluded to avoid a signature -> digest -> signature cycle.
 * Their content/catalog/report hashes are independently bound by the release policy. */
export async function computeReleaseSourceDigest(root){
 const paths=[];const rel=p=>relative(root,p).split(sep).join('/');
 async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=resolve(dir,e.name);if(e.isSymbolicLink())throw Error('Release input symlinks are unsupported: '+rel(p));if(e.isDirectory())await walk(p);else if(e.isFile()&&!excluded.has(rel(p)))paths.push(p);}}
 for(const dir of directories)await walk(resolve(root,dir));for(const file of configs)paths.push(resolve(root,file));paths.sort((a,b)=>rel(a)<rel(b)?-1:rel(a)>rel(b)?1:0);
 const hash=createHash('sha256');for(const p of paths)hash.update(rel(p)+'\0').update(await readFile(p)).update('\0');
 return {sourceDigest:hash.digest('hex'),files:paths.length,excluded:[...excluded]};
}
