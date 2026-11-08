import { DomainError } from '../core/types';
import type { LearningJourney } from './journey06l3';
import type { JourneyUnit } from '../content/journey-material06l3';

export interface StudyRange { surah:number; fromAyah:number; toAyah:number }
export interface StudySelection { editionId:string; range:StudyRange; unitIds:string[] }
export type StudyPreferenceStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
type Catalogue=Pick<LearningJourney,'catalogUnits'>;
const invalid=(message:string):never=>{throw new DomainError('REFERENCE_MISMATCH',message);};

function edition(catalogue:readonly JourneyUnit[]):string {
  const editions=new Set(catalogue.map(entry=>entry.unit.editionId));
  if(!catalogue.length||editions.size!==1||!catalogue[0].unit.editionId.trim())return invalid('فهرس مقدار الحفظ غير متاح أو يجمع طبعات مختلفة.');
  return catalogue[0].unit.editionId;
}
function validRange(range:StudyRange):void {
  if(!range||!Number.isSafeInteger(range.surah)||range.surah<1||range.surah>114||!Number.isSafeInteger(range.fromAyah)||!Number.isSafeInteger(range.toAyah)||range.fromAyah<1||range.toAyah<range.fromAyah||range.toAyah>1000)throw new DomainError('INVALID_INPUT','اختر سورة وبداية ونهاية صحيحة للمقدار.');
}

/** Resolves only whole existing catalogue units. The verified reader map must separately establish full verse coverage. */
export function resolveStudyRange(journey:Catalogue,range:StudyRange,expectedCoverage?:readonly string[]):string[] {
  validRange(range);
  const catalogue=journey.catalogUnits;edition(catalogue);
  const inside=(position:JourneyUnit['positions'][number])=>position.surah===range.surah&&position.ayah>=range.fromAyah&&position.ayah<=range.toAyah;
  const selected=catalogue.filter(entry=>entry.positions.some(inside)).sort((a,b)=>a.order-b.order);
  if(!selected.length)return invalid('المقدار غير موجود في فهرس الحفظ المعتمد.');
  const ayahs=new Set<number>(),coverage=new Set<string>(),ids=new Set<string>();
  for(const entry of selected){
    if(!entry.positions.every(inside))return invalid('المقدار يقطع وحدة معتمدة؛ اختر حدودها كاملة.');
    if(ids.has(entry.unit.id)||!entry.unit.coverage.length||entry.unit.coverage.length!==entry.unit.words)return invalid('وحدات المقدار غير متوافقة مع خريطة التغطية.');
    ids.add(entry.unit.id);
    for(const position of entry.positions)ayahs.add(position.ayah);
    for(const key of entry.unit.coverage){if(coverage.has(key))return invalid('توجد تغطية مكررة أو ملتبسة في المقدار.');coverage.add(key);}
  }
  for(let ayah=range.fromAyah;ayah<=range.toAyah;ayah++)if(!ayahs.has(ayah))return invalid('توجد آية غير ممثلة في فهرس مقدار الحفظ.');
  if(expectedCoverage!==undefined){
    const actual=selected.flatMap(entry=>entry.unit.coverage);
    if(!Array.isArray(expectedCoverage)||!expectedCoverage.length||new Set(expectedCoverage).size!==expectedCoverage.length||expectedCoverage.some(key=>typeof key!=='string'||!key)||actual.length!==expectedCoverage.length||actual.some((key,index)=>key!==expectedCoverage[index]))return invalid('المقدار لا يطابق جميع مواضع الآيات في خريطة المصحف المتحقق منها.');
  }
  return selected.map(entry=>entry.unit.id);
}

/** A local intent preference, outside learner events and approval state. No constructor or selection writes a learning fact. */
export class MushafStudyController {
  private selection:StudySelection|null=null;
  readonly storageKey:string;
  private readonly editionId:string;
  private readonly profileId:string;
  constructor(private readonly journey:LearningJourney,private readonly options:{databaseName:string;storage:StudyPreferenceStorage;coverageForRange:(range:StudyRange)=>readonly string[]}){
    if(!options.databaseName.trim())throw new DomainError('INVALID_INPUT','هوية تخزين المقدار غير متاحة.');
    if(typeof options.coverageForRange!=='function')throw new DomainError('CONTENT_UNAVAILABLE','خريطة حدود الآيات المتحقق منها غير متاحة.');
    this.editionId=edition(journey.catalogUnits);
    this.profileId=journey.app.product.state.profileId;
    this.storageKey=['mulazama-study-target-10b',options.databaseName,this.profileId,this.editionId].map(encodeURIComponent).join(':');
  }
  private requireProfile(){if(this.journey.app.product.state.profileId!==this.profileId)throw new DomainError('REFERENCE_MISMATCH','تغيّر ملف الحافظ؛ أعد فتح المصحف لاختيار مقدار هذا الملف.');}
  get current():StudySelection|null{return this.journey.app.product.state.profileId===this.profileId&&this.selection?structuredClone(this.selection):null;}
  select(range:StudyRange):StudySelection {
    this.requireProfile();
    validRange(range);
    const captured={surah:range.surah,fromAyah:range.fromAyah,toAyah:range.toAyah};
    const unitIds=resolveStudyRange(this.journey,captured,this.options.coverageForRange(captured));
    const selection={editionId:this.editionId,range:{surah:range.surah,fromAyah:range.fromAyah,toAyah:range.toAyah},unitIds};
    // Store the intent before publishing it to the UI. A failed write leaves the prior target intact.
    this.options.storage.setItem(this.storageKey,JSON.stringify({schemaVersion:1,editionId:this.editionId,range:selection.range}));
    this.journey.setMemorizationTarget(unitIds);this.selection=selection;
    return this.current!;
  }
  restore():StudySelection|null {
    this.requireProfile();
    // Storage failures are surfaced; corrupt/stale preferences are ignored, never repaired into learning events.
    const raw=this.options.storage.getItem(this.storageKey);
    let selection:StudySelection|null=null;
    if(raw!==null){
      try{
        const saved=JSON.parse(raw);
        if(saved?.schemaVersion!==1||saved.editionId!==this.editionId)throw new Error('STALE_READER_TARGET');
        validRange(saved.range);
        const unitIds=resolveStudyRange(this.journey,saved.range,this.options.coverageForRange(saved.range));
        selection={editionId:this.editionId,range:{surah:saved.range.surah,fromAyah:saved.range.fromAyah,toAyah:saved.range.toAyah},unitIds};
      }catch{selection=null;}
    }
    this.journey.setMemorizationTarget(selection?.unitIds??null);this.selection=selection;
    return this.current;
  }
  clear():void {
    this.requireProfile();
    this.options.storage.removeItem(this.storageKey);
    this.journey.setMemorizationTarget(null);this.selection=null;
  }
}
