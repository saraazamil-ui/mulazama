import { canonical, DomainError, LEARNING_VERSIONS } from '../core/types';
import type { CanonicalUnit } from '../application/learning';
import { BUILD_SOURCE_DIGEST } from './build-context.generated';
import { evaluateRelease, GATES, sha256, TRUSTED_RELEASE_AUTHORITIES, validateContext } from './gates';
import type { GateResult, ReleaseBundle, ReleaseContext } from './gates';
export interface LearningReleaseAccess {
  authorize(input:{operation:string;unit?:CanonicalUnit;at?:string}):Promise<void>;
  summary():GateResult[];
}
const capabilities=new WeakSet<object>();
const clone=<T>(v:T):T=>structuredClone(v);
function capability(results:GateResult[],units:CanonicalUnit[],testOnly=false):LearningReleaseAccess {
  const allowed=new Set(units.map(x=>canonical(x)));const frozen=clone(results);
  const access=Object.freeze({
    async authorize(input:{operation:string;unit?:CanonicalUnit;at?:string}):Promise<void>{
      const now=Date.now(); // Evidence expiry is wall-clock time, never a caller-supplied historical event time.
      if(frozen.some(g=>g.status!=='passed'||!g.expiresAt||Date.parse(g.expiresAt)<=now))throw new DomainError('RELEASE_GATES_BLOCKED','جلسات القرآن محجوبة: أدلة الاعتماد والتحقق غير مكتملة أو منتهية.');
      if(testOnly&&import.meta.env.MODE!=='test')throw new DomainError('RELEASE_GATES_BLOCKED','بيئة الاختبار الصناعي غير متاحة.');
      if(input.unit&&!allowed.has(canonical(input.unit)))throw new DomainError('CONTENT_UNAVAILABLE','تعريف الوحدة لا يطابق سجل الوحدات المعتمد.');
    },
    summary:()=>clone(frozen),
  });capabilities.add(access);return access;
}
export function requireLearningAccess(value:unknown):asserts value is LearningReleaseAccess {
  if(!value||typeof value!=='object'||!capabilities.has(value))throw new DomainError('RELEASE_GATES_BLOCKED','صلاحية تنفيذ غير موثقة.');
}
export function createBlockedLearningAccess():LearningReleaseAccess {return capability(GATES.map(gate=>({gate,status:'blocked',reasons:['NO_APPROVED_RELEASE_EVIDENCE']})),[]);}
/** The service checks a branded capability, not a Boolean or a caller-supplied predicate. */
export async function createLearningReleaseAccess(context:ReleaseContext,bundle:ReleaseBundle,unitCatalog:CanonicalUnit[]):Promise<LearningReleaseAccess>{
  const ctx=clone(context),catalog=clone(unitCatalog),input=clone(bundle);validateContext(ctx);
  if(ctx.environment!==import.meta.env.MODE)throw new DomainError('RELEASE_CONTEXT_INVALID','سياق الإصدار لا يطابق البناء.');
  if(ctx.sourceDigest!==BUILD_SOURCE_DIGEST)throw new DomainError('RELEASE_CONTEXT_INVALID','الشيفرة لا تطابق دليل الإصدار.');
  if(ctx.versionsDigest!==await sha256(canonical(LEARNING_VERSIONS))||ctx.unitCatalogHash!==await sha256(canonical(catalog)))throw new DomainError('RELEASE_CONTEXT_INVALID','إصدارات المحرك أو فهرس الوحدات لا يطابق الاعتماد.');
  // No local setting, imported backup or UI action can add an authority to this registry.
  return capability(await evaluateRelease(ctx,input,TRUSTED_RELEASE_AUTHORITIES),catalog);
}
/** Internal test seam. This path cannot mint a capability outside the Vitest build. */
export function mintSyntheticLearningAccess(units:CanonicalUnit[]):LearningReleaseAccess {
  if(import.meta.env.MODE!=='test')throw new DomainError('RELEASE_GATES_BLOCKED','لا يسمح باعتماد صناعي خارج الاختبارات.');
  const catalog=clone(units);
  if(catalog.some(x=>!/^(?:test|synthetic)[-:]/.test(x.editionId)||x.coverage.some(k=>!/^(?:test|synthetic)[-:]/.test(k))))throw new DomainError('CONTENT_UNAVAILABLE','الاختبارات تستخدم نطاقات صناعية معلنة فقط.');
  return capability(GATES.map(gate=>({gate,status:'passed',reasons:['SYNTHETIC_TEST_ONLY'],expiresAt:new Date(Date.now()+3600000).toISOString()})),catalog,true);
}
