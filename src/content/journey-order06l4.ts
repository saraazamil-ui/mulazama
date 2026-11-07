import { DomainError } from '../core/types';
import type { ContentToken } from './content-gate';
const key=(token:ContentToken)=>`${token.surah}:${token.ayah}:${token.tokenIndex}`;
const fields:readonly (keyof ContentToken)[]=['surah','ayah','tokenIndex','sourceStart','sourceEnd','page','juz','hizb','rub'];
/** HME's ordered ranges must retain the verified global source order.
 * This checks selection integrity, never Quran approval or memorization criteria.
 * Ordered gaps are allowed by the range contract; they do not prove continuity. */
export function validateJourneySourceOrder(tokens:readonly ContentToken[],source:readonly ContentToken[]){
  const index=new Map(source.map((token,i)=>[key(token),{i,token}]));
  if(!tokens.length||index.size!==source.length)throw new DomainError('CONTENT_INTEGRITY_FAILURE','خريطة مواضع الجلسة غير صالحة.');
  let previous=-1;let hasGaps=false;
  for(const token of tokens){
    const match=index.get(key(token));
    // resolve() adds an exact source text slice; compare the map fields, not that derived field.
    if(!match||match.i<=previous||fields.some(field=>match.token[field]!==token[field]))throw new DomainError('CONTENT_INTEGRITY_FAILURE','ترتيب مواضع الجلسة أو حدودها لا يطابق المصدر المعتمد.');
    if(previous>=0&&match.i!==previous+1)hasGaps=true;
    previous=match.i;
  }
  return {hasGaps};
}
