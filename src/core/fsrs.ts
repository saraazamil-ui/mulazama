import { instant } from './hme';
import type { Rating } from './hme-types';
/** HME §12/§19 binary64 research baseline. NOT a vendored or conformance-approved ts-fsrs library. */
export const FSRS_WEIGHTS = Object.freeze([0.212,1.2931,2.3065,8.2956,6.4133,0.8334,3.0194,0.001,1.8722,0.1666,0.796,1.4835,0.0614,0.2629,1.6483,0.6014,1.8729,0.5425,0.0912,0.0658,0.1542]);
export const FSRS_PROVENANCE = Object.freeze({
  model:'FSRS-6' as const, implementation:'hme-research-binary64-0.1.0',
  algorithmVersion:'hme-fsrs6-research-binary64-0.1.0', parametersVersion:'HME-0.1-section12-21weights',
  libraryName:'ts-fsrs', requestedLibraryVersion:'5.4.2', installedLibraryVersion:null,
  libraryConformance:'blocked' as const, approvedForProduction:false,
  timePolicy:'floor-elapsed-seconds-divided-by-86400-0.1.0', enableShortTerm:true, enableFuzz:false,
  precision:'IEEE754-binary64-without-intermediate-rounding', bounds:{stabilityMin:0.001,stabilityMax:36500,difficultyMin:1,difficultyMax:10},
  boundsStatus:'research guards from HME §19; released-library bound parity unverified',
  source:'https://open-spaced-repetition.github.io/ts-fsrs/guide/model/fsrs-6',
  blockReason:'Registry DNS and immutable package source retrieval unavailable in execution environment; arithmetic tests do not establish library conformance.',
});
export interface FsrsState {stability:number;difficulty:number;lastReviewAt:string;model:'FSRS-6';algorithmVersion:string;}
export interface FsrsReview {state:FsrsState;rawDueAt:string;exactIntervalDays:number;roundedIntervalDays:number;retrievabilityBefore:number|null;elapsedDays:number;desiredRetention:number;configurationVersion:string;}
const DAY=86400000;
const clamp=(v:number,lo:number,hi:number)=>{if(!Number.isFinite(v))throw new Error('INVALID_INPUT: non-finite model state');return Math.min(hi,Math.max(lo,v));};
export class FsrsAdapter {
  readonly provenance=FSRS_PROVENANCE;
  readonly weights:readonly number[];
  readonly desiredRetention:number;
  constructor(options:{weights?:readonly number[];desiredRetention?:number}={}) {
    const weights=options.weights??FSRS_WEIGHTS;
    if(weights.length!==21||weights.some(x=>!Number.isFinite(x))||weights[20]<=0)throw new Error('INVALID_INPUT: FSRS6 requires 21 valid weights');
    // Different weights require a new fully identified model; silent tuning is prohibited in this baseline.
    if(weights.some((x,i)=>x!==FSRS_WEIGHTS[i]))throw new Error('UNSUPPORTED_VERSION: weight changes require registered algorithm version');
    this.weights=Object.freeze([...weights]);this.desiredRetention=options.desiredRetention??0.9;
    this.validateRetention(this.desiredRetention);
  }
  private validateRetention(r:number){if(!Number.isFinite(r)||r<=0||r>=1)throw new Error('INVALID_INPUT: retention in (0,1) required');}
  private check(state:FsrsState){if(state.model!=='FSRS-6'||state.algorithmVersion!==this.provenance.algorithmVersion)throw new Error('UNSUPPORTED_VERSION: FSRS state version');if(!Number.isFinite(state.stability)||state.stability<0.001||state.stability>36500||!Number.isFinite(state.difficulty)||state.difficulty<1||state.difficulty>10)throw new Error('INVALID_INPUT: FSRS6 state');instant(state.lastReviewAt);}
  private factor(){return Math.expm1(-Math.log(0.9)/this.weights[20]);}
  curve(elapsedDays:number,stability:number):number {
    if(!Number.isFinite(elapsedDays)||elapsedDays<0||!Number.isFinite(stability)||stability<=0)throw new Error('INVALID_INPUT: curve inputs');
    return Math.exp(-this.weights[20]*Math.log1p(this.factor()*elapsedDays/stability));
  }
  exactInterval(stability:number,target=this.desiredRetention):number {
    this.validateRetention(target);
    if(!Number.isFinite(stability)||stability<=0)throw new Error('INVALID_INPUT: stability');
    const result=stability*Math.expm1(-Math.log(target)/this.weights[20])/this.factor();
    if(!Number.isFinite(result))throw new Error('INVALID_INPUT: non-finite interval');
    return result;
  }
  interval(state:FsrsState,target=this.desiredRetention):number {this.check(state);return this.exactInterval(state.stability,target);}
  retrievability(state:FsrsState,at:string):number {
    this.check(state);const delta=instant(at)-instant(state.lastReviewAt);
    if(delta<0)throw new Error('CLOCK_UNCERTAIN: negative elapsed time');
    return this.curve(Math.floor(delta/DAY),state.stability);
  }
  review(previous:FsrsState|null,grade:Rating,at:string):FsrsReview {
    const now=instant(at);const w=this.weights;
    if(!Number.isSafeInteger(grade)||grade<1||grade>4)throw new Error('INVALID_INPUT: FSRS rating');
    const d0=(g:number)=>w[4]-Math.exp(w[5]*(g-1))+1;
    let s:number,d:number,elapsedDays=0,retrievabilityBefore:number|null=null;
    if(previous===null){s=clamp(w[grade-1],0.001,36500);d=clamp(d0(grade),1,10);}
    else {
      this.check(previous);const seconds=(now-instant(previous.lastReviewAt))/1000;
      if(seconds<0)throw new Error('CLOCK_UNCERTAIN: negative elapsed time');
      elapsedDays=Math.floor(seconds/86400);
      const oldS=previous.stability,oldD=previous.difficulty;
      const r=this.curve(elapsedDays,oldS);retrievabilityBefore=r;
      const dStar=oldD-w[6]*(grade-3)*(10-oldD)/9;
      d=clamp(w[7]*d0(4)+(1-w[7])*dStar,1,10);
      if(elapsedDays===0){let m=Math.pow(oldS,-w[19])*Math.exp(w[17]*(grade-3+w[18]));if(grade>=2)m=Math.max(1,m);s=oldS*m;}
      else if(grade===1){const lapse=w[11]*Math.pow(oldD,-w[12])*Math.expm1(w[13]*Math.log1p(oldS))*Math.exp(w[14]*(1-r));s=Math.min(lapse,oldS*Math.exp(-w[17]*w[18]));}
      else {const h=grade===2?w[15]:1,e=grade===4?w[16]:1;s=oldS*(1+Math.exp(w[8])*(11-oldD)*Math.pow(oldS,-w[9])*Math.expm1(w[10]*(1-r))*h*e);}
      s=clamp(s,0.001,36500);
    }
    const state:FsrsState={stability:s,difficulty:d,lastReviewAt:at,model:'FSRS-6',algorithmVersion:this.provenance.algorithmVersion};
    const exactIntervalDays=this.exactInterval(s);
    const roundedIntervalDays=Math.max(1,Math.min(36500,Math.round(exactIntervalDays)));
    return {state,rawDueAt:new Date(now+roundedIntervalDays*DAY).toISOString(),exactIntervalDays,roundedIntervalDays,retrievabilityBefore,elapsedDays,desiredRetention:this.desiredRetention,configurationVersion:`${this.provenance.parametersVersion};r=${this.desiredRetention}`};
  }
}
export const fsrsAdapter=new FsrsAdapter();
