import { useCallback,useEffect,useRef,useState } from 'react';
import { Button,Card,Heading,Notice } from './components';
import { LearningJourney,type QuickObservation } from './application/journey06l3';
import type { Screen } from './catalog';
import type { ManualObservation } from './application/learning-ui-adapter';
import './JourneyScreen06l3.css';
const choices:{id:QuickObservation;label:string}[]=[
 {id:'clean-normal',label:'سمّعت المقطع كاملًا بلا خطأ معلوم — جهد عادي'},
 {id:'clean-hard',label:'سمّعت المقطع كاملًا بلا خطأ معلوم — بصعوبة'},
 {id:'clean-easy',label:'سمّعت المقطع كاملًا بلا خطأ معلوم — بسهولة'},
 {id:'memory-failure',label:'لم أستطع إكماله من الذاكرة'},
 {id:'unknown',label:'لا أستطيع تحديد النتيجة'},
];
const date=(s:string)=>new Intl.DateTimeFormat('ar-SA',{dateStyle:'medium',timeZone:'Asia/Riyadh',calendar:'gregory'}).format(new Date(s));
export function JourneyScreen({journey,screen,go,onCommitted}:{journey:LearningJourney;screen:Screen;go:(screen:Screen)=>void;onCommitted:()=>void}){
 const [view,setView]=useState(()=>journey.view()),[error,setError]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[passages,setPassages]=useState<string[]>([]),[correcting,setCorrecting]=useState(false);
 const lock=useRef(false);const mounted=useRef(true);const state=journey.state,session=journey.active,attempt=session?.attemptId?state.attempts[session.attemptId]:null;
 const load=useCallback(async()=>{const next=await journey.prepare();if(mounted.current)setView(next);},[journey]);
 useEffect(()=>{
  mounted.current=true;let timer:ReturnType<typeof setTimeout>;
  const refresh=()=>{if(document.visibilityState==='visible')void load().catch(e=>{if(mounted.current)setError(e.message);});};
  const tick=()=>{refresh();const now=Date.now(),riyadhDay=86400000;const untilMidnight=riyadhDay-((now+3*3600000)%riyadhDay)+20;timer=setTimeout(tick,Math.min(60000,untilMidnight));};
  tick();window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
  return()=>{mounted.current=false;clearTimeout(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
 },[load,screen]);
 const showText=!!session&&(session.phase==='training'||session.phase==='assessment'||session.phase==='recall'&&!!attempt?.revealed);
 useEffect(()=>{let live=true;setPassages([]);if(showText&&session)void journey.text(session.unitId).then(text=>{if(live)setPassages(text);}).catch(e=>setError(e.message));return()=>{live=false;};},[journey,showText,session?.unitId,session?.phase]);
 const run=async(action:()=>Promise<unknown>,next?:Screen)=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setStatus('جارٍ تأكيد الحفظ…');
  try{await action();setView(journey.view());setStatus('حُفظت النتيجة على هذا الجهاز.');onCommitted();if(next&&mounted.current)go(next);}
  catch(e){setError(e instanceof Error?e.message:'تعذر الحفظ. أعد المحاولة؛ لا نعرض إنجازًا غير محفوظ.');setStatus('لم يُؤكد الحفظ.');}
  finally{lock.current=false;setBusy(false);}
 };
 const assess=async(choice:QuickObservation)=>{
  if(!correcting){await journey.quick(choice);return;}
  if(!attempt)return;const words=journey.unit(attempt.unitId).unit.words;
  const observation:ManualObservation={attemptedWords:choice.startsWith('clean-')?words:null,errors:choice.startsWith('clean-')?0:null,completion:choice.startsWith('clean-')?'complete':choice==='memory-failure'?'partial':'unknown',effort:choice==='clean-hard'?'hard':choice==='clean-normal'?'normal':choice==='clean-easy'?'easy':'unknown',gapVerified:false};
  await journey.action({type:'correct',attemptId:attempt.id,revision:attempt.revision,reason:'تصحيح خيار سجلته خطأ في التقييم الذاتي',observation});setCorrecting(false);
 };
 const home=screen==='S05',progress=screen==='S14';
 return <section aria-label="رحلة الحفظ والمراجعة الذاتية" className="learning-journey">
  <Heading eyebrow="مُلازَمَة" title={home?'وردك اليوم':progress?'تقدمي':session?'جلسة التعاهد':'متابعة التعاهد'} description="تقييمك ذاتي؛ ليس شهادة إتقان أو فحصًا آليًا للتلاوة." />
  {journey.kind==='engineering'&&<Notice tone="warning">اختبار هندسي معزول. المادة المعروضة ليست نصًا قرآنيًا، ولا تتيح هذه النسخة تجربة قرآنية للمستخدمين.</Notice>}
  {error&&<p role="alert">{error}</p>}
  <p role="status" aria-live="polite">{status}</p>
  {home&&<Card className="next-card"><h2>خطوتك التالية</h2>
   {session?<><p>جلستك محفوظة. نكمل من آخر خطوة مؤكدة.</p><Button disabled={busy} onClick={()=>go('S10')}>استأنف جلستك</Button></>:view.next?<><h3>{journey.unit(view.next.unitId).title}</h3><p>{view.next.kind==='new'?'حفظ جديد':view.next.kind==='diagnostic'?'تسميع أول لمحفوظك المعلن':view.next.kind==='repair'?'تعاهد بعد تعثر سجلته':'مراجعة مستحقة'}</p><Button disabled={busy} onClick={()=>run(()=>journey.start(),'S07')}>ابدأ وردك</Button></>:<><p>{view.completed?'أنجزت نشاط اليوم. موعد التعاهد التالي محفوظ.':view.budget===0?'لا وقت مخصص لليوم؛ عدّل وقتك إن رغبت.':'لا نشاط متاح ضمن الخطة الحالية.'}</p><Button variant="secondary" onClick={()=>go('S02')}>عدّل هدفك ووقتك</Button></>}
   <p>أنشطة أُنجزت اليوم: {view.completed} · المتبقي: {view.remaining} · المؤجل: {view.deferred}</p>
   <p>الوقت المتاح: {view.budget} دقيقة. تقدير زمن النشاط يخضع لسياسة الخطة؛ لا نطلب منك إدخاله.</p>
  </Card>}
  {(home||progress)&&<Card><h2>من سجل تسميعك</h2><p>نتائج محفوظة: <output aria-label="عدد نتائج التسميع">{view.observations}</output></p><p>مواضع سُمّعت كاملة بلا خطأ معلوم وفق تقريرك الحالي: {view.successfulCoverage} — دون تكرار الموضع.</p><p>ثبات الحفظ: يحتاج إلى تسميعات إضافية لتقديره.</p><p>المحفوظ المعلن لا يتحول إلى إتقان مثبت.</p>{view.due.length>0&&<><h3>التعاهد القادم</h3><ul>{view.due.map(d=><li key={d.unitId}>{journey.unit(d.unitId).title} — {date(d.at)}</li>)}</ul></>}{view.weak.length>0&&<><h3>مواضع تعثرت فيها بحسب نتائجك</h3><ul>{view.weak.map(title=><li key={title}>{title}</li>)}</ul><p>هذا وصف لنتائج مسجلة، وليس حكمًا بضعف ثابت.</p></>}{home&&<Button variant="secondary" onClick={()=>go('S14')}>عرض تقدمي</Button>}</Card>}
  {!home&&!progress&&<Card>
   {!session?<><p>لا توجد جلسة مفتوحة.</p><Button onClick={()=>go('S05')}>إلى ورد اليوم</Button></>:<>
    <h2>{journey.unit(session.unitId).title}</h2>
    {showText&&<div className="quran-session-text" aria-label={journey.kind==='engineering'?'مادة الاختبار الصناعي':'النص القرآني المعتمد'}>{passages.map((text,i)=><p key={i}>{text}</p>)}</div>}
    {session.phase==='training'&&<><div className="repetition-counter" aria-label="عداد تكرار الحفظ"><p className="repetition-counter-label">عداد التكرار</p><output className="repetition-counter-value" aria-label="عدد التكرارات المحفوظة">{session.repetitions.toLocaleString('ar-SA')}</output><p className="repetition-counter-note">كل ضغطة تُحفظ في سجل الجلسة قبل تحديث العدد.</p><div className="actions"><Button disabled={busy} variant="secondary" onClick={()=>run(()=>journey.action({type:'repeat',sessionId:session.id,mode:'reading'}))}><span aria-hidden="true">+</span> أنهيت تكرارًا</Button><Button disabled={busy} onClick={()=>run(()=>journey.action({type:'recall',sessionId:session.id,attemptId:crypto.randomUUID()}),'S08')}>ابدأ التسميع الذاتي</Button></div></div></>}
    {(session.phase==='recall'||session.phase==='paused'&&session.previousPhase==='recall')&&journey.needsRestart&&<><Notice>انقطع التسميع. نحتفظ بما سبق، وتحتاج إلى محاولة جديدة كي لا نفترض أنك أكملته.</Notice><Button disabled={busy} onClick={()=>run(()=>journey.action({type:'restart',sessionId:session.id,attemptId:crypto.randomUUID()}),'S08')}>ابدأ محاولة جديدة بعد الانقطاع</Button></>}
    {session.phase==='recall'&&!journey.needsRestart&&<><p>سمّع من الذاكرة، ثم اختر الوصف المطابق لما حدث. لا تسجيل صوتي أو تقييم آلي.</p>{attempt?.revealed&&<Notice tone="warning">سُجل كشف النص، ولا يلغيه اختيار جهد سهل أو تصحيح الوصف.</Notice>}<Button disabled={busy} variant="secondary" onClick={()=>run(()=>journey.action({type:'hint',sessionId:session.id,reveal:true}))}>أظهر النص وسجّل المساعدة</Button></>}
    {((session.phase==='recall'&&!journey.needsRestart)||(session.phase==='assessment'&&!attempt?.assessment)||correcting)&&<fieldset disabled={busy}><legend>{correcting?'اختر النتيجة الصحيحة — يبقى الأصل في السجل':'عند انتهاء التسميع، اختر النتيجة لحفظها مباشرة'}</legend><div className="self-assessment-choices">{choices.map(c=><Button key={c.id} variant="secondary" onClick={()=>run(()=>assess(c.id),'S09')}>{c.label}</Button>)}</div></fieldset>}
    {session.phase==='assessment'&&attempt?.assessment&&!correcting&&<><h3>حُفظ تقييمك الذاتي</h3><p>{attempt.assessment.completion==='complete'?'أبلغت عن تسميع كامل.':attempt.assessment.completion==='partial'?'أبلغت عن تسميع جزئي.':'اكتمال التسميع غير معلوم.'} المساعدة المسجلة: {attempt.hints}.</p><p>تُحسب هذه المحاولة مرة واحدة، والتصحيح يعيد حساب نتيجتها الأصلية.</p><div className="actions"><Button disabled={busy} onClick={()=>run(async()=>{await journey.finish();await journey.prepare();},'S05')}>تابع إلى النشاط التالي</Button><Button variant="secondary" disabled={busy} onClick={()=>setCorrecting(true)}>صحّح النتيجة</Button></div></>}
    {session.phase==='paused'&&session.previousPhase!=='recall'&&<Button disabled={busy} onClick={()=>run(()=>journey.action({type:'resume',sessionId:session.id}),'S07')}>استأنف من الخطوة المحفوظة</Button>}
    {session.phase!=='paused'&&<Button variant="ghost" disabled={busy} onClick={()=>run(()=>journey.action({type:'pause',sessionId:session.id}),'S10')}>أوقف مؤقتًا</Button>}
    <Button variant="ghost" disabled={busy} onClick={()=>run(()=>journey.finish(),'S05')}>أنهِ الجلسة</Button>
   </>}
  </Card>}
 </section>;
}
