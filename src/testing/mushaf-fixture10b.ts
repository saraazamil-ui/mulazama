import { contentHash } from '../content/content-gate';
import { createEngineeringMushaf } from '../mushaf/model';
import type { MushafManifest, VerifiedMushaf } from '../mushaf/model';

/** Three tiny flat-color raster fixtures; not Quran pages or publisher assets. */
export async function createEngineeringMushafFixture(options:{mixedJuzBoundary?:boolean}={}):Promise<VerifiedMushaf>{
  if(import.meta.env.MODE!=='test')throw Error('ENGINEERING_MUSHAF_DISABLED');
  const encoded=[
    'iVBORw0KGgoAAAANSUhEUgAAAAMAAAAFCAIAAAAPE8H1AAAAEUlEQVR4nGO49PAcBDEQyQIAq5IlkLhHwdEAAAAASUVORK5CYII=',
    'iVBORw0KGgoAAAANSUhEUgAAAAMAAAAFCAIAAAAPE8H1AAAAEUlEQVR4nGO4d+MQBDEQyQIAn8slCUGMdOoAAAAASUVORK5CYII=',
    'iVBORw0KGgoAAAANSUhEUgAAAAMAAAAFCAIAAAAPE8H1AAAAEUlEQVR4nGM4cuMhBDEQyQIAo8clVJAJL/MAAAAASUVORK5CYII=',
  ];
  const images=new Map(encoded.map((value,i)=>[i+1,Uint8Array.from(atob(value),c=>c.charCodeAt(0))]));
  const pages=await Promise.all([...images].map(async([number,bytes])=>({number,juz:number<3?1:2,asset:{path:`/mushaf/test-${number}.png`,mimeType:'image/png' as const,sha256:await contentHash(bytes),bytes:bytes.length,width:3,height:5}})));
  const manifest:MushafManifest={schemaVersion:1,editionId:'test-engineering-06l3',layoutId:'test-mushaf-layout-10b',version:'synthetic-10b',contentManifestHash:'0'.repeat(64),
    source:{name:'بيانات صناعية للاختبار فقط',url:'https://example.invalid/synthetic',attribution:'ليست صفحات قرآن ولا مواد من المجمع',licenseNotice:'اختبار هندسي معزول فقط'},sourceFiles:[],
    surahs:[{number:1,name:'سورة اختبار صناعي',ayahCount:3,startPage:1}],pages,
    verses:pages.map(({number,juz})=>({surah:1,ayah:number,juz,startPage:number,endPage:number,tokenKeys:Array.from({length:8},(_,k)=>`test-token-${number}-${k}`)}))};
  return createEngineeringMushaf(manifest,images,[{number:1,page:1,surah:1,ayah:1},{number:2,page:options.mixedJuzBoundary?2:3,surah:1,ayah:options.mixedJuzBoundary?2:3}]);
}
