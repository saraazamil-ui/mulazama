import { createRuntimeLearningAccess, runtimeDatabaseName } from '../release/runtime';
import { runtimeJourneyInput } from '../release/journey-input06l3';
import releaseInput from '../release/release-input.json';
import { createApprovedJourneyMaterial } from '../content/journey-material06l3';
import { IndexedDbEventStore } from '../persistence/event-store';
import { HistoryApplication } from './history-application';
import { LearningJourney } from './journey06l3';
import { learningVersionsFor, type LearningSchedulingMode, DomainError } from '../core/types';
/** Build-time content+release evidence alone can select a real session owner. */
export async function openRuntimeApplication(){
  const access=await createRuntimeLearningAccess();
  if(!runtimeJourneyInput)return {history:await HistoryApplication.open(undefined,{access}),journey:undefined};
  const scheduling=(releaseInput as typeof releaseInput & {learningScheduling?:LearningSchedulingMode}).learningScheduling??'legacy';
  await access.authorize({operation:'open-approved-journey',versions:learningVersionsFor(scheduling)});
  if(!releaseInput.contentManifestHash)throw new DomainError('CONTENT_UNAVAILABLE','بيان المحتوى المعتمد غير متاح.');
  const material=await createApprovedJourneyMaterial(runtimeJourneyInput,releaseInput.contentManifestHash);
  const font=new FontFace('MulazamaApproved',runtimeJourneyInput.pkg.fontBytes);await font.load();document.fonts.add(font);
  const store=await IndexedDbEventStore.open(runtimeDatabaseName());
  try{const journey=await LearningJourney.open(store,material,access,{scheduling});return {history:journey.app,journey};}
  catch(error){store.close();throw error;}
}
