// @vitest-environment node
import { beforeAll,describe,expect,it,vi } from 'vitest';
import { canonical } from '../core/types';
import { contentHash } from '../content/content-gate';
import type { ContentApproval,ContentAuthority,ContentPackage,ContentToken } from '../content/content-gate';
import { createApprovedMushaf,isOfficialMushafUrl,requireVerifiedMushaf,verifyMushafCandidate } from './model';
import type { ApprovedMushafInput,MushafManifest,MushafPageApproval } from './model';
import { runtimeMushafInput } from '../release/mushaf-input10b';
import { createEngineeringMushafFixture } from '../testing/mushaf-fixture10b';

const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAMAAAAFCAIAAAAPE8H1AAAAEUlEQVR4nGO49PAcBDEQyQIAq5IlkLhHwdEAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
let input:ApprovedMushafInput,authority:ContentAuthority,key:CryptoKeyPair;
const sign=async(value:unknown)=>btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key.privateKey,new TextEncoder().encode(canonical(value))))));
async function attest(data:ApprovedMushafInput){
  const content:Omit<ContentApproval,'signature'>={authorityId:authority.id,reviewer:'SYNTHETIC TEST REVIEWER',reviewedAt:'2026-11-08T00:00:00Z',manifestHash:await contentHash(canonical(data.pkg.manifest)),reviewed:['text','riwaya','script','diacritics','numbering','segmentation','layout','license','font','boundaries']};
  data.contentApproval={...content,signature:await sign(content)};
  data.manifest.contentManifestHash=content.manifestHash;
  const pages:Omit<MushafPageApproval,'signature'>={authorityId:authority.id,reviewer:'SYNTHETIC PAGE REVIEWER',reviewedAt:'2026-11-08T00:00:00Z',manifestHash:await contentHash(canonical(data.manifest)),reviewed:['pages','verse-map','license','source']};
  data.pageApproval={...pages,signature:await sign(pages)};return data;
}
async function fixture():Promise<ApprovedMushafInput>{
  const tokens:ContentToken[]=[],texts:string[]=[],indices=new Map<number,number>();let offset=0;
  for(let i=0;i<240;i++){
    const text=`SYNTHETIC_NON_QURAN_${i}`,surah=Math.floor(i*114/240)+1,tokenIndex=indices.get(surah)??0;indices.set(surah,tokenIndex+1);
    tokens.push({surah,ayah:1,tokenIndex,sourceStart:offset,sourceEnd:offset+text.length,page:i<121?1:2,juz:Math.floor(i/8)+1,hizb:Math.floor(i/4)+1,rub:i+1});texts.push(text);offset+=text.length+1;
  }
  const text=texts.join(' '),fontBytes=new Uint8Array([1,2,3]);
  const pkg:ContentPackage={text,tokens,fontBytes,manifest:{schemaVersion:1,product:'MULAZAMA',editionId:'test-content-edition',contentVersion:'test-only',riwaya:'Hafs an Asim',tariq:null,script:'SYNTHETIC NON-QURAN',diacritics:'test',verseNumbering:'synthetic',tokenizationVersion:'test',layoutId:'test-layout',layoutVersion:'test',source:{name:'Synthetic fixture with official-host-shaped URL, not publisher data',version:'test',url:'https://qurancomplex.gov.sa/test-only',licenseId:'test',licenseNotice:'Synthetic fixture only',attribution:'Test author'},font:{name:'synthetic',version:'test',licenseNotice:'test only'},totals:{surahs:114,ayahs:114,tokens:240,pages:2,juz:30,hizb:60,rub:240},hashes:{algorithm:'SHA-256',text:await contentHash(text),mapping:await contentHash(canonical(tokens)),font:await contentHash(fontBytes)}}};
  const verses=Array.from({length:114},(_,i)=>{const group=tokens.filter(t=>t.surah===i+1);return {surah:i+1,ayah:1,juz:group[0].juz,startPage:group[0].page,endPage:group.at(-1)!.page,tokenKeys:group.map(t=>`${pkg.manifest.editionId}:${t.surah}:${t.ayah}:${t.tokenIndex}`)};});
  const digest=await contentHash(png);
  const manifest:MushafManifest={schemaVersion:1,editionId:pkg.manifest.editionId,layoutId:pkg.manifest.layoutId,version:'test-only',contentManifestHash:'',source:{name:'Synthetic test data',url:'https://dm.qurancomplex.gov.sa/test-only',attribution:'Test author',licenseNotice:'Synthetic fixture only'},sourceFiles:[{url:'https://dm.qurancomplex.gov.sa/test-only',version:'test',archiveSha256:'0'.repeat(64),publisherSha256:null,downloadedAt:'2026-11-08T00:00:00Z',licenseUrl:'https://dm.qurancomplex.gov.sa/rights/',licenseNotice:'Test-only licensing record; not publisher approval',attribution:'Synthetic fixture author'}],pages:[1,2].map(number=>({number,juz:number===1?1:16,asset:{path:`/mushaf/test-page-${number}.png`,mimeType:'image/png',sha256:digest,bytes:png.length,width:3,height:5}})),surahs:verses.map(v=>({number:v.surah,name:`TEST SURAH ${v.surah}`,ayahCount:1,startPage:v.startPage})),verses};
  return attest({pkg,manifest,contentApproval:{} as ContentApproval,pageApproval:{} as MushafPageApproval});
}
const options=(fetchAsset:typeof fetch=vi.fn(async()=>new Response(png,{headers:{'content-type':'image/png'}})))=>({origin:'https://preview.example',fetchAsset,testAuthorities:[authority]});
// Fetch has already decoded the body while retaining the transfer headers.
// The 74-byte synthetic PNG has gzip/br wire sizes of 95/78 bytes.
const decodedTransfer=(encoding:'gzip'|'br',body:Uint8Array<ArrayBuffer>)=>new Response(body,{headers:{
  'content-type':'image/png','content-encoding':encoding,'content-length':String(encoding==='gzip'?95:78),
}});
beforeAll(async()=>{key=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);authority={id:'test-ephemeral-pages',publicKey:await crypto.subtle.exportKey('jwk',key.publicKey)};input=await fixture();});

