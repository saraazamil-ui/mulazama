import {createRoot} from 'react-dom/client';
import App from '../App';
import {IndexedDbEventStore} from '../persistence/event-store';
import {LearningJourney} from '../application/journey06l3';
import {createSyntheticLearningAccess} from '../testing/learning-access';
import {openMushafStudy} from '../application/mushaf-runtime10b';
import {createReaderPreviewMaterial} from './reader-preview-material10f';
import {readerPreviewDatabase,readerPreviewOriginAllowed} from './reader-preview-policy10f';
import '../styles.css';
import './reader-preview10f.css';
import {CandidateReview10f} from './CandidateReview10f';

const root=createRoot(document.getElementById('root')!);
async function boot(){
  if(import.meta.env.MODE!=='test'||!readerPreviewOriginAllowed(location.origin))throw Error('هذه النسخة الصناعية مخصصة لرابط المعاينة الخاصة فقط.');
  if(import.meta.env.PROD&&'serviceWorker'in navigator){
    // Updating this private preview replaces only the app shell, never IndexedDB.
    await navigator.serviceWorker.register(new URL('sw.js',document.baseURI),{scope:'./'}).catch(()=>undefined);
  }
  const name=readerPreviewDatabase(localStorage);
  const {units,material,mushaf}=await createReaderPreviewMaterial();
  const access=await createSyntheticLearningAccess(units);
  const store=await IndexedDbEventStore.open(name);
  try{
    const journey=await LearningJourney.open(store,material,access,{scheduling:'reference-06e1'});
    if(!journey.app.product.state.config.configured){
      await journey.app.product.dispatch({type:'config',config:{...journey.app.product.state.config,configured:true,goal:'memorize',startSurah:1,days:[0,1,2,3,4,5,6],minutes:30}});
    }
    const study=openMushafStudy(journey,mushaf,name,localStorage);
    await journey.prepare();
    if(!location.hash)history.replaceState(null,'','#S05');
    root.render(<App service={journey.app.product} data={journey.app} journey={journey} mushaf={mushaf} study={study} readerDatabaseName={name}
      initialReaderMode={new URLSearchParams(location.search).get('demo')==='1'?'practice':'review'}
      candidateReview={onPractice=><CandidateReview10f journey={journey} databaseName={name} onPractice={onPractice}/>} />);
  }catch(error){store.close();throw error;}
}
void boot().catch(error=>root.render(<main dir="rtl"><h1>تعذر فتح تجربة القارئ</h1><p role="alert">{error instanceof Error?error.message:'تعذر الوصول إلى سجل التجربة.'}</p><p>لم تُحذف بياناتك ولم يُفتح سجل بديل.</p><button onClick={()=>location.reload()}>إعادة المحاولة</button></main>));
