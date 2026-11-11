import {createRoot} from 'react-dom/client';
import App from '../App';
import {IndexedDbEventStore} from '../persistence/event-store';
import {createSyntheticLearningAccess} from './learning-access';
import {createEngineeringJourneyMaterial} from '../content/journey-material06l3';
import {LearningJourney} from '../application/journey06l3';
import {engineeringDatabaseIdentity} from './engineering-identity';
import '../styles.css';
async function boot(){
 if(import.meta.env.MODE!=='test'||!['127.0.0.1','localhost','[::1]'].includes(location.hostname))throw Error('ENGINEERING_ENTRY_DISABLED');
 // L3_ENGINEERING_ONLY: separate build, synthetic non-Quran, and a new isolated database identity.
 const key='mulazama-engineering-db-06l3';
 const name=engineeringDatabaseIdentity(localStorage,()=>crypto.randomUUID(),sessionStorage.getItem(key));
 // Preserve the test tooling's session-scoped inspection without using it as authority.
 sessionStorage.setItem(key,name);
 const units=Array.from({length:3},(_,i)=>({id:`test-journey-unit-${i+1}`,editionId:'test-engineering-06l3',probeProfileVersionId:'test-chunk-06l3',words:8,coverage:Array.from({length:8},(_,k)=>`test-token-${i+1}-${k}`)}));
 const material=createEngineeringJourneyMaterial(units),access=await createSyntheticLearningAccess(units);
 const store=await IndexedDbEventStore.open(name);
 try{
  const journey=await LearningJourney.open(store,material,access,{scheduling:'reference-06e1'});
  if(import.meta.env.PROD&&'serviceWorker'in navigator)await navigator.serviceWorker.register('/sw.js');
  createRoot(document.getElementById('root')!).render(<App service={journey.app.product} data={journey.app} journey={journey}/>);
 }catch(error){store.close();throw error;}
}
void boot().catch(error=>createRoot(document.getElementById('root')!).render(<main dir="rtl"><h1>تعذر فتح الاختبار الهندسي</h1><p role="alert">{String(error.message)}</p></main>));
