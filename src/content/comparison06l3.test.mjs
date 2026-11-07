// @vitest-environment node
import { describe,it,expect } from 'vitest';
import { createHash } from 'node:crypto';
import { compareQuarantinedRecords06l3,readQpcResponse06l3 } from '../../scripts/content-compare06l3.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const pair=(text,surah=1,ayah=1)=>({surah,ayah,text});
const response=()=>({verses:Array.from({length:6236},(_,i)=>({id:i+1,verse_key:`${Math.floor(i/60)+1}:${i%60+1}`,text_qpc_hafs:`SYNTHETIC-NON-QURAN-${i}`}))});
const bytes=o=>Buffer.from(JSON.stringify(o));
describe('L3 quarantined comparison, no content authority',()=>{
 it('C3-01 exact comparison preserves the inputs and counts genuine equality',()=>{const a=[pair('TEST')],b=[pair('TEST')];const before=JSON.stringify([a,b]);expect(compareQuarantinedRecords06l3(a,b)).toMatchObject({exact:1,different:0,missing:0,normalized:false,sourceRewritten:false});expect(JSON.stringify([a,b])).toBe(before);});
 it('C3-02 combining-mark order is not normalized into equality',()=>{const r=compareQuarantinedRecords06l3([pair('a\u0301\u0323')],[pair('a\u0323\u0301')]);expect(r).toMatchObject({exact:0,different:1});expect(r.rows[0].firstDifference.index).toBe(1);});
 it('C3-03 reference numbering suffix is not silently removed',()=>expect(compareQuarantinedRecords06l3([pair('TEST')],[pair('TEST\u00a0\u0661')])).toMatchObject({exact:0,different:1}));
 it('C3-04 missing identifiers remain explicit',()=>expect(compareQuarantinedRecords06l3([pair('TEST')],[pair('TEST',1,2)])).toMatchObject({missing:2,keysCompared:0}));
 it('C3-05 duplicate identifiers are refused before comparison',()=>expect(()=>compareQuarantinedRecords06l3([pair('A'),pair('B')],[])).toThrow('DUPLICATE_COMPARISON_KEY'));
 it('C3-06 hashes, length and first codepoint difference reveal no reconstructed reference text',()=>{const r=compareQuarantinedRecords06l3([pair('TEST-A')],[pair('TEST-B')]);expect(r.rows[0]).toMatchObject({primaryCodepoints:6,referenceCodepoints:6,firstDifference:{index:5,primary:'U+0041',reference:'U+0042'}});expect(JSON.stringify(r)).not.toContain('TEST-B');});
 it('C3-07 QPC field parses a full synthetic transport with pinned bytes',async()=>{const b=bytes(response());expect(await readQpcResponse06l3(b,hash(b))).toHaveLength(6236);});
 it('C3-08 wrong pinned bytes are refused',async()=>{const b=bytes(response());await expect(readQpcResponse06l3(b,'0'.repeat(64))).rejects.toThrow('REFERENCE_HASH_MISMATCH');});
 it('C3-09 incomplete response is refused',async()=>{const o=response();o.verses.pop();const b=bytes(o);await expect(readQpcResponse06l3(b,hash(b))).rejects.toThrow('COMPLETE_QPC_RESPONSE_REQUIRED');});
 it('C3-10 unsupported-script fallback cannot masquerade as QPC',async()=>{const o=response();o.verses[0].text_uthmani=o.verses[0].text_qpc_hafs;const b=bytes(o);await expect(readQpcResponse06l3(b,hash(b))).rejects.toThrow('UNEXPECTED_SCRIPT_FALLBACK');});
 it('C3-11 duplicate reference keys are refused',async()=>{const o=response();o.verses[1].verse_key=o.verses[0].verse_key;const b=bytes(o);await expect(readQpcResponse06l3(b,hash(b))).rejects.toThrow('REFERENCE_ORDER_OR_DUPLICATE');});
 it('C3-12 malformed UTF8 is not repaired',async()=>{const b=Buffer.from([0xc0,0xaf]);await expect(readQpcResponse06l3(b,hash(b))).rejects.toThrow();});
 it('C3-13 unavailable expected field is refused',async()=>{const o=response();delete o.verses[0].text_qpc_hafs;const b=bytes(o);await expect(readQpcResponse06l3(b,hash(b))).rejects.toThrow('QPC_FIELD_AND_ID_REQUIRED');});
 it('C3-15 caller mutation after call cannot replace hash-checked source bytes',async()=>{const b=bytes(response());const pending=readQpcResponse06l3(b,hash(b));b.fill(0);expect(await pending).toHaveLength(6236);});
 it('C3-14 unsafe surah identifier is refused',async()=>{const o=response();o.verses[0].verse_key='115:1';const b=bytes(o);await expect(readQpcResponse06l3(b,hash(b))).rejects.toThrow('REFERENCE_ORDER_OR_DUPLICATE');});
});
