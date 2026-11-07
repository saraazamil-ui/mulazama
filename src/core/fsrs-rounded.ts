import {FSRS_WEIGHTS, type FsrsState, type FsrsReview} from './fsrs';
import type {Rating} from './hme-types';
/** Versioned candidate. Not selected by HME until migration/release approval. */
export const ROUNDED_FSRS_VERSION='hme-fsrs6-ts542-round8-0.1.0';
const round=(x:number)=>Math.round(x*1e8)/1e8;
const clamp=(x:number,a:number,b:number)=>Math.min(Math.max(x,a),b);
export class RoundedFsrsAdapter {
 constructor(readonly desiredRetention=.9){if(!Number.isFinite(desiredRetention)||desiredRetention<=0||desiredRetention>=1)throw Error('INVALID_INPUT: retention');}
 curve(t:number,s:number){return round(Math.pow(1+this.factor()*t/s,-FSRS_WEIGHTS[20]));}
 private factor(){return round(Math.exp(-Math.log(.9)/FSRS_WEIGHTS[20])-1);}
 review(previous:FsrsState|null,grade:Rating,at:string):FsrsReview{
  const now=Date.parse(at),w=FSRS_WEIGHTS;
  if(!Number.isFinite(now)||!Number.isInteger(grade)||grade<1||grade>4)throw Error('INVALID_INPUT: review');
  const initialDifficulty=(g:number)=>round(w[4]-Math.exp(w[5]*(g-1))+1);
  let s:number,d:number,t=0,r:number|null=null;
  if(previous===null){s=clamp(w[grade-1],.001,100);d=clamp(initialDifficulty(grade),1,10);}
  else{
   if(previous.algorithmVersion!==ROUNDED_FSRS_VERSION||previous.model!=='FSRS-6')throw Error('UNSUPPORTED_VERSION: explicit migration required');
   const os=previous.stability,od=previous.difficulty,last=Date.parse(previous.lastReviewAt);
   if(!Number.isFinite(os)||os<.001||os>36500||!Number.isFinite(od)||od<1||od>10||!Number.isFinite(last)||now<last)throw Error('INVALID_INPUT: state/time');
   t=Math.floor((now-last)/86400000);r=this.curve(t,os);
   const damp=round(-w[6]*(grade-3)*(10-od)/9);
   d=clamp(round(w[7]*initialDifficulty(4)+(1-w[7])*(od+damp)),1,10);
   if(t===0){let m=Math.pow(os,-w[19])*Math.exp(w[17]*(grade-3+w[18]));if(grade>=2)m=Math.max(1,m);s=round(clamp(os*m,.001,36500));}
   else if(grade===1){const failed=round(clamp(w[11]*Math.pow(od,-w[12])*(Math.pow(os+1,w[13])-1)*Math.exp(w[14]*(1-r)),.001,36500));s=clamp(round(os/Math.exp(w[17]*w[18])),.001,failed);}
   else{s=round(clamp(os*(1+Math.exp(w[8])*(11-od)*Math.pow(os,-w[9])*(Math.exp(w[10]*(1-r))-1)*(grade===2?w[15]:1)*(grade===4?w[16]:1)),.001,36500));}
  }
  const modifier=round((Math.pow(this.desiredRetention,-1/w[20])-1)/this.factor());
  const exactIntervalDays=s*modifier,roundedIntervalDays=clamp(Math.round(exactIntervalDays),1,36500);
  return {state:{stability:s,difficulty:d,lastReviewAt:at,model:'FSRS-6',algorithmVersion:ROUNDED_FSRS_VERSION},rawDueAt:new Date(now+roundedIntervalDays*86400000).toISOString(),exactIntervalDays,roundedIntervalDays,retrievabilityBefore:r,elapsedDays:t,desiredRetention:this.desiredRetention,configurationVersion:'ts-fsrs542-fixed-weights-round8;r='+this.desiredRetention};
 }
}
