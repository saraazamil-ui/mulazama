import {contentHash} from '../content/content-gate';
import {createEngineeringJourneyMaterial} from '../content/journey-material06l3';
import {createEngineeringMushaf,type MushafManifest} from '../mushaf/model';
import pagesEncoded from './reader-pages10f.json';

/** Authored non-Quran fixtures only. Never imports any acquired Quran package. */
export async function createReaderPreviewMaterial(){
  if(import.meta.env.MODE!=='test')throw Error('READER_PREVIEW_MATERIAL_DISABLED');
  const editionId='test-reader-preview-10f';
  const positions=Array.from({length:12},(_,i)=>({surah:Math.floor(i/4)+1,ayah:i%4+1,page:Math.floor(i/2)+1,juz:Math.floor(i/4)+1}));
  const units=positions.map(({surah,ayah})=>({id:`test-reader-10f-s${surah}-a${ayah}`,editionId,probeProfileVersionId:'test-chunk-10f',words:8,coverage:Array.from({length:8},(_,word)=>`test-reader-token-${surah}-${ayah}-${word}`)}));
  const material=createEngineeringJourneyMaterial(units,{pages:positions.map(p=>p.page),positions});
  const images=new Map(pagesEncoded.map((value,i)=>[i+1,Uint8Array.from(atob(value),c=>c.charCodeAt(0))]));
  const pages=await Promise.all([...images].map(async([number,bytes])=>({number,juz:Math.ceil(number/2),asset:{path:`/mushaf/test-reader-${number}.png`,mimeType:'image/png' as const,sha256:await contentHash(bytes),bytes:bytes.length,width:600,height:850}})));
  const manifest:MushafManifest={schemaVersion:1,editionId,layoutId:'test-reader-layout-10f',version:'synthetic-10f-v1',contentManifestHash:'0'.repeat(64),source:{name:'تجربة القارئ',url:'https://example.invalid/synthetic-reader',attribution:'صفحات صناعية غير قرآنية لاختبار القارئ',licenseNotice:'مواد اختبار أُنشئت لهذا المشروع، وليست صفحات مصحف'},sourceFiles:[],
    surahs:[1,2,3].map(number=>({number,name:`قسم تجريبي ${number.toLocaleString('ar-SA')}`,ayahCount:4,startPage:number*2-1})),pages,
    verses:positions.map((p,i)=>({surah:p.surah,ayah:p.ayah,juz:p.juz,startPage:p.page,endPage:p.page,tokenKeys:units[i].coverage}))};
  const mushaf=createEngineeringMushaf(manifest,images,[1,2,3].map(number=>({number,page:number*2-1,surah:number,ayah:1})));
  return {units,material,mushaf};
}
