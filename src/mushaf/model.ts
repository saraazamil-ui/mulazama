import { canonical, DomainError } from '../core/types';
import { ContentGate, contentHash, TRUSTED_CONTENT_AUTHORITIES } from '../content/content-gate';
import type { ContentApproval, ContentAuthority, ContentPackage } from '../content/content-gate';

export interface MushafVerse { surah:number; ayah:number; juz:number; startPage:number; endPage:number; tokenKeys:string[] }
export interface MushafSurah { number:number; name:string; ayahCount:number; startPage:number }
export interface MushafJuzStart { number:number; page:number; surah:number; ayah:number }
export interface MushafPage { number:number; juz:number; asset:{path:string; mimeType:'image/png'|'image/jpeg'|'image/webp'; sha256:string; bytes:number; width:number; height:number} }
export interface MushafSource { name:string; url:string; attribution:string; licenseNotice:string }
export interface MushafSourceFile { url:string; version:string; archiveSha256:string; publisherSha256:string|null; downloadedAt:string; licenseUrl:string; licenseNotice:string; attribution:string }
export interface MushafManifest {
  schemaVersion:1; editionId:string; layoutId:string; version:string; contentManifestHash:string;
  source:MushafSource; sourceFiles:MushafSourceFile[]; surahs:MushafSurah[]; pages:MushafPage[]; verses:MushafVerse[];
}
export interface MushafPageApproval { authorityId:string; reviewer:string; reviewedAt:string; manifestHash:string; reviewed:('pages'|'verse-map'|'license'|'source')[]; signature:string }
export interface ApprovedMushafInput { pkg:ContentPackage; contentApproval:ContentApproval; manifest:MushafManifest; pageApproval:MushafPageApproval }
export interface VerifiedMushaf {
  readonly kind:'approved'|'engineering'; readonly editionId:string; readonly layoutId:string; readonly version:string; readonly contentManifestHash:string;
  readonly source:MushafSource; readonly surahs:readonly MushafSurah[]; readonly pages:readonly MushafPage[]; readonly verses:readonly MushafVerse[]; readonly juzStarts:readonly MushafJuzStart[];
  pageImage(page:number,signal?:AbortSignal):Promise<Blob>;
}
const approvedObjects=new WeakSet<object>(), hashPattern=/^[a-f0-9]{64}$/;
const maxPageBytes=12*1024*1024, cachePages=3;
const sourceHosts=new Set(['qurancomplex.gov.sa','dm.qurancomplex.gov.sa']);
const requiredReviews=['pages','verse-map','license','source'] as const;
const fail=(message:string):never=>{throw new DomainError('CONTENT_INTEGRITY_FAILURE',message);};
const nonempty=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;
const integer=(value:unknown,min=1,max=Number.MAX_SAFE_INTEGER):value is number=>Number.isSafeInteger(value)&&(value as number)>=min&&(value as number)<=max;
export function isOfficialMushafUrl(value:string):boolean {try{const url=new URL(value);return url.protocol==='https:'&&sourceHosts.has(url.hostname)&&!url.username&&!url.password&&!url.port;}catch{return false;}}
function assetPath(value:string):boolean {return /^\/mushaf\/[a-zA-Z0-9_/-]+\.(png|jpg|jpeg|webp)$/.test(value)&&!value.includes('//')&&!value.split('/').some(part=>part==='..'||part==='.');}
export function requireVerifiedMushaf(value:unknown):asserts value is VerifiedMushaf {if(!value||typeof value!=='object'||!approvedObjects.has(value))throw new DomainError('CONTENT_UNAVAILABLE','المصحف المعتمد غير متاح.');}
function sourceJuzStarts(pkg:ContentPackage):MushafJuzStart[]{
  const starts:MushafJuzStart[]=[];let previous=0;
  for(const token of pkg.tokens)if(token.juz!==previous){
    if(token.juz!==previous+1)fail('ترتيب حدود الأجزاء في المصدر غير صالح.');
    starts.push({number:token.juz,page:token.page,surah:token.surah,ayah:token.ayah});previous=token.juz;
  }
  if(starts.length!==pkg.manifest.totals.juz)fail('حدود الأجزاء غير مكتملة.');
  return starts;
}
function deepFreeze<T>(value:T):T {
  if(value&&typeof value==='object'){for(const child of Object.values(value))deepFreeze(child);Object.freeze(value);}return value;
}

