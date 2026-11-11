/** TAAHUD-POLICY-1.0: deterministic, synthetic-testable scheduling primitives.
 * This module neither writes learner history nor replaces the existing FSRS scheduler.
 * Integration, manual-overlap resolution and approval gates remain separate work.
 */
export type Interval = Readonly<{start:number; end:number}>; // ordinal, end exclusive
export type Reservation = Readonly<{id:string; dueDate:string; ranges:readonly Interval[]}>;
export type DayAssignment = Readonly<{date:string; ranges:Interval[]; count:number}>;
const fail=()=>{throw new Error('INVALID_INPUT');};
function dateParts(date:string): Date {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail();
 const d=new Date(date+'T00:00:00Z');
 if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==date) return fail();
 return d;
}
export function addCivilDays(date:string,days:number):string {
 if(!Number.isSafeInteger(days))return fail();
 const d=dateParts(date);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);
}
export function unionRanges(input:readonly Interval[]):Interval[] {
 const sorted=input.map(r=>{if(!Number.isSafeInteger(r.start)||!Number.isSafeInteger(r.end)||r.start<0||r.end<=r.start) return fail();return {start:r.start,end:r.end};}).sort((a,b)=>a.start-b.start||a.end-b.end);
 const out:Interval[]=[];
 for(const r of sorted){const last=out.at(-1);if(last&&r.start<=last.end)out[out.length-1]={start:last.start,end:Math.max(last.end,r.end)};else out.push(r);}
 return out;
}
export function subtractRanges(input:readonly Interval[],excluded:readonly Interval[]):Interval[] {
 let remaining=unionRanges(input);
 for(const x of unionRanges(excluded)) remaining=remaining.flatMap(r=>x.end<=r.start||x.start>=r.end?[r]:[...(r.start<x.start?[{start:r.start,end:x.start}]:[]),...(x.end<r.end?[{start:x.end,end:r.end}]:[])]);
 return remaining;
}
export function distributeTaahud(input:{ranges:readonly Interval[];cycleDays:number;anchorDate:string;reservations?:readonly Reservation[]}):{policyVersion:'TAAHUD-POLICY-1.0';assignments:DayAssignment[];reservations:Reservation[]} {
 const {cycleDays,anchorDate}=input;dateParts(anchorDate);
 if(!Number.isSafeInteger(cycleDays)||cycleDays<1||cycleDays>366) return fail();
 const covered=unionRanges(input.ranges);
 const reservations=(input.reservations??[]).map(r=>{if(!r.id) return fail();dateParts(r.dueDate);const ranges=unionRanges(r.ranges);if(subtractRanges(ranges,covered).length) return fail();return {id:r.id,dueDate:r.dueDate,ranges};});
 const manual=reservations.flatMap(r=>r.ranges);
 const rawManual=manual.reduce((n,r)=>n+r.end-r.start,0),uniqueManual=unionRanges(manual).reduce((n,r)=>n+r.end-r.start,0);
 if(rawManual!==uniqueManual)throw new Error('SCHEDULE_CONFLICT');
 const auto=subtractRanges(covered,manual),total=auto.reduce((n,r)=>n+r.end-r.start,0);
 const q=Math.floor(total/cycleDays),remainder=total%cycleDays;
 const counts=Array.from({length:cycleDays},()=>q);
 for(let k=0;k<remainder;k++) counts[Math.floor(k*cycleDays/remainder)]++;
 let index=0,cursor=auto[0]?.start??0;
 const assignments=counts.map((count,d)=>{let left=count;const ranges:Interval[]=[];
  while(left>0){const r=auto[index];const take=Math.min(left,r.end-cursor);ranges.push({start:cursor,end:cursor+take});cursor+=take;left-=take;if(cursor===r.end){index++;cursor=auto[index]?.start??0;}}
  return {date:addCivilDays(anchorDate,d),ranges,count};});
 return {policyVersion:'TAAHUD-POLICY-1.0',assignments,reservations};
}
/** A partial completion does not move, erase, or silently complete the remainder. */
export function partialCompletion(input:{dueDate:string;actualLocalDate:string;cycleDays:number;scheduled:readonly Interval[];completed:readonly Interval[]}) {
 dateParts(input.dueDate);dateParts(input.actualLocalDate);
 if(!Number.isSafeInteger(input.cycleDays)||input.cycleDays<1||input.cycleDays>366)return fail();
 const scheduled=unionRanges(input.scheduled),completed=unionRanges(input.completed);
 if(subtractRanges(completed,scheduled).length)return fail();
 return {remaining:{dueDate:input.dueDate,ranges:subtractRanges(scheduled,completed)},proposedNext:completed.length?{dueDate:addCivilDays(input.actualLocalDate,input.cycleDays),ranges:completed}:null};
}
