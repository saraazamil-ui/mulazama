import { createRuntimeLearningAccess, runtimeDatabaseName } from '../release/runtime';
import { runtimeJourneyInput } from '../release/journey-input06l3';
import releaseInput from '../release/release-input.json';
import { createApprovedJourneyMaterial } from '../content/journey-material06l3';
import { IndexedDbEventStore } from '../persistence/event-store';
import { HistoryApplication } from './history-application';
import { LearningJourney } from './journey06l3';
import { learningVersionsFor, type LearningSchedulingMode, DomainError } from '../core/types';
import { createApprovedMushaf, type VerifiedMushaf } from '../mushaf/model';
import { runtimeMushafInput } from '../release/mushaf-input10b';
import { openMushafStudy } from './mushaf-runtime10b';
/** Build-time content+release evidence alone can select a real session owner. */
export async function openRuntimeApplication(){
  const access=await createRuntimeLearningAccess();
  let mushaf:VerifiedMushaf|null=null,readerError:string|undefined;
  if(runtimeMushafInput){
    try{mushaf=await createApprovedMushaf(runtimeMushafInput);}
    catch{readerError='تعذر التحقق من حزمة المصحف؛ لم يُعرض أي محتوى منها. بياناتك محفوظة.';}
  }
  const readerDatabaseName=runtimeDatabaseName();
  // A historical interrupted recall can exist even without an active journey.
  // Do not expose pages until the same approved session owner can record reveals.
  if(!runtimeJourneyInput)return {history:await HistoryApplication.open(undefined,{access}),journey:undefined,mushaf:null,study:undefined,readerDatabaseName,
    readerError:readerError??(mushaf?'حزمة المصحف متحققة، وتنتظر ربطها بمحرك الجلسات المعتمد قبل إتاحتها.':undefined)};
  const scheduling=(releaseInput as typeof releaseInput & {learningScheduling?:LearningSchedulingMode}).learningScheduling??'legacy';
  await access.authorize({operation:'open-approved-journey',versions:learningVersionsFor(scheduling)});
  if(!releaseInput.contentManifestHash)throw new DomainError('CONTENT_UNAVAILABLE','بيان المحتوى المعتمد غير متاح.');
  const material=await createApprovedJourneyMaterial(runtimeJourneyInput,releaseInput.contentManifestHash);
  const font=new FontFace('MulazamaApproved',runtimeJourneyInput.pkg.fontBytes);await font.load();document.fonts.add(font);
  const store=await IndexedDbEventStore.open(runtimeDatabaseName());
  try{
    const journey=await LearningJourney.open(store,material,access,{scheduling});
    let study;
    if(mushaf){
      if(mushaf.contentManifestHash!==releaseInput.contentManifestHash){mushaf=null;readerError='حزمة المصحف لا تطابق طبعة خطة الحفظ؛ أوقفنا عرضها.';}
      else try{study=openMushafStudy(journey,mushaf,readerDatabaseName,localStorage);}catch{readerError='تعذر استعادة مقدار الحفظ المختار؛ لم يتغير سجل تعلمك.';}
    }
    return {history:journey.app,journey,mushaf,study,readerDatabaseName,readerError};
  }
  catch(error){store.close();throw error;}
}