/** Candidate inspection is not approval and never returns a reader capability. */
export async function verifyMushafCandidate(pkg:ContentPackage,manifest:MushafManifest):Promise<{manifestHash:string;pageCount:number;verseCount:number}> {
  await new ContentGate().verifyCandidate(pkg);
  sourceJuzStarts(pkg);
  const m=manifest, contentManifestHash=await contentHash(canonical(pkg.manifest));
  if(!m||m.schemaVersion!==1||m.editionId!==pkg.manifest.editionId||m.layoutId!==pkg.manifest.layoutId||!nonempty(m.version)||m.contentManifestHash!==contentManifestHash)
    fail('طبعة الصفحات أو تخطيطها لا يطابق حزمة النص.');
  if(!isOfficialMushafUrl(pkg.manifest.source.url)||!m.source||!isOfficialMushafUrl(m.source.url)||![m.source.name,m.source.attribution,m.source.licenseNotice].every(nonempty)||!Array.isArray(m.sourceFiles)||m.sourceFiles.length<1)
    fail('مصدر الصفحات الرسمي أو شروطه غير مكتملة.');
  for(const file of m.sourceFiles)if(!file||!isOfficialMushafUrl(file.url)||!isOfficialMushafUrl(file.licenseUrl)||![file.version,file.licenseNotice,file.attribution].every(nonempty)||!Number.isFinite(Date.parse(file.downloadedAt))||!hashPattern.test(file.archiveSha256)||!(file.publisherSha256===null||file.publisherSha256===file.archiveSha256))
    fail('سجل مصدر الملفات أو بصماتها أو حقوقها غير مكتمل.');
  if(!Array.isArray(m.surahs)||m.surahs.length!==pkg.manifest.totals.surahs||!Array.isArray(m.pages)||m.pages.length!==pkg.manifest.totals.pages||!Array.isArray(m.verses)||m.verses.length!==pkg.manifest.totals.ayahs)
    fail('عدد السور أو الصفحات أو الآيات لا يطابق الحزمة.');
  const paths=new Set<string>();
  for(const [i,page] of m.pages.entries()){
    const a=page?.asset;
    if(page?.number!==i+1||!integer(page.juz,1,30)||!a||!assetPath(a.path)||paths.has(a.path)||!['image/png','image/jpeg','image/webp'].includes(a.mimeType)||!hashPattern.test(a.sha256)||!integer(a.bytes,1,maxPageBytes)||!integer(a.width,1,10000)||!integer(a.height,1,10000))fail('بيانات صورة الصفحة غير صالحة.');
    paths.add(a.path);
  }
  const groups=new Map<string,typeof pkg.tokens>();let previousPage=0;
  for(const token of pkg.tokens){
    if(token.page<previousPage)fail('ترتيب صفحات الكلمات غير صالح.');previousPage=token.page;
    const key=`${token.surah}:${token.ayah}`;const group=groups.get(key)??[];group.push(token);groups.set(key,group);
  }
  const entries=[...groups.entries()],countBySurah=new Map<number,number>(),firstPages=new Map<number,number>();
  for(const [i,[key,tokens]] of entries.entries()){
    const verse=m.verses[i], first=tokens[0],last=tokens.at(-1)!;
    const expectedAyah=(countBySurah.get(first.surah)??0)+1;
    if(first.ayah!==expectedAyah||!verse||`${verse.surah}:${verse.ayah}`!==key||verse.startPage!==first.page||verse.endPage!==last.page||verse.juz!==first.juz||canonical(verse.tokenKeys)!==canonical(tokens.map(t=>`${m.editionId}:${t.surah}:${t.ayah}:${t.tokenIndex}`)))fail('خريطة الآيات ناقصة أو مكررة أو لا تطابق مواضع المصدر.');
    countBySurah.set(first.surah,expectedAyah);if(!firstPages.has(first.surah))firstPages.set(first.surah,first.page);
  }
  for(const [i,surah] of m.surahs.entries())if(surah?.number!==i+1||!nonempty(surah.name)||surah.ayahCount!==countBySurah.get(surah.number)||surah.startPage!==firstPages.get(surah.number))fail('فهرس السور لا يطابق بيانات الآيات.');
  for(const page of m.pages){const first=pkg.tokens.find(t=>t.page===page.number);if(!first||first.juz!==page.juz)fail('فهرس الأجزاء والصفحات لا يطابق المصدر.');}
  return {manifestHash:await contentHash(canonical(m)),pageCount:m.pages.length,verseCount:m.verses.length};
}

