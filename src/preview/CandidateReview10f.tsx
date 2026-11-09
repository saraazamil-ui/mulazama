import {useEffect,useState} from 'react';
import {MushafReader10b} from '../MushafReader10b';
import {Button} from '../components';
import type {VerifiedMushaf} from '../mushaf/model';
import type {LearningJourney} from '../application/journey06l3';
import type {StudyRange,StudySelection} from '../application/mushaf-study10b';
import {useMushafGuard} from '../application/use-mushaf-guard10b';

/** Review-only intent never registers Quran units or writes learning facts. */
export function CandidateReview10f({journey,databaseName,onPractice}:{journey:LearningJourney;databaseName:string;onPractice:()=>void}){
  const [mushaf,setMushaf]=useState<VerifiedMushaf|null>(null),[error,setError]=useState(''),[selection,setSelection]=useState<StudySelection|null>(null);
  const profile=journey.app.product.state.profileId;
  const guard=useMushafGuard(journey,databaseName,profile);
  const key=mushaf?['mulazama-candidate-review-intent-10f',databaseName,profile,mushaf.editionId,mushaf.layoutId,mushaf.version].map(encodeURIComponent).join(':'):null;
  const validate=(range:StudyRange)=>{
    const surah=mushaf?.surahs.find(s=>s.number===range?.surah);
    if(!surah||!Number.isSafeInteger(range.fromAyah)||!Number.isSafeInteger(range.toAyah)||range.fromAyah<1||range.toAyah<range.fromAyah||range.toAyah>surah.ayahCount)throw Error('مقدار المراجعة خارج حدود بيانات المصدر المرشح.');
  };
  useEffect(()=>{let live=true;void import('./quran-ws-candidate10f').then(m=>m.createQuranWsCandidateReview()).then(value=>{if(live)setMushaf(value);}).catch(()=>{if(live)setError('تعذر فتح بيان المصدر المثبّت. يمكنك متابعة اختبار القارئ ببيانات صناعية.');});return()=>{live=false;};},[]);
  useEffect(()=>{
    setSelection(null);
    if(!key||!mushaf)return;
    try{const raw=localStorage.getItem(key);if(raw){const saved=JSON.parse(raw);if(saved.schemaVersion===1&&saved.editionId===mushaf.editionId){validate(saved.range);setSelection({editionId:mushaf.editionId,range:saved.range,unitIds:[]});}}}
    catch{setError('تعذر استعادة مقدار مراجعة المصدر؛ بقي سجل التعلم دون تغيير.');}
  },[key,mushaf]);
  const session=journey.active;
  const blocked=!!session&&(session.phase==='recall'||session.phase==='paused'&&session.previousPhase==='recall')&&(journey.needsRestart||!journey.state.attempts[session.attemptId??'']?.revealed);
  return <div className="candidate-review-panel">
    {!mushaf?<><p role={error?'alert':'status'}>{error||'جارٍ فتح صفحات حفص…'}</p>{error&&<Button variant="secondary" onClick={onPractice}>اختبر الحفظ والمراجعة ببيانات صناعية</Button>}</>:
      <MushafReader10b mushaf={mushaf} databaseName={`${databaseName}:${profile}:candidate-review`} selection={selection}
        unavailableReason={error||guard.error} checkingSession={guard.checking} beforeRead={guard.beforeRead} readingBlocked={blocked}
        revealUnavailable={journey.needsRestart||session?.phase==='paused'} onResume={()=>{location.hash='S10';}}
        onReveal={async()=>{const s=journey.active;if(!s||s.phase!=='recall'||journey.needsRestart)throw Error('استأنف الجلسة أولًا.');await journey.action({type:'hint',sessionId:s.id,reveal:true});guard.notifyCommitted();}}
        onSelectRange={range=>{validate(range);if(!key)throw Error('هوية المراجعة غير متاحة.');localStorage.setItem(key,JSON.stringify({schemaVersion:1,editionId:mushaf.editionId,range,learningActivation:false}));setSelection({editionId:mushaf.editionId,range:{...range},unitIds:[]});}}
        onToday={()=>{location.hash='S05';}}
        secondaryActions={<Button variant="secondary" onClick={onPractice}>اختبر الحفظ والمراجعة ببيانات صناعية</Button>} />}
  </div>;
}
