import {createRoot} from 'react-dom/client';
import App from '../App';
import {IndexedDbEventStore} from '../persistence/event-store';
import {createSyntheticLearningAccess} from './learning-access';
import {createEngineeringJourneyMaterial} from '../content/journey-material06l3';
import {LearningJourney} from '../application/journey06l3';
import {createEngineeringMushafFixture} from './mushaf-fixture10b';
import {openMushafStudy} from '../application/mushaf-runtime10b';
import '../styles.css';
async function boot(){
 if(import.meta.env.MODE!=='test'||!['127.0.0.1','localhost','[::1]'].includes(location.hostname))throw Error('ENGINEERING_ENTRY_DISABLED');
 // L3_ENGINEERING_ONLY: separate build, synthetic non-Quran, and a new isolated database identity.
 const prefix='mulazama-engineering-06l3-',key='mulazama-engineering-db-06l3';
 let name=sessionStorage.getItem(key);
 if(!name||!/^mulazama-engineering-06l3-[a-f0-9-]{36}$/.test(name)){name=prefix+crypto.randomUUID();sessionStorage.setItem(key,name);}
 const units=Array.from({length:3},(_,i)=>({id:`test-journey-unit-${i+1}`,editionId:'test-engineering-06l3',probeProfileVersionId:'test-chunk-06l3',words:8,coverage:Array.from({length:8},(_,k)=>`test-token-${i+1}-${k}`)}));
 const material=createEngineeringJourneyMaterial(units,{pages:[1,2,3]}),access=await createSyntheticLearningAccess(units);
 const store=await IndexedDbEventStore.open(name);
 try{
  const journey=await LearningJourney.open(store,material,access,{scheduling:'reference-06e1'});
  const mushaf=await createEngineeringMushafFixture();
  const study=openMushafStudy(journey,mushaf,name,localStorage);
  if(import.meta.env.PROD&&'serviceWorker'in navigator)await navigator.serviceWorker.register('/sw.js');
  createRoot(document.getElementById('root')!).render(<App service={journey.app.product} data={journey.app} journey={journey} mushaf={mushaf} study={study} readerDatabaseName={name}/>);
 }catch(error){store.close();throw error;}
}
void boot().catch(error=>createRoot(document.getElementById('root')!).render(<main dir="rtl"><h1>تعذر فتح الاختبار الهندسي</h1><p role="alert">{String(error.message)}</p></main>));
