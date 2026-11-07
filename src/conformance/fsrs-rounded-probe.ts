import {RoundedFsrsAdapter,ROUNDED_FSRS_VERSION} from '../core/fsrs-rounded';
import type {Probe} from './fsrs-conformance';
export const roundedCandidateProbe:Probe={run(input){
 const adapter=new RoundedFsrsAdapter(input.desiredRetention);
 let previous=input.initial===null?null:{...input.initial,model:'FSRS-6' as const,algorithmVersion:ROUNDED_FSRS_VERSION};
 return input.reviews.map(review=>{const x=adapter.review(previous,review.grade,review.at);previous=x.state;return {stability:x.state.stability,difficulty:x.state.difficulty,retrievabilityBefore:x.retrievabilityBefore,elapsedDays:x.elapsedDays,roundedIntervalDays:x.roundedIntervalDays,rawDueAt:x.rawDueAt};});
}};
