import type { Rating } from '../core/hme-types';

/** Inputs only. None of these inputs is an upstream golden output. */
export const REQUIRED_FSRS_BRANCHES = Object.freeze([
  'initialization', 'same-day', 'successful-review', 'lapse', 'early-review',
  'overdue-review', 'long-interval', 'state-boundaries', 'decimal-inputs',
  'repeatability', 'historical-replay', 'retention-target',
] as const);
export type FsrsBranch = typeof REQUIRED_FSRS_BRANCHES[number];
export interface MemorySeed { stability:number; difficulty:number; lastReviewAt:string }
export interface ConformanceCase {
  id:string;
  branch:FsrsBranch;
  initial:MemorySeed|null;
  reviews:readonly {grade:Rating;at:string}[];
  desiredRetention:number;
}
const at=(days:number)=>new Date(Date.UTC(2026,0,1)+days*86400000).toISOString();
const seed=(stability=5,difficulty=5):MemorySeed=>({stability,difficulty,lastReviewAt:at(0)});
const one=(id:string,branch:FsrsBranch,days:number,grade:Rating=3,initial:MemorySeed|null=seed(),desiredRetention=.9):ConformanceCase=>({id,branch,initial,reviews:[{grade,at:at(days)}],desiredRetention});
export const FSRS_CONFORMANCE_CASES:readonly ConformanceCase[]=Object.freeze([
  ...([1,2,3,4] as const).map(g=>one(`FSRS-G-INIT-${g}`,'initialization',0,g,null)),
  ...([1,2,3,4] as const).map(g=>one(`FSRS-G-SAME-${g}`,'same-day',0,g)),
  ...([2,3,4] as const).map(g=>one(`FSRS-G-SUCCESS-${g}`,'successful-review',5,g)),
  one('FSRS-G-LAPSE','lapse',5,1),
  one('FSRS-G-EARLY','early-review',1),
  one('FSRS-G-OVERDUE','overdue-review',60),
  one('FSRS-G-LONG','long-interval',36500,3,seed(100,8)),
  one('FSRS-G-BOUND-LOW','state-boundaries',1,1,seed(.001,1)),
  one('FSRS-G-BOUND-HIGH','state-boundaries',36500,4,seed(36500,10)),
  one('FSRS-G-DECIMAL','decimal-inputs',2.75,2,seed(5.123456789,4.876543219)),
  one('FSRS-G-FLOOR-BEFORE','decimal-inputs',.999999,3),
  one('FSRS-G-FLOOR-AT','decimal-inputs',1,3),
  one('FSRS-G-REPEAT','repeatability',5,3),
  {id:'FSRS-G-REPLAY',branch:'historical-replay',initial:seed(),reviews:[{grade:3,at:at(5)},{grade:1,at:at(12)},{grade:3,at:at(42)}],desiredRetention:.9},
  one('FSRS-G-RETENTION','retention-target',5,3,seed(),.95),
]);
