import { canonical, LEARNING_VERSIONS } from '../core/types';
import { BUILD_SOURCE_DIGEST } from './build-context.generated';
import releaseInput from './release-input.json';
import { createBlockedLearningAccess,createLearningReleaseAccess } from './access';
import type { LearningReleaseAccess } from './access';
import { sha256 } from './gates';
/** Release inputs are build artifacts reviewed with the code; never user preferences or imported backups. */
export async function createRuntimeLearningAccess():Promise<LearningReleaseAccess>{
  const mode=import.meta.env.MODE;
  if(!['test','staging','production'].includes(mode))return createBlockedLearningAccess();
  return createLearningReleaseAccess({product:'MULAZAMA',environment:mode as 'test'|'staging'|'production',purpose:mode==='test'?'engineering-test':mode==='staging'?'controlled-pilot':'production',platform:'web',sourceDigest:BUILD_SOURCE_DIGEST,versionsDigest:await sha256(canonical(LEARNING_VERSIONS)),contentManifestHash:releaseInput.contentManifestHash,unitCatalogHash:await sha256(canonical(releaseInput.unitCatalog))},releaseInput.bundle,releaseInput.unitCatalog);
}
export function runtimeDatabaseName():string {
  // Preserve the 05A production database identity. Staging/development/test never open it implicitly.
  return import.meta.env.MODE==='production'?'mulazama-learning-v1':`mulazama-${import.meta.env.MODE}-learning-v1`;
}
