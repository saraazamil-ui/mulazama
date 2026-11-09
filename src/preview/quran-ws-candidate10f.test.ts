import {describe,it,expect,vi} from 'vitest';
import {createQuranWsCandidateReview,QURAN_WS_COMMIT} from './quran-ws-candidate10f';

describe('pinned Quran.ws review capability',()=>{
  it('refuses to mint a candidate review capability in production before fetching any asset',async()=>{
    const fetcher=vi.fn();vi.stubEnv('MODE','production');
    try{
      await expect(createQuranWsCandidateReview({fetchAsset:fetcher})).rejects.toMatchObject({code:'CONTENT_INTEGRITY_FAILURE'});
      expect(fetcher).not.toHaveBeenCalled();
    }finally{vi.unstubAllEnvs();}
  });
  it('binds all canonical pages and verse identities without granting learning tokens',async()=>{
    const fetcher=vi.fn();const reader=await createQuranWsCandidateReview({fetchAsset:fetcher});
    expect(reader.kind).toBe('candidate-review');expect(reader.pages).toHaveLength(604);
    expect(reader.verses).toHaveLength(6236);expect(reader.surahs).toHaveLength(114);expect(reader.juzStarts).toHaveLength(30);
    expect(reader.verses.every(v=>v.tokenKeys.length===0)).toBe(true);
    expect(reader.pages.every((p,i)=>p.asset.path.endsWith(`/${QURAN_WS_COMMIT}/mushafs/hafs/kfqc/svg/${String(i+1).padStart(3,'0')}.svg`))).toBe(true);
    expect(reader.pages[0].asset.viewBox).toEqual([-53.3109,-198.4777,345,550]);
    expect(Object.isFrozen(reader.pages[0].asset)).toBe(true);expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects substituted bytes with the right length before creating an image',async()=>{
    let length=0;
    const fetcher=vi.fn(async()=>new Response(new Uint8Array(length),{headers:{'content-type':'image/svg+xml'}}));
    const reader=await createQuranWsCandidateReview({fetchAsset:fetcher});length=reader.pages[0].asset.bytes;
    await expect(reader.pageImage(1)).rejects.toThrow('البصمة');
    expect(fetcher).toHaveBeenCalledWith(reader.pages[0].asset.path,expect.objectContaining({credentials:'omit',redirect:'error',cache:'force-cache'}));
  });
  it('cancels oversized streams before accepting the response',async()=>{
    let length=0;const cancel=vi.fn();
    const fetcher=vi.fn(async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(length+1));},cancel})));
    const reader=await createQuranWsCandidateReview({fetchAsset:fetcher});length=reader.pages[0].asset.bytes;
    await expect(reader.pageImage(1)).rejects.toThrow('تعذر');expect(cancel).toHaveBeenCalledOnce();
  });
  it('rejects a response redirected outside the immutable source',async()=>{
    const response=new Response('untrusted');Object.defineProperty(response,'url',{value:'https://example.org/substituted.svg'});
    const reader=await createQuranWsCandidateReview({fetchAsset:vi.fn(async()=>response)});
    await expect(reader.pageImage(1)).rejects.toThrow('تعذر');
  });
  it('honors cancellation before fetching a page',async()=>{
    const fetcher=vi.fn(),reader=await createQuranWsCandidateReview({fetchAsset:fetcher}),controller=new AbortController();controller.abort();
    await expect(reader.pageImage(1,controller.signal)).rejects.toMatchObject({name:'AbortError'});expect(fetcher).not.toHaveBeenCalled();
  });
});
