import { canonical, DomainError } from '../core/types';

export const RELEASE_POLICY = 'mulazama-release-policy-05b.1';
export const GATES = ['G01','G02','G03','G04','G05','G06','G07','G08','G09','G10'] as const;
export type GateId = typeof GATES[number];
export type RuntimeEnvironment = 'development'|'test'|'staging'|'production';
export interface ReleaseContext {
  product:'MULAZAMA'; environment:RuntimeEnvironment;
  purpose:'engineering-test'|'controlled-pilot'|'production'; platform:'web'|'ios'|'android';
  sourceDigest:string; versionsDigest:string; contentManifestHash:string|null; unitCatalogHash:string|null;
}
export interface GateReport {
  schemaVersion:1; gate:GateId; policyVersion:string; contextDigest:string;
  outcome:'passed'|'failed'|'blocked'; execution:'actual'|'synthetic'; checkedAt:string;
  checks:Record<string,{passed:number;failed:number;skipped:number}>;
  reference?:{name:string;version:string;sourceCommit:string;artifactDigest:string;executed:boolean};
  reviewer?:{id:string;role:string;decision:'approved'|'rejected';scope:string};
}
export interface GateAttestation {
  schemaVersion:1; gate:GateId; policyVersion:string; authorityId:string;
  contextDigest:string; reportHashes:string[]; issuedAt:string; expiresAt:string;
}
export interface SignedAttestation {payload:GateAttestation;signature:string;}
export interface ReleaseAuthority {id:string;gates:readonly GateId[];publicKey:JsonWebKey;}
export interface ReleaseBundle {attestations:SignedAttestation[];reports:Record<string,string>;}
export interface GateResult {gate:GateId;status:'passed'|'blocked';reasons:string[];expiresAt?:string;}
export const REQUIRED_CHECKS:Record<GateId,readonly string[]> = {
  G01:['raw-bytes','edition-and-counting','source-and-license','independent-comparison','text-and-display-review'],
  G02:['immutable-reference','first-learning','success','failure','early-late-long','rating-boundaries','deterministic-replay'],
  G03:['repetition-not-mastery','hints-and-source','connected-recall','due-date-separation','versioned-replay'],
  G04:['actual-database','restart','atomic-failure','deduplication','migration','synthetic-load'],
  G05:['authenticated-encryption','negative-files','actual-store-restore','atomic-rollback','no-duplicates'],
  G06:['actual-browser','onboarding-plan','learning-journey','resume','data-control'],
  G07:['build','launch','storage','offline','rtl','permissions'],
  G08:['automated','keyboard','zoom-contrast','recall-hidden-text','manual-review'],
  G09:['dependency-audit','secret-scan','permissions','key-and-data-review','restore-review'],
  G10:['scientific-policy-review','specialist-text-approval','human-protocol-approval'],
};
const DIGEST=/^[a-f0-9]{64}$/;
const encoder=new TextEncoder();
export async function sha256(value:string|Uint8Array):Promise<string> {
  const bytes=typeof value==='string'?encoder.encode(value):value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))).map(x=>x.toString(16).padStart(2,'0')).join('');
}
function plain(value:unknown):value is Record<string,unknown> {return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;}
function instant(value:unknown):number {if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))return NaN;const n=Date.parse(value);return Number.isFinite(n)&&new Date(n).toISOString()===value?n:NaN;}
export function validateContext(c:ReleaseContext):void {
  if(!plain(c)||Object.keys(c).sort().join(',')!=='contentManifestHash,environment,platform,product,purpose,sourceDigest,unitCatalogHash,versionsDigest'||c.product!=='MULAZAMA'||!['development','test','staging','production'].includes(c.environment)||!['engineering-test','controlled-pilot','production'].includes(c.purpose)||!['web','ios','android'].includes(c.platform)||![c.sourceDigest,c.versionsDigest].every(x=>DIGEST.test(x))||![c.contentManifestHash,c.unitCatalogHash].every(x=>x===null||DIGEST.test(x)))throw new DomainError('RELEASE_CONTEXT_INVALID','سياق الإصدار غير صالح.');
  if(c.purpose==='engineering-test'&&c.environment!=='test')throw new DomainError('RELEASE_CONTEXT_INVALID','الاختبار الصناعي محصور في بيئة الاختبار.');
  if(c.purpose==='production'&&c.environment!=='production')throw new DomainError('RELEASE_CONTEXT_INVALID','إصدار الإنتاج يحتاج بيئة الإنتاج.');
  if(c.purpose==='controlled-pilot'&&c.environment!=='staging')throw new DomainError('RELEASE_CONTEXT_INVALID','التجربة المضبوطة تحتاج بيئة مستقلة.');
}
function bytesFromBase64(text:string):Uint8Array {if(!/^[A-Za-z0-9+/]+={0,2}$/.test(text)||text.length>1024)throw new Error('signature');return Uint8Array.from(atob(text),x=>x.charCodeAt(0));}
/** Pure verifier. Callers cannot turn its results into an execution capability themselves. */
export async function evaluateRelease(context:ReleaseContext,bundle:ReleaseBundle,authorities:readonly ReleaseAuthority[],at=new Date().toISOString()):Promise<GateResult[]> {
  validateContext(context);const now=instant(at);if(!Number.isFinite(now))throw new DomainError('INVALID_INPUT','وقت التحقق غير صالح.');
  // Snapshot before the first await prevents caller mutation while hashes/signatures are checked.
  const ctx=structuredClone(context),input=structuredClone(bundle),trust=structuredClone(authorities);
  const contextDigest=await sha256(canonical(ctx));
  const output:GateResult[]=[];
  for(const gate of GATES){
    const fail=(reason:string)=>output.push({gate,status:'blocked',reasons:[reason]});
    try{
      const entries=input.attestations.filter(x=>x.payload.gate===gate);if(entries.length!==1){fail('MISSING_OR_DUPLICATE_ATTESTATION');continue;}
      const {payload:p,signature}=entries[0];
      if(!plain(p)||Object.keys(p).sort().join(',')!=='authorityId,contextDigest,expiresAt,gate,issuedAt,policyVersion,reportHashes,schemaVersion'||p.schemaVersion!==1||p.policyVersion!==RELEASE_POLICY||p.contextDigest!==contextDigest||!Array.isArray(p.reportHashes)||!p.reportHashes.length||p.reportHashes.length>20||new Set(p.reportHashes).size!==p.reportHashes.length||p.reportHashes.some(x=>!DIGEST.test(x))){fail('ATTESTATION_BINDING_INVALID');continue;}
      const issued=instant(p.issuedAt),expires=instant(p.expiresAt);
      if(!Number.isFinite(issued)||!Number.isFinite(expires)||issued>now||expires<=now||expires<=issued||expires-issued>90*86400000){fail('ATTESTATION_EXPIRED_OR_INVALID');continue;}
      const a=trust.find(x=>x.id===p.authorityId&&x.gates.includes(gate));if(!a){fail('UNTRUSTED_AUTHORITY');continue;}
      const key=await crypto.subtle.importKey('jwk',a.publicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
      if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,new Uint8Array(bytesFromBase64(signature)),encoder.encode(canonical(p)))){fail('INVALID_SIGNATURE');continue;}
      const checks=new Set<string>();let invalid=false;
      for(const hash of p.reportHashes){
        const raw=input.reports[hash];if(typeof raw!=='string'||raw.length>2_000_000||await sha256(raw)!==hash){invalid=true;break;}
        const r=JSON.parse(raw) as GateReport;const checked=instant(r.checkedAt);
        if(r.schemaVersion!==1||r.gate!==gate||r.policyVersion!==RELEASE_POLICY||r.contextDigest!==contextDigest||r.outcome!=='passed'||(r.execution!=='actual'&&!(ctx.environment==='test'&&ctx.purpose==='engineering-test'&&r.execution==='synthetic'))||!Number.isFinite(checked)||checked>issued||checked<issued-30*86400000||!plain(r.checks)){invalid=true;break;}
        for(const [name,c] of Object.entries(r.checks)){
          if(!plain(c)||Object.keys(c).sort().join(',')!=='failed,passed,skipped'||![c.passed,c.failed,c.skipped].every(x=>Number.isSafeInteger(x)&&x>=0)||c.passed<1||c.failed!==0||c.skipped!==0){invalid=true;break;}checks.add(name);
        }
        if(gate==='G02'&&(!r.reference?.executed||r.reference.name!=='ts-fsrs'||r.reference.version!=='5.4.2'||r.reference.sourceCommit!=='bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d'||!DIGEST.test(r.reference.artifactDigest))){invalid=true;break;}
        if((gate==='G01'||gate==='G10')&&(!r.reviewer||r.reviewer.decision!=='approved'||!r.reviewer.id||!r.reviewer.role||r.reviewer.scope!==contextDigest)){invalid=true;break;}
        if(gate==='G08'&&ctx.purpose==='production'&&!Object.hasOwn(r.checks,'screen-reader')){invalid=true;break;}
      }
      if(invalid||REQUIRED_CHECKS[gate].some(x=>!checks.has(x))||ctx.contentManifestHash===null||ctx.unitCatalogHash===null){fail('EVIDENCE_INCOMPLETE_OR_UNVERIFIED');continue;}
      output.push({gate,status:'passed',reasons:[],expiresAt:p.expiresAt});
    }catch{fail('MALFORMED_OR_UNVERIFIABLE_EVIDENCE');}
  }return output;
}
export const EMPTY_RELEASE_BUNDLE:ReleaseBundle=Object.freeze({attestations:[],reports:{}});
/** Populated only through a reviewed release-policy change; a user import cannot supply trust. */
export const TRUSTED_RELEASE_AUTHORITIES:readonly ReleaseAuthority[]=Object.freeze([]);