function dimensions(bytes:Uint8Array,mime:MushafPage['asset']['mimeType']):[number,number]|null {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(mime==='image/png'&&bytes.length>=24&&[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)&&String.fromCharCode(...bytes.slice(12,16))==='IHDR')return [view.getUint32(16),view.getUint32(20)];
  if(mime==='image/jpeg'&&bytes[0]===255&&bytes[1]===216){let i=2;while(i+8<bytes.length){if(bytes[i++]!==255)break;const marker=bytes[i++];if(marker===216||marker===217)continue;if(i+2>bytes.length)break;const length=view.getUint16(i);if(length<2||i+length>bytes.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return [view.getUint16(i+5),view.getUint16(i+3)];i+=length;}}
  if(mime==='image/webp'&&bytes.length>=25&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'){
    const type=String.fromCharCode(...bytes.slice(12,16));
    if(type==='VP8X'&&bytes.length>=30)return [1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16),1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16)];
    if(type==='VP8 '&&bytes.length>=30&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42)return [view.getUint16(26,true)&16383,view.getUint16(28,true)&16383];
    if(type==='VP8L'&&bytes[20]===47)return [1+bytes[21]+((bytes[22]&63)<<8),1+(bytes[22]>>6)+(bytes[23]<<2)+((bytes[24]&15)<<10)];
  }return null;
}
async function verifiedBlob(page:MushafPage,bytes:Uint8Array<ArrayBuffer>):Promise<Blob>{
  if(bytes.length!==page.asset.bytes||await contentHash(bytes)!==page.asset.sha256)fail('صورة الصفحة لا تطابق البصمة المعتمدة.');
  const size=dimensions(bytes,page.asset.mimeType);
  if(!size||size[0]!==page.asset.width||size[1]!==page.asset.height)fail('صيغة صورة الصفحة أو أبعادها لا تطابق البيان.');
  return new Blob([bytes],{type:page.asset.mimeType});
}
async function responseBytes(response:Response,expected:number):Promise<Uint8Array<ArrayBuffer>> {
  const declared=response.headers.get('content-length');if(declared!==null&&Number(declared)!==expected)fail('حجم ملف الصفحة لا يطابق البيان.');
  if(!response.body){const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length!==expected)fail('صورة الصفحة غير مكتملة.');return bytes;}
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let count=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;if(count>expected){await reader.cancel();fail('تجاوز ملف الصفحة الحجم المعتمد.');}parts.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(count);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}return bytes;
}
function reader(kind:VerifiedMushaf['kind'],manifest:MushafManifest,juzStarts:readonly MushafJuzStart[],load:(page:MushafPage,signal?:AbortSignal)=>Promise<Uint8Array<ArrayBuffer>>):VerifiedMushaf {
  // Freeze once: rendering/navigation must not clone thousands of verse/token rows per accessor.
  const captured=deepFreeze(structuredClone(manifest)),starts=deepFreeze(structuredClone(juzStarts)),cache=new Map<number,Blob>();
  const result:VerifiedMushaf=Object.freeze({kind,editionId:captured.editionId,layoutId:captured.layoutId,version:captured.version,contentManifestHash:captured.contentManifestHash,
    source:captured.source,surahs:captured.surahs,pages:captured.pages,verses:captured.verses,juzStarts:starts,
    async pageImage(number:number,signal?:AbortSignal){
      if(signal?.aborted)throw new DOMException('Aborted','AbortError');const page=captured.pages.find(p=>p.number===number);if(!page)throw new DomainError('INVALID_INPUT','رقم الصفحة غير موجود في المصحف.');
      if(cache.has(number)){const cached=cache.get(number)!;cache.delete(number);cache.set(number,cached);return cached;}
      const blob=await verifiedBlob(page,await load(page,signal));if(signal?.aborted)throw new DOMException('Aborted','AbortError');
      cache.set(number,blob);while(cache.size>cachePages)cache.delete(cache.keys().next().value!);return blob;
    }});
  approvedObjects.add(result);return result;
}
interface ReaderOptions { origin?:string; fetchAsset?:typeof fetch; testAuthorities?:readonly ContentAuthority[] }
/** Page signatures authorize exact raster bytes and maps, independently of text/font signatures. */
export async function createApprovedMushaf(input:ApprovedMushafInput,options:ReaderOptions={}):Promise<VerifiedMushaf>{
  if(options.testAuthorities&&import.meta.env.MODE!=='test')throw new DomainError('CONTENT_UNAVAILABLE','مفاتيح الاختبار غير مسموحة في التطبيق.');
  const data=structuredClone(input),authorities=options.testAuthorities??TRUSTED_CONTENT_AUTHORITIES;
  await new ContentGate(authorities).activate(data.pkg,data.contentApproval);
  const verified=await verifyMushafCandidate(data.pkg,data.manifest),a=data.pageApproval,authority=authorities.find(k=>k.id===a?.authorityId);
  if(!authority||!nonempty(a.reviewer)||!Number.isFinite(Date.parse(a.reviewedAt))||a.manifestHash!==verified.manifestHash||!Array.isArray(a.reviewed)||requiredReviews.some(d=>!a.reviewed.includes(d)))throw new DomainError('CONTENT_UNAVAILABLE','صفحات المصحف وخريطتها لم تحصل على الاعتماد المستقل.');
  const {signature,...signed}=a;let valid=false;
  try{const key=await crypto.subtle.importKey('jwk',authority.publicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);valid=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,Uint8Array.from(atob(signature),c=>c.charCodeAt(0)),new TextEncoder().encode(canonical(signed)));}catch{/* Fail closed. */}
  if(!valid)fail('توقيع اعتماد الصفحات غير صالح.');
  const origin=options.origin??location.origin,fetcher=options.fetchAsset??fetch;
  return reader('approved',data.manifest,sourceJuzStarts(data.pkg),async(page,signal)=>{
    const url=new URL(page.asset.path,origin),base=new URL(origin);if(url.origin!==base.origin)fail('صور المصحف يجب أن تُقدّم من أصل التطبيق.');
    const response=await fetcher(url.href,{signal,credentials:'same-origin',redirect:'error',cache:'force-cache'});
    if(!response.ok||response.type==='opaque'||response.url&&response.url!==url.href)fail('تعذر فتح صورة الصفحة المعتمدة.');
    const type=response.headers.get('content-type')?.split(';')[0];if(type&&type!==page.asset.mimeType&&type!=='application/octet-stream')fail('نوع ملف الصفحة غير مطابق.');
    return responseBytes(response,page.asset.bytes);
  });
}
/** Only isolated test entry points may mint synthetic non-Quran reader material. */
export function createEngineeringMushaf(manifest:MushafManifest,images:ReadonlyMap<number,Uint8Array<ArrayBuffer>>,juzStarts:readonly MushafJuzStart[]):VerifiedMushaf {
  if(import.meta.env.MODE!=='test'||!manifest.editionId.startsWith('test-')||!manifest.layoutId.startsWith('test-')||manifest.verses.some(v=>v.tokenKeys.some(k=>!k.startsWith('test-'))))throw new DomainError('CONTENT_UNAVAILABLE','مادة المصحف الصناعية محصورة في الاختبار.');
  const copies=new Map([...images].map(([n,bytes])=>[n,bytes.slice()]));
  if(!juzStarts.length||juzStarts.some((start,i)=>start.number!==i+1||!manifest.verses.some(v=>v.surah===start.surah&&v.ayah===start.ayah&&v.startPage<=start.page&&v.endPage>=start.page)))fail('حدود أجزاء الاختبار غير متوافقة مع صفحاته.');
  return reader('engineering',manifest,juzStarts,async page=>{const bytes=copies.get(page.number);if(!bytes)fail('صورة الاختبار غير متاحة.');return bytes!.slice();});
}
