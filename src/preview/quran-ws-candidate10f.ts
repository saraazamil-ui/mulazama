import data from './quran-ws-candidate10f.json';
import {canonical, DomainError} from '../core/types';
import {contentHash} from '../content/content-gate';
import {createCandidateReviewMushaf} from '../mushaf/model';
import type {MushafManifest, VerifiedMushaf} from '../mushaf/model';

// These digests bind the inspected bytes, canonical page map, audit receipt and pin.
// Changing a source requires a new inspection; no URL, digest or approval comes from storage/UI.
const payloadHash='66fd00b589bc84f541ef9fad251ca30012739836a55bc6ab68965af4762328e7';
const manifestHash='3c4812b2d58a9f61997ace4de39a08c77ed71cbce996d2359e554cb3be108b53';
export const QURAN_WS_COMMIT='3ff27b46cecb0c0519d77531d9c868a579d1f623';
const unavailable=():never=>{throw new DomainError('CONTENT_INTEGRITY_FAILURE','تعذر التحقق من صفحة المصدر المثبّت.');};

export async function createQuranWsCandidateReview(options:{fetchAsset?:typeof fetch}={}):Promise<VerifiedMushaf>{
  if(import.meta.env.MODE!=='test'||await contentHash(canonical(data))!==payloadHash||data.pin.commit!==QURAN_WS_COMMIT||data.security.status!=='passed'||data.security.canonicalPages!==604)unavailable();
  const fetcher=options.fetchAsset??fetch;
  return createCandidateReviewMushaf(data.manifest as unknown as MushafManifest,manifestHash,data.juzStarts,async(page,signal)=>{
    const expected=`https://raw.githubusercontent.com/quran-ws/quran-svg/${QURAN_WS_COMMIT}/mushafs/hafs/kfqc/svg/${String(page.number).padStart(3,'0')}.svg`;
    if(page.asset.path!==expected)unavailable();
    const response=await fetcher(expected,{signal,credentials:'omit',redirect:'error',cache:'force-cache'});
    if(!response.ok||response.type==='opaque'||response.url&&response.url!==expected||!response.body)unavailable();
    // GitHub serves SVG as text/plain. The inspected SHA-256, not a MIME claim, authorizes bytes.
    const stream=response.body!.getReader(),parts:Uint8Array[]=[];let length=0;
    try{
      while(true){const {done,value}=await stream.read();if(done)break;length+=value.byteLength;
        if(length>page.asset.bytes){await stream.cancel();unavailable();}parts.push(value);}
    }finally{stream.releaseLock();}
    if(length!==page.asset.bytes)unavailable();
    const bytes=new Uint8Array(length);let offset=0;
    for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
    // The reader verifies exact length and SHA-256 before creating an image-only Blob.
    return bytes;
  });
}
