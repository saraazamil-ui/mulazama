import type { ApprovedJourneyInput } from '../content/journey-material06l3';
/** Reviewed build input, included in sourceDigest. No URL, localStorage or backup can install it.
 * Set only after content/catalog/policy approval; null keeps all learner sessions closed. */
export const runtimeJourneyInput: ApprovedJourneyInput | null = null;
