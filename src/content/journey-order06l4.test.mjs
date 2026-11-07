// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {validateJourneySourceOrder} from './journey-order06l4';
const source=Array.from({length:5},(_,i)=>({surah:1,ayah:Math.floor(i/2)+1,tokenIndex:i%2,sourceStart:i*3,sourceEnd:i*3+2,page:1,juz:1,hizb:1,rub:1}));
describe('L4 source-relative ordered range integrity',()=>{
 it('accepts the exact verified sequence without changing bytes or positions',()=>{const before=structuredClone(source);expect(validateJourneySourceOrder(source,source)).toEqual({hasGaps:false});expect(source).toEqual(before);});
 it('accepts the derived text field returned by ContentGate.resolve',()=>expect(validateJourneySourceOrder(source.map(t=>({...t,text:'synthetic slice'})),source)).toEqual({hasGaps:false}));
 for(const [name,indices] of [['reversed ayahs',[2,3,0,1]],['reversed tokens',[1,0]],['overlap',[0,1,1,2]],['duplicate range',[0,1,0,1]]])it('refuses '+name+' even if caller coverage mirrors it',()=>expect(()=>validateJourneySourceOrder(indices.map(i=>source[i]),source)).toThrow(expect.objectContaining({code:'CONTENT_INTEGRITY_FAILURE'})));
 it('refuses changed offsets with an otherwise identical canonical identity',()=>expect(()=>validateJourneySourceOrder([{...source[0],sourceEnd:999}],source)).toThrow());
 it('refuses missing positions',()=>expect(()=>validateJourneySourceOrder([{...source[0],ayah:99}],source)).toThrow());
 it('refuses empty units and ambiguous source maps',()=>{expect(()=>validateJourneySourceOrder([],source)).toThrow();expect(()=>validateJourneySourceOrder([source[0]],[source[0],source[0]])).toThrow();});
 it('retains explicitly ordered separate ranges without calling them continuous',()=>{const selection=[source[0],source[3]],before=structuredClone(selection);expect(validateJourneySourceOrder(selection,source)).toEqual({hasGaps:true});expect(selection).toEqual(before);});
});
