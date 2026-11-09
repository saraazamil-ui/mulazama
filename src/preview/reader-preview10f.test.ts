import {describe,it,expect} from 'vitest';
import {createReaderPreviewMaterial} from './reader-preview-material10f';
import {readerPreviewDatabase,readerPreviewOriginAllowed,READER_PREVIEW_DATABASE_KEY} from './reader-preview-policy10f';
import {createEngineeringJourneyMaterial} from '../content/journey-material06l3';

describe('private non-Quran reader preview',()=>{
  it('binds each of twelve selectable rows to the same existing journey unit and page',async()=>{
    const {units,material,mushaf}=await createReaderPreviewMaterial();
    expect(mushaf.kind).toBe('engineering');expect(mushaf.pages).toHaveLength(6);expect(mushaf.surahs).toHaveLength(3);
    for(const [i,verse] of mushaf.verses.entries()){
      expect(verse.tokenKeys).toEqual(units[i].coverage);
      expect(material.units[i].positions[0]).toEqual({surah:verse.surah,ayah:verse.ayah,page:verse.startPage,juz:verse.juz});
      expect(material.units[i].passages).toEqual(['مادة تدريب صناعية للاختبار فقط وليست نصًا قرآنيًا.']);
    }
    for(const page of mushaf.pages){const image=await mushaf.pageImage(page.number);expect(image.type).toBe('image/png');expect(image.size).toBe(page.asset.bytes);}
  });
  it('keeps a stable isolated identity across reopen without touching existing storage',()=>{
    const values=new Map([['ordinary-user-setting','retained']]);
    const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}};
    const name=readerPreviewDatabase(storage,()=> '11111111-1111-4111-8111-111111111111');
    expect(readerPreviewDatabase(storage,()=>{throw Error('unexpected replacement');})).toBe(name);
    expect(values.get('ordinary-user-setting')).toBe('retained');expect(values.size).toBe(2);
  });
  it('refuses a forged preview database key instead of opening or replacing learner storage',()=>{
    let writes=0;
    const storage={getItem:(key:string)=>key===READER_PREVIEW_DATABASE_KEY?'mulazama-learning-v1':null,setItem:()=>{writes++;}};
    expect(()=>readerPreviewDatabase(storage)).toThrow('هوية سجل التجربة');expect(writes).toBe(0);
  });
  it('restricts the synthetic entry to the exact private preview origin and loopback',()=>{
    expect(readerPreviewOriginAllowed('https://mulazama-preview-05a.sara-a-zamil.chatgpt.site')).toBe(true);
    expect(readerPreviewOriginAllowed('http://127.0.0.1:4181')).toBe(true);
    for(const url of ['https://mulazama.com','https://www.mulazama.com','https://mulazama-preview-05a.sara-a-zamil.chatgpt.site.attacker.invalid','https://other.chatgpt.site','not-a-url'])expect(readerPreviewOriginAllowed(url)).toBe(false);
  });
  it('rejects malformed synthetic layout rather than assigning a wrong selection to the journey',async()=>{
    const {units}=await createReaderPreviewMaterial();
    expect(()=>createEngineeringJourneyMaterial(units,{pages:Array(12).fill(1),positions:[{surah:2,ayah:1,juz:1}]})).toThrow();
    expect(()=>createEngineeringJourneyMaterial(units,{pages:Array(12).fill(1),positions:Array(12).fill({surah:0,ayah:1,juz:1})})).toThrow();
  });
});
