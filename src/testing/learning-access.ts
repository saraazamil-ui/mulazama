import type { CanonicalUnit } from '../application/learning';
import { mintSyntheticLearningAccess } from '../release/access';
/** No Quran bytes or real user evidence: only units declared with test- identifiers. */
export async function createSyntheticLearningAccess(units:CanonicalUnit[]){return mintSyntheticLearningAccess(units);}
