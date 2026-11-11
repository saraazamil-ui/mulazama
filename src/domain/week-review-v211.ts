import {addCivilDays, unionRanges, type Interval} from './taahud-v211';

export type WeekCompletion = Readonly<{id:string;completedAt:string;ranges:readonly Interval[]}>;
export type WeekReviewSnapshot = Readonly<{weekStart:string;startedAt:string;zoneId:string;sourceWatermark:string;sourceCompletionIds:string[];ranges:Interval[]}>;
function localDate(instant:string,zoneId:string):string {
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(instant))throw new Error('INVALID_INPUT');
 const parsed=new Date(instant);if(!Number.isFinite(parsed.getTime()))throw new Error('INVALID_INPUT');
 try {const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zoneId,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(parsed);
  const part=(name:string)=>parts.find(x=>x.type===name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
 } catch {throw new Error('INVALID_INPUT');}
}
/** Build one immutable-by-value Friday snapshot. Persistence and idempotency belong to the caller. */
export function createWeekReviewSnapshot(input:{startedAt:string;zoneId:string;sourceWatermark:string;completions:readonly WeekCompletion[]}):WeekReviewSnapshot {
 if(!input.sourceWatermark)throw new Error('INVALID_INPUT');
 const local=localDate(input.startedAt,input.zoneId),day=new Date(local+'T00:00:00Z').getUTCDay();
 if(day!==5)throw new Error('FRIDAY_REQUIRED');
 const weekStart=addCivilDays(local,-6),cutoff=Date.parse(input.startedAt),ids=new Set<string>();
 const included:WeekCompletion[]=[];
 for(const c of input.completions){
  if(!c.id||ids.has(c.id))throw new Error('INVALID_INPUT');ids.add(c.id);
  const date=localDate(c.completedAt,input.zoneId);const ranges=unionRanges(c.ranges);
  if(date>=weekStart&&date<=local&&Date.parse(c.completedAt)<=cutoff)included.push({...c,ranges});
 }
 return {weekStart,startedAt:input.startedAt,zoneId:input.zoneId,sourceWatermark:input.sourceWatermark,sourceCompletionIds:included.map(x=>x.id).sort(),ranges:unionRanges(included.flatMap(x=>x.ranges))};
}
