/** Executable browser-only storage checks, imported by engineering QA, never by the product entrypoint. */
import { IndexedDbEventStore } from './event-store';
import { VERSIONS, type LearningEvent } from '../core/types';

function event(id: string, commandId = id): LearningEvent {
  return { eventId: id, commandId, operationId: commandId, userId: 'synthetic-local-user', unitId: null,
    type: 'SessionStarted', occurredAt: '2026-11-05T10:00:00.000Z', receivedAt: '2026-11-05T10:00:00.000Z', zoneId: 'Asia/Riyadh', source: 'product', coverage: [], versions: VERSIONS,
    data: { privateMarker: 'SYNTHETIC-SENSITIVE-MARKER', confirmed: true } };
}
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
async function rejected(task: Promise<unknown>, code: string) { try { await task; } catch (e) { assert((e as { code?: string }).code === code, `Expected ${code}, received ${(e as Error).message}`); return; } throw new Error(`Expected rejection ${code}`); }
function req<T>(r: IDBRequest<T>): Promise<T> { return new Promise((resolve,reject) => { r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); }); }
function done(tx: IDBTransaction): Promise<void> { return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);}); }
async function direct(name: string): Promise<IDBDatabase> { return req(indexedDB.open(name)); }
async function remove(name: string) { await req(indexedDB.deleteDatabase(name)); }

