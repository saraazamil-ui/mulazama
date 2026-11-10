import { describe, expect, it } from 'vitest';
import { engineeringDatabaseIdentity } from './engineering-identity';

describe('synthetic database identity', () => {
 it('reuses the same identity after a new page session', () => {
  const storage = new Map<string,string>();
  const local = {getItem:(key:string)=>storage.get(key)??null, setItem:(key:string,value:string)=>storage.set(key,value)};
  const first = engineeringDatabaseIdentity(local,()=> '12345678-1234-1234-1234-123456789abc');
  expect(engineeringDatabaseIdentity(local,()=>{throw Error('should reuse identity');})).toBe(first);
 });
 it('never accepts a production database as a synthetic identity', () => {
  const storage = new Map([['mulazama-engineering-db-06l3','mulazama-learning-v1']]);
  const local = {getItem:(key:string)=>storage.get(key)??null, setItem:(key:string,value:string)=>storage.set(key,value)};
  expect(engineeringDatabaseIdentity(local,()=> '12345678-1234-1234-1234-123456789abc')).toBe('mulazama-engineering-06l3-12345678-1234-1234-1234-123456789abc');
 });
});
