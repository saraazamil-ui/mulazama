// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {computeReleaseSourceDigest} from '../../scripts/release-source-hash.mjs';
async function fixture(action){const root=await mkdtemp(join(tmpdir(),'mulazama-source-hash-'));try{for(const dir of ['src/release','scripts','public','e2e','e2e-offline','e2e-deployment','.github'])await mkdir(join(root,dir),{recursive:true});for(const file of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','vite.config.ts','tsconfig.json','index.html','playwright.config.ts','playwright.offline.config.ts','playwright.deployment.config.ts','src/runtime.ts','src/test.test.ts','public/font.fixture','scripts/build.mjs','e2e-deployment/update.spec.ts','playwright.deployment.config.ts'])await writeFile(join(root,file),'synthetic');await action(root);}finally{await rm(root,{recursive:true,force:true});}}
describe('release-source byte binding without circular signing',()=>{
 it('SH01 signed envelope and generated digest do not enter their own source digest',async()=>fixture(async root=>{const before=await computeReleaseSourceDigest(root);await writeFile(join(root,'src/release/release-input.json'),'synthetic-envelope');await writeFile(join(root,'src/release/build-context.generated.ts'),'generated');expect(await computeReleaseSourceDigest(root)).toEqual(before);}));
 it('SH02 runtime, test, asset, lock and build changes independently invalidate source evidence',async()=>fixture(async root=>{for(const file of ['src/runtime.ts','src/test.test.ts','public/font.fixture','pnpm-lock.yaml','scripts/build.mjs','e2e-deployment/update.spec.ts','playwright.deployment.config.ts']){const before=await computeReleaseSourceDigest(root);await writeFile(join(root,file),'changed');expect((await computeReleaseSourceDigest(root)).sourceDigest).not.toBe(before.sourceDigest);await writeFile(join(root,file),'synthetic');}}));
 it('SH03 order-independent enumeration is repeatable',async()=>fixture(async root=>{expect(await computeReleaseSourceDigest(root)).toEqual(await computeReleaseSourceDigest(root));}));
 it('SH04 unsigned symlink implementations are refused rather than omitted',async()=>fixture(async root=>{await symlink(join(root,'src/runtime.ts'),join(root,'src/alias.ts'));await expect(computeReleaseSourceDigest(root)).rejects.toThrow('symlinks');}));
});