export async function runPersistenceChecks(): Promise<{ name: string; passed: boolean; milliseconds: number }[]> {
  const prefix = 'mulazama-qa-' + crypto.randomUUID(), names: string[] = [], results: {name:string;passed:boolean;milliseconds:number}[]=[];
  const test = async (name: string, run: (dbName: string) => Promise<void>) => {
    const dbName = prefix + '-' + names.length; names.push(dbName); const start=performance.now();
    await run(dbName); results.push({name,passed:true,milliseconds:performance.now()-start});
  };
  try {
    await test('IDB01 commit/reopen/checkpoint raw preservation', async name => {
      let s=await IndexedDbEventStore.open(name); await s.append([event('confirmed-repeat')],0);s.close();
      s=await IndexedDbEventStore.open(name);const snapshot=await s.load();assert(snapshot.revision===1&&snapshot.events.length===1,'Committed repetition was lost');s.close();
    });
    await test('IDB02 duplicate command and event are idempotent; conflicts fail closed', async name => {
      const s=await IndexedDbEventStore.open(name);const batch=[event('a','operation'),event('b','operation')];
      await s.append(batch,0);const retry=await s.append(batch,0);assert(retry.revision===1&&retry.events.length===2,'Duplicate changed stream');
      await rejected(s.append([{...batch[0],data:{changed:true}},batch[1]],1),'EVENT_CONFLICT');
      await rejected(s.append([event('replacement','operation')],1),'EVENT_CONFLICT');assert((await s.load()).events.length===2,'Conflict overwrote history');s.close();
    });
    await test('IDB03 concurrent tabs use transaction CAS', async name => {
      const a=await IndexedDbEventStore.open(name), b=await IndexedDbEventStore.open(name);
      const outcomes=await Promise.allSettled([a.append([event('a')],0),b.append([event('b')],0)]);
      assert(outcomes.filter(x=>x.status==='fulfilled').length===1,'Concurrent writers both committed');
      const failure=outcomes.find(x=>x.status==='rejected') as PromiseRejectedResult;assert(failure.reason.code==='REVISION_CONFLICT','Lost CAS rejection');
      assert((await a.load()).events.length===1,'Concurrent transaction lost update');a.close();b.close();
    });
    await test('IDB04 encrypted records and nonextractable key', async name => {
      const s=await IndexedDbEventStore.open(name);await s.append([event('a')],0);s.close();
      const db=await direct(name),tx=db.transaction(['events','commands','keys'],'readonly'),finished=done(tx);
      const [rows,commands,key]=await Promise.all([req(tx.objectStore('events').getAll()),req(tx.objectStore('commands').getAll()),req(tx.objectStore('keys').get('data-key'))]);await finished;
      assert(!JSON.stringify({rows,commands}).includes('SYNTHETIC-SENSITIVE-MARKER'),'Sensitive payload leaked in index');
      assert(rows[0].encoding==='aes-gcm-v1'&&rows[0].ciphertext.byteLength>16,'Missing authenticated encryption');
      let exportFailed=false;try{await crypto.subtle.exportKey('raw',key.value);}catch{exportFailed=true;}assert(exportFailed,'Data key was exportable');db.close();
    });
    await test('IDB05 transaction write failure cannot acknowledge or partially append', async name => {
      const s=await IndexedDbEventStore.open(name);await s.append([event('prior')],0);
      const original=IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add=function(value:unknown,key?:IDBValidKey){if(this.name==='events'&&(value as {eventId:string}).eventId==='fail')throw new DOMException('Injected storage failure','QuotaExceededError');return original.call(this,value,key!);};
      try {await rejected(s.append([event('would-add'),event('fail')],1),'STORAGE_FULL');}finally{IDBObjectStore.prototype.add=original;}
      const live=await s.load();assert(live.revision===1&&live.events.length===1&&live.events[0].eventId==='prior','Partial transaction survived');s.close();
    });
    await test('IDB06 atomic full replacement, rollback on failure, no restore merge', async name => {
      const s=await IndexedDbEventStore.open(name);await s.append([event('prior')],0);
      const original=IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add=function(value:unknown,key?:IDBValidKey){if(this.name==='events'&&(value as {eventId:string}).eventId==='fail')throw new DOMException('Injected restore failure','QuotaExceededError');return original.call(this,value,key!);};
      try{await rejected(s.replace([event('staged'),event('fail')],1),'STORAGE_FULL');}finally{IDBObjectStore.prototype.add=original;}
      assert((await s.load()).events[0].eventId==='prior','Failed restore removed live data');
      const restored=await s.replace([event('restored')],1);assert(restored.events.length===1&&restored.events[0].eventId==='restored','Restore merged old data');
      const retry=await s.replace([event('restored')],restored.revision);assert(retry.revision===restored.revision&&retry.events.length===1,'Repeated restore duplicated');s.close();
    });
    await test('IDB07 ciphertext corruption rejected and original rows retained', async name => {
      const s=await IndexedDbEventStore.open(name);await s.append([event('a')],0);s.close();
      let db=await direct(name),tx=db.transaction('events','readwrite'),finished=done(tx),store=tx.objectStore('events');
      const row=await req(store.get('a'));const bytes=new Uint8Array(row.ciphertext);bytes[0]^=1;store.put({...row,ciphertext:bytes.buffer});await finished;db.close();
      await rejected(IndexedDbEventStore.open(name),'DATABASE_CORRUPT');
      db=await direct(name);tx=db.transaction('events','readonly');finished=done(tx);const count=await req(tx.objectStore('events').count());await finished;assert(count===1,'Corrupt data was silently reset');db.close();
    });
    await test('IDB08 supported v1 migration encrypts without changing raw events or revision', async name => {
      const opening=indexedDB.open(name,1);opening.onupgradeneeded=()=>{opening.result.createObjectStore('events',{keyPath:'eventId'});opening.result.createObjectStore('meta',{keyPath:'key'});};
      const db=await req(opening),tx=db.transaction(['events','meta'],'readwrite'),finished=done(tx);
      tx.objectStore('events').put({eventId:'legacy',sequence:1,event:event('legacy')});tx.objectStore('meta').put({key:'head',format:1,revision:5,nextSequence:2});await finished;db.close();
      const s=await IndexedDbEventStore.open(name),snapshot=await s.load();assert(snapshot.revision===5&&snapshot.events[0].eventId==='legacy','Migration changed raw history');s.close();
      const migrated=await direct(name),read=migrated.transaction('events','readonly'),completed=done(read),row=await req(read.objectStore('events').get('legacy'));await completed;assert(row.encoding==='aes-gcm-v1'&&!('event' in row),'Legacy plaintext retained');migrated.close();
    });
    await test('IDB09 future database version is preserved and rejected', async name => {
      const opening=indexedDB.open(name,99);opening.onupgradeneeded=()=>opening.result.createObjectStore('future');const db=await req(opening);db.close();
      await rejected(IndexedDbEventStore.open(name),'UNSUPPORTED_VERSION');const check=await direct(name);assert(check.version===99&&check.objectStoreNames.contains('future'),'Future schema overwritten');check.close();
    });
    await test('IDB10 clear keeps revision protection and removes learning rows/indexes', async name => {
      const s=await IndexedDbEventStore.open(name);await s.append([event('a')],0);await rejected(s.clear(0),'REVISION_CONFLICT');await s.clear(1);
      const snapshot=await s.load();assert(snapshot.events.length===0&&snapshot.revision===2,'Clear did not remove stream');s.close();
    });
    await test('IDB11 missing encryption key never triggers replacement key or reset', async name => {
      const s=await IndexedDbEventStore.open(name);await s.append([event('preserved')],0);s.close();
      let db=await direct(name),tx=db.transaction('keys','readwrite'),finished=done(tx);tx.objectStore('keys').delete('data-key');await finished;db.close();
      await rejected(IndexedDbEventStore.open(name),'DATABASE_CORRUPT');
      db=await direct(name);tx=db.transaction(['keys','events'],'readonly');finished=done(tx);const [key,count]=await Promise.all([req(tx.objectStore('keys').get('data-key')),req(tx.objectStore('events').count())]);await finished;
      assert(!key&&count===1,'Missing key caused silent reinitialization');db.close();
    });
    await test('IDB12 interrupted v1 migration resumes from its durable pending marker', async name => {
      const opening=indexedDB.open(name,2);opening.onupgradeneeded=()=>{const db=opening.result;db.createObjectStore('events',{keyPath:'eventId'});db.createObjectStore('commands',{keyPath:'commandId'});db.createObjectStore('meta',{keyPath:'key'});db.createObjectStore('keys',{keyPath:'key'});};
      const db=await req(opening),tx=db.transaction(['events','meta'],'readwrite'),finished=done(tx);
      tx.objectStore('events').put({eventId:'interrupted',sequence:1,event:event('interrupted')});tx.objectStore('meta').put({key:'head',format:2,revision:7,nextSequence:2});tx.objectStore('meta').put({key:'migration-v1',from:1,to:2,status:'pending'});await finished;db.close();
      const s=await IndexedDbEventStore.open(name),snapshot=await s.load();assert(snapshot.revision===7&&snapshot.events[0].eventId==='interrupted','Interrupted upgrade lost the session event');s.close();
      const migrated=await direct(name),read=migrated.transaction('meta','readonly'),completed=done(read),marker=await req(read.objectStore('meta').get('migration-v1'));await completed;assert(!marker,'Migration marker not completed atomically');migrated.close();
    });
    return results;
  } finally { for (const name of names) await remove(name); }
}