describe('10-B independent content and page integrity',()=>{
  it('keeps runtime closed and rejects a self-signed caller without trusted release anchors',async()=>{
    expect(runtimeMushafInput).toBeNull();await expect(createApprovedMushaf(input,{origin:'https://preview.example'})).rejects.toMatchObject({code:'CONTENT_UNAVAILABLE'});
    expect(()=>requireVerifiedMushaf({...input,kind:'approved'})).toThrow();
  });
  it('validates full index coverage and a verse crossing two pages without manufacturing text',async()=>{
    const before=input.pkg.text;expect(await verifyMushafCandidate(input.pkg,input.manifest)).toMatchObject({pageCount:2,verseCount:114});
    expect(input.manifest.verses[57]).toMatchObject({surah:58,startPage:1,endPage:2});expect(input.pkg.text).toBe(before);
  });
  it.each(['missing','duplicate','wrong-page','wrong-token','surah-count','juz-map'] as const)('rejects %s mappings independently of browser tests',async(kind)=>{
    const data=structuredClone(input);
    if(kind==='missing')data.manifest.verses.pop();
    if(kind==='duplicate')data.manifest.verses[1]=structuredClone(data.manifest.verses[0]);
    if(kind==='wrong-page')data.manifest.verses[57].endPage=1;
    if(kind==='wrong-token')data.manifest.verses[0].tokenKeys[0]='other-token';
    if(kind==='surah-count')data.manifest.surahs[0].ayahCount=2;
    if(kind==='juz-map')data.manifest.pages[1].juz=17;
    await expect(verifyMushafCandidate(data.pkg,data.manifest)).rejects.toMatchObject({code:'CONTENT_INTEGRITY_FAILURE'});
  });
  it('rejects a gap even if the candidate source and map are rehashed together',async()=>{
    const data=structuredClone(input);for(const token of data.pkg.tokens)if(token.surah===1)token.ayah=2;
    data.pkg.manifest.hashes.mapping=await contentHash(canonical(data.pkg.tokens));await attest(data);
    await expect(verifyMushafCandidate(data.pkg,data.manifest)).rejects.toThrow();
  });
  it.each(['https://qurancomplex.gov.sa.evil.invalid/x','http://dm.qurancomplex.gov.sa/a','https://qurancomplex.gov.sa@evil.invalid/x','https://example.org/quran'])('rejects nonofficial provenance %s',url=>{expect(isOfficialMushafUrl(url)).toBe(false);});
  it('requires file provenance, rights, correct publisher checksum and bounded same-origin assets',async()=>{
    for(const change of [(m:MushafManifest)=>{m.sourceFiles=[];},(m:MushafManifest)=>{m.sourceFiles[0].licenseNotice='';},(m:MushafManifest)=>{m.sourceFiles[0].publisherSha256='1'.repeat(64);},(m:MushafManifest)=>{m.pages[0].asset.path='//evil.invalid/page.png';},(m:MushafManifest)=>{m.pages[0].asset.path='/mushaf/../other.png';},(m:MushafManifest)=>{m.pages[0].asset.bytes=99*1024*1024;}]){
      const data=structuredClone(input);change(data.manifest);await expect(verifyMushafCandidate(data.pkg,data.manifest)).rejects.toThrow();
    }
  });
  it('requires an independent signed page/map review even with an approved text package',async()=>{
    const missing=structuredClone(input);missing.pageApproval.reviewed=missing.pageApproval.reviewed.filter(x=>x!=='pages');await expect(createApprovedMushaf(missing,options())).rejects.toMatchObject({code:'CONTENT_UNAVAILABLE'});
    const tampered=structuredClone(input);tampered.pageApproval.reviewer='changed';await expect(createApprovedMushaf(tampered,options())).rejects.toThrow();
    const changed=structuredClone(input);changed.manifest.pages[0].asset.sha256='1'.repeat(64);await expect(createApprovedMushaf(changed,options())).rejects.toThrow();
  });
  it('loads verified raster bytes only from the application origin and caches verified pages',async()=>{
    const fetcher=vi.fn(async()=>new Response(png,{headers:{'content-type':'image/png'}}));const reader=await createApprovedMushaf(input,options(fetcher));requireVerifiedMushaf(reader);
    expect(reader.contentManifestHash).toBe(input.manifest.contentManifestHash);expect((await reader.pageImage(1)).type).toBe('image/png');await reader.pageImage(1);await reader.pageImage(2);
    expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher).toHaveBeenCalledWith('https://preview.example/mushaf/test-page-1.png',expect.objectContaining({redirect:'error',credentials:'same-origin'}));
  });
  it.each(['gzip','br'] as const)('verifies decoded image bytes from a %s Fetch response despite different transfer length',async encoding=>{
    const response=decodedTransfer(encoding,png);
    expect(Number(response.headers.get('content-length'))).not.toBe(png.length);
    const reader=await createApprovedMushaf(input,options(async()=>response));
    const blob=await reader.pageImage(1);
    expect(blob.type).toBe('image/png');expect(new Uint8Array(await blob.arrayBuffer())).toEqual(png);
  });
  it.each([
    ['gzip','truncated'],['gzip','oversized'],['gzip','same-size-tamper'],
    ['br','truncated'],['br','oversized'],['br','same-size-tamper'],
  ] as const)('rejects %s decoded image %s after HTTP decompression',async(encoding,change)=>{
    let changed:Uint8Array<ArrayBuffer>;
    if(change==='truncated')changed=png.slice(0,-1);
    else if(change==='oversized'){changed=new Uint8Array(png.length+1);changed.set(png);}
    else{changed=png.slice();changed[changed.length-1]^=1;}
    const reader=await createApprovedMushaf(input,options(async()=>decodedTransfer(encoding,changed)));
    await expect(reader.pageImage(1)).rejects.toMatchObject({code:'CONTENT_INTEGRITY_FAILURE'});
  });
  it.each([undefined,'identity'])('rejects mismatched declared length with %s content encoding',async encoding=>{
    const headers:Record<string,string>={'content-type':'image/png','content-length':String(png.length+1)};
    if(encoding)headers['content-encoding']=encoding;
    const reader=await createApprovedMushaf(input,options(async()=>new Response(png,{headers})));
    await expect(reader.pageImage(1)).rejects.toMatchObject({code:'CONTENT_INTEGRITY_FAILURE'});
  });
  it('derives all juz starts from signed token boundaries, including a boundary inside a verse and page',async()=>{
    const reader=await createApprovedMushaf(input,options());expect(reader.juzStarts.map(start=>start.number)).toEqual(Array.from({length:30},(_,i)=>i+1));
    expect(reader.juzStarts[1]).toEqual({number:2,page:1,surah:4,ayah:1});
    expect(reader.verses.find(v=>v.surah===4&&v.ayah===1)?.juz).toBe(1);expect(reader.pages[0].juz).toBe(1);
    const data=structuredClone(input);data.pkg.tokens[9].juz=1;data.pkg.manifest.hashes.mapping=await contentHash(canonical(data.pkg.tokens));await attest(data);
    await expect(verifyMushafCandidate(data.pkg,data.manifest)).rejects.toMatchObject({code:'CONTENT_INTEGRITY_FAILURE'});
  });
  it('rejects changed image bytes, oversized streams, wrong media and wrong dimensions before returning a blob',async()=>{
    for(const response of [new Response(new Uint8Array([1,2,3])),new Response(new Uint8Array(png.length+1)),new Response(png,{headers:{'content-type':'text/html'}})]){
      const reader=await createApprovedMushaf(input,options(async()=>response));await expect(reader.pageImage(1)).rejects.toThrow();
    }
    const data=structuredClone(input);data.manifest.pages[0].asset.width=4;await attest(data);const reader=await createApprovedMushaf(data,options());await expect(reader.pageImage(1)).rejects.toThrow();
  });
  it('does not trust magic-less data even when its exact bytes were signed',async()=>{
    const data=structuredClone(input),html=new TextEncoder().encode('<html>not a page</html>');data.manifest.pages[0].asset.bytes=html.length;data.manifest.pages[0].asset.sha256=await contentHash(html);await attest(data);
    const reader=await createApprovedMushaf(data,options(async()=>new Response(html)));await expect(reader.pageImage(1)).rejects.toThrow();
  });
  it('does not fetch out-of-range or aborted pages and isolates metadata from caller mutation',async()=>{
    const data=structuredClone(input),fetcher=vi.fn(async()=>new Response(png));const reader=await createApprovedMushaf(data,options(fetcher));
    data.manifest.pages[0].asset.sha256='1'.repeat(64);expect(()=>{reader.pages[0].asset.sha256='2'.repeat(64);}).toThrow();
    expect(reader.verses).toBe(reader.verses);expect(Object.isFrozen(reader.verses[0].tokenKeys)).toBe(true);expect(Object.isFrozen(reader.juzStarts)).toBe(true);
    await expect(reader.pageImage(0)).rejects.toThrow();await expect(reader.pageImage(1,AbortSignal.abort())).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
    expect((await reader.pageImage(1)).size).toBe(png.length);
  });
  it('uses clearly synthetic fixtures matching isolated journey identifiers without granting official approval',async()=>{
    const reader=await createEngineeringMushafFixture();requireVerifiedMushaf(reader);expect(reader.kind).toBe('engineering');expect(reader.editionId).toBe('test-engineering-06l3');
    expect(reader.verses[2].tokenKeys).toEqual(Array.from({length:8},(_,k)=>`test-token-3-${k}`));expect(reader.pages).toHaveLength(3);expect((await reader.pageImage(3)).type).toBe('image/png');
    const mixed=await createEngineeringMushafFixture({mixedJuzBoundary:true});expect(mixed.juzStarts[1]).toEqual({number:2,page:2,surah:1,ayah:2});expect(mixed.pages[1].juz).toBe(1);expect(mixed.verses[1].juz).toBe(1);
  });
});
