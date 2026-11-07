import { ContentGate, contentHash, type ContentPackage, type ContentApproval } from './content-gate';
import { canonical, DomainError } from '../core/types';
import type { CanonicalUnit } from '../application/learning';
export interface JourneySpan { surah:number; ayah:number; fromToken:number; toTokenExclusive:number }
export interface JourneyUnit { unit:CanonicalUnit; title:string; passages:string[]; positions:{surah:number;ayah:number;page:number;juz:number}[]; order:number; costMinutes:number }
export interface JourneyPolicy { version:string; futureLoadFeasible:boolean }
export interface JourneyMaterial { readonly kind:'approved'|'engineering'; readonly units:readonly JourneyUnit[]; readonly policy:JourneyPolicy }
export interface ApprovedJourneyInput { pkg:ContentPackage; approval:ContentApproval; entries:{unit:CanonicalUnit;spans:JourneySpan[];costMinutes:number}[]; policy:JourneyPolicy }
const materials=new WeakSet<object>();
function material(kind:JourneyMaterial['kind'],units:JourneyUnit[],policy:JourneyPolicy):JourneyMaterial {
  if(!policy.version.trim()||typeof policy.futureLoadFeasible!=='boolean'||!units.length)throw new DomainError('CONTENT_UNAVAILABLE','فهرس الجلسات أو سياسة الوقت غير متاح.');
  const seen=new Set<string>();
  for(const entry of units){if(seen.has(entry.unit.id)||!Number.isFinite(entry.costMinutes)||entry.costMinutes<=0||entry.passages.length===0||entry.positions.length===0)throw new DomainError('CONTENT_INTEGRITY_FAILURE','بيانات وحدة الجلسة غير صالحة.');seen.add(entry.unit.id);}
  const captured=structuredClone({kind,units,policy});
  const value=Object.freeze({kind,get units(){return structuredClone(captured.units);},get policy(){return structuredClone(captured.policy);}});materials.add(value);return value;
}
export function requireJourneyMaterial(value:unknown):asserts value is JourneyMaterial {if(!value||typeof value!=='object'||!materials.has(value))throw new DomainError('CONTENT_UNAVAILABLE','مصدر نص الجلسة غير موثق.');}
/** Only exact source slices from an independently signed ContentGate package enter learner UI. */
export async function createApprovedJourneyMaterial(input:ApprovedJourneyInput,expectedManifestHash:string):Promise<JourneyMaterial> {
  const {pkg,approval,entries,policy}=structuredClone(input);const gate=new ContentGate();await gate.activate(pkg,approval);
  if(await contentHash(canonical(pkg.manifest))!==expectedManifestHash)throw new DomainError('CONTENT_INTEGRITY_FAILURE','اعتماد الإصدار لا يطابق حزمة النص.');
  const units=entries.map(({unit,spans,costMinutes},order)=>{
    if(unit.editionId!==pkg.manifest.editionId||!spans.length)throw new DomainError('REFERENCE_MISMATCH','الوحدة لا تطابق طبعة النص.');
    const tokens=spans.flatMap(span=>gate.resolve({editionId:unit.editionId,...span}));
    const keys=tokens.map(t=>`${unit.editionId}:${t.surah}:${t.ayah}:${t.tokenIndex}`);
    if(tokens.length!==unit.words||new Set(keys).size!==keys.length||canonical(keys)!==canonical(unit.coverage))throw new DomainError('CONTENT_INTEGRITY_FAILURE','حدود الوحدة وعدد كلماتها لا يطابقان الخريطة المعتمدة.');
    const passages=spans.map(span=>{const resolved=gate.resolve({editionId:unit.editionId,...span});return pkg.text.slice(resolved[0].sourceStart,resolved.at(-1)!.sourceEnd);});
    return {unit,title:`سورة ${spans[0].surah} — آية ${spans[0].ayah}`,passages,positions:tokens.map(({surah,ayah,page,juz})=>({surah,ayah,page,juz})),order,costMinutes};
  });return material('approved',units,policy);
}
/** Tree-shaken from the production entry. Never accepts real Quran identifiers or arbitrary Quran text. */
export function createEngineeringJourneyMaterial(units:CanonicalUnit[]):JourneyMaterial {
  if(import.meta.env.MODE!=='test'||units.some(u=>!u.editionId.startsWith('test-')||u.coverage.some(k=>!k.startsWith('test-'))))throw new DomainError('RELEASE_GATES_BLOCKED','المواد الصناعية محصورة في الاختبار المعزول.');
  return material('engineering',units.map((unit,order)=>({unit,title:`وحدة تدريب صناعية ${order+1}`,passages:['مادة تدريب صناعية للاختبار فقط وليست نصًا قرآنيًا.'],positions:[{surah:1,ayah:order+1,page:1,juz:1}],order,costMinutes:2})),{version:'test-isolated-capacity-fixture-06l3',futureLoadFeasible:true});
}
