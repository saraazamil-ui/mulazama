import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {computeReleaseSourceDigest} from './release-source-hash.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const result=await computeReleaseSourceDigest(root);
await writeFile(resolve(root,'src/release/build-context.generated.ts'),`// Generated from implementation, tests, assets, dependency lock and build policy; not an approval.\nexport const BUILD_SOURCE_DIGEST = '${result.sourceDigest}';\n`);
console.log(JSON.stringify({...result,approval:false}));
