import { DomainError } from '../core/types';
import type { CanonicalUnit, LearningCommand } from './learning';

const fail=(message:string):never=>{throw new DomainError('INVALID_INPUT',message);};
export function learningId(value:unknown):asserts value is string {
 if(typeof value!=='string'||!value.trim()||value.length>200||['__proto__','constructor','prototype'].includes(value))fail('معرف تعلم غير صالح.');
}
function object(value:unknown,required:string[],optional:string[]=[]):asserts value is Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('يلزم كائن بيانات بسيط.');
 const keys=Object.keys(value as object);
 if(required.some(k=>!keys.includes(k))||keys.some(k=>!required.includes(k)&&!optional.includes(k)))fail('حقول العقد مفقودة أو غير مدعومة.');
}
function bool(v:unknown){if(typeof v!=='boolean')fail('يلزم إقرار منطقي صريح.');}
function finite(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail('قيمة عددية غير صالحة.');}
function integer(v:unknown,min=0){finite(v,min);if(!Number.isSafeInteger(v))fail('يلزم عدد صحيح.');}
function enumeration(v:unknown,values:string[]){if(typeof v!=='string'||!values.includes(v))fail('قيمة عقد غير مدعومة.');}
function uniqueIds(v:unknown){if(!Array.isArray(v)||!v.length)fail('نطاق تغطية مفقود.');(v as unknown[]).forEach(learningId);if(new Set(v as unknown[]).size!==(v as unknown[]).length)fail('نطاق تغطية مكرر.');}

export function validateCanonicalUnit(value:unknown):asserts value is CanonicalUnit {
 object(value,['id','editionId','probeProfileVersionId','words','coverage'],['probeType']);
 learningId(value.id);learningId(value.editionId);learningId(value.probeProfileVersionId);integer(value.words,1);uniqueIds(value.coverage);
 if(value.probeType!==undefined)enumeration(value.probeType,['chunk','connected','random_start','link']);
}
function observation(v:unknown){
 object(v,['attemptedWords','errors','completion','effort','gapVerified']);
 if(v.attemptedWords!==null)integer(v.attemptedWords);if(v.errors!==null)integer(v.errors);
 enumeration(v.completion,['complete','partial','unknown']);enumeration(v.effort,['hard','normal','easy','unknown']);bool(v.gapVerified);
}
/** Runtime schema; TypeScript alone cannot validate restored or external JSON. */
export function validateLearningCommand(value:unknown):asserts value is LearningCommand {
 if(!value||typeof value!=='object'||Array.isArray(value))fail('أمر تعلم غير صالح.');
 const c=value as Record<string,unknown>;
 switch(c.type){
 case 'UnitRegistered':object(c,['type','unit']);validateCanonicalUnit(c.unit);break;
 case 'SessionStarted':object(c,['type','unitId','sessionId']);learningId(c.unitId);learningId(c.sessionId);break;
 case 'ExposureCompleted':case 'RepetitionCompleted':object(c,['type','sessionId','mode']);learningId(c.sessionId);enumeration(c.mode,['reading','listening','assisted_recall','unassisted_training']);break;
 case 'RecallAttemptStarted':case 'RecallAttemptRestarted':object(c,['type','sessionId','attemptId'],['testOpportunityId','evidenceClusterId']);learningId(c.sessionId);learningId(c.attemptId);if(c.testOpportunityId!==undefined)learningId(c.testOpportunityId);if(c.evidenceClusterId!==undefined)learningId(c.evidenceClusterId);break;
 case 'HintUsed':object(c,['type','sessionId','reveal']);learningId(c.sessionId);bool(c.reveal);break;
 case 'RecallAttemptCompleted':object(c,['type','sessionId','termination']);learningId(c.sessionId);enumeration(c.termination,['completed','memory_failure','user_stop','technical_failure']);break;
 case 'AssessmentSubmitted':object(c,['type','attemptId','observation']);learningId(c.attemptId);observation(c.observation);break;
 case 'AssessmentCorrected':object(c,['type','attemptId','expectedAssessmentRevision','reason','observation']);learningId(c.attemptId);integer(c.expectedAssessmentRevision,1);if(typeof c.reason!=='string'||!c.reason.trim()||c.reason.length>2000)fail('سبب تصحيح غير صالح.');observation(c.observation);break;
 case 'SessionPaused':case 'SessionResumed':case 'SessionEnded':object(c,['type','sessionId']);learningId(c.sessionId);break;
 case 'ProductMistakeDraftRecorded':object(c,['type','attemptId','mistakeType','location','certainty']);if(c.attemptId!==null)learningId(c.attemptId);enumeration(c.mistakeType,['word','link','confusion','unknown']);enumeration(c.certainty,['observed','suspected','disputed']);if(c.location!==null&&(typeof c.location!=='string'||c.location.length>2000))fail('موضع بلاغ غير صالح.');break;
 case 'PlanRecomputed':
  object(c,['type','minutes','spentMinutes','candidates','futureLoadFeasible']);finite(c.minutes,0,1440);finite(c.spentMinutes,0,1440);bool(c.futureLoadFeasible);
  if(!Array.isArray(c.candidates))fail('مرشحو الخطة غير صالحين.');
  for(const v of c.candidates as unknown[]){object(v,['id','unitId','kind','costMinutes','priority'],['protected','coverageKeys','rawModelDueAt','policyDueAt','originalDueAt','title','reasonCode']);learningId(v.id);learningId(v.unitId);enumeration(v.kind,['repair','early_review','maintenance','review','link','new','diagnostic','recovery']);finite(v.costMinutes,Number.MIN_VALUE,1440);finite(v.priority);if(v.protected!==undefined)bool(v.protected);if(v.coverageKeys!==undefined)uniqueIds(v.coverageKeys);for(const key of ['rawModelDueAt','policyDueAt','originalDueAt'])if(v[key]!==undefined&&v[key]!==null&&typeof v[key]!=='string')fail('تاريخ استحقاق غير صالح.');for(const key of ['title','reasonCode'])if(v[key]!==undefined&&typeof v[key]!=='string')fail('نص مرشح غير صالح.');}
  break;
 case 'RecoveryStarted':object(c,['type','absenceDays','seed','minutes']);finite(c.absenceDays);integer(c.seed);finite(c.minutes,0,1440);break;
 default:fail('نوع أمر تعلم غير مدعوم.');
 }
}
