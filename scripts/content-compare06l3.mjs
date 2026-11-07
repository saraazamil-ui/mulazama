/** Quarantined comparison only. Never installs content, changes Quran text, or grants approval. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadContentAudit } from './content-audit-loader.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function readQpcResponse06l3(bytes, expectedSHA256) {
  if (!(bytes instanceof Uint8Array) || bytes.length > 32 * 1024 * 1024) throw Error('REFERENCE_HASH_MISMATCH');
  // Bind the data actually parsed to the hash, even if a caller mutates its buffer during the await.
  const pinnedBytes = new Uint8Array(bytes);
  if (!/^[a-f0-9]{64}$/.test(expectedSHA256) || sha(pinnedBytes) !== expectedSHA256) throw Error('REFERENCE_HASH_MISMATCH');
  const { decodeSourceUtf8 } = await loadContentAudit();
  const body = JSON.parse(decodeSourceUtf8(pinnedBytes));
  if (!body || !Array.isArray(body.verses) || body.verses.length !== 6236) throw Error('COMPLETE_QPC_RESPONSE_REQUIRED');
  const seen = new Set(); let previousSurah = 0, previousAyah = 0;
  return body.verses.map((verse, index) => {
    if (!verse || verse.id !== index + 1 || typeof verse.verse_key !== 'string' || !/^[1-9][0-9]*:[1-9][0-9]*$/.test(verse.verse_key) || typeof verse.text_qpc_hafs !== 'string' || !verse.text_qpc_hafs || /[\u0000-\u001f\u007f\ufffd]/u.test(verse.text_qpc_hafs)) throw Error('QPC_FIELD_AND_ID_REQUIRED');
    // The provider documents fallback to text_uthmani for unsupported scripts: never accept it here.
    if ('text_uthmani' in verse) throw Error('UNEXPECTED_SCRIPT_FALLBACK');
    const [surah, ayah] = verse.verse_key.split(':').map(Number);
    if (!Number.isSafeInteger(surah) || !Number.isSafeInteger(ayah) || surah > 114 || ayah > 286 || seen.has(verse.verse_key) || surah < previousSurah || (surah === previousSurah && ayah <= previousAyah)) throw Error('REFERENCE_ORDER_OR_DUPLICATE');
    seen.add(verse.verse_key); previousSurah = surah; previousAyah = ayah;
    return { surah, ayah, text: verse.text_qpc_hafs };
  });
}
function cp(char) { return char === undefined ? null : 'U+' + char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'); }
function inventory(records) {
  const counts = new Map(); for (const { text } of records) for (const c of text) counts.set(c.codePointAt(0), (counts.get(c.codePointAt(0)) ?? 0) + 1);
  return [...counts].sort((a,b)=>a[0]-b[0]).map(([point,count])=>({codepoint:cp(String.fromCodePoint(point)),count}));
}
export function compareQuarantinedRecords06l3(primary, reference) {
  const p = new Map(primary.map(r=>[`${r.surah}:${r.ayah}`,r.text]));
  const q = new Map(reference.map(r=>[`${r.surah}:${r.ayah}`,r.text]));
  if (p.size !== primary.length || q.size !== reference.length) throw Error('DUPLICATE_COMPARISON_KEY');
  const rows = [];
  for (const key of new Set([...p.keys(), ...q.keys()])) {
    const left=p.get(key),right=q.get(key);
    if (left===undefined || right===undefined) { rows.push({key,status:'missing',missing:left===undefined?'primary':'reference'});continue; }
    const a=[...left], b=[...right];let prefix=0;while(prefix<Math.min(a.length,b.length)&&a[prefix]===b[prefix])prefix++;
    rows.push({key,status:left===right?'exact':'different',primarySHA256:sha(Buffer.from(left)),referenceSHA256:sha(Buffer.from(right)),primaryCodepoints:a.length,referenceCodepoints:b.length,firstDifference:left===right?null:{index:prefix,primary:cp(a[prefix]),reference:cp(b[prefix])}});
  }
  return {mode:'exact-codepoint-per-ayah',normalized:false,sourceRewritten:false,keysCompared:rows.filter(r=>r.status!=='missing').length,exact:rows.filter(r=>r.status==='exact').length,different:rows.filter(r=>r.status==='different').length,missing:rows.filter(r=>r.status==='missing').length,rows};
}
export async function runContentComparison06l3({referencePath,root=process.cwd()}) {
  const { decodeSourceUtf8,parseIndexedAyahSource }=await loadContentAudit();
  const original = await readFile(resolve(root,'content/06l2/tanzil-uthmani-1.1.txt'));
  const primaryReceipt=JSON.parse(await readFile(resolve(root,'content/06l2/download-receipt.json'),'utf8'));
  if(sha(original)!==primaryReceipt.sha256)throw Error('PRIMARY_HASH_MISMATCH');
  const parsed=parseIndexedAyahSource(decodeSourceUtf8(original));if(parsed.issues.length)throw Error('PRIMARY_RECORDS_INVALID');
  const receipt=JSON.parse(await readFile(resolve(root,'content/06l3/reference-receipt.json'),'utf8'));
  const raw=await readFile(referencePath), reference=await readQpcResponse06l3(raw,receipt.responseSHA256);
  const exact=compareQuarantinedRecords06l3(parsed.records,reference);
  const toArabicDigits=n=>String(n).replace(/\d/g,d=>String.fromCodePoint(0x660+Number(d)));
  const numberedSuffixes=reference.filter(r=>r.text.endsWith('\u00a0'+toArabicDigits(r.ayah))).length;
  return {phase:'06-L3',checkedAt:new Date().toISOString(),kind:'content-diagnostic-comparison-not-approval',source:{path:'content/06l2/tanzil-uthmani-1.1.txt',sha256:sha(original),publisher:'Tanzil',version:'1.1'},reference:{url:receipt.endpoint,field:'text_qpc_hafs',sha256:sha(raw),apiVersion:'v4',datasetVersion:null,rawIncludedInDelivery:false},comparison:exact,observations:{referenceRecordsEndingInNBSPlusOwnArabicAyahNumber:numberedSuffixes,explanation:'The reference field includes per-ayah number suffixes. Original representations are compared as supplied; no suffixes, marks, tatweel, or normalization are changed to manufacture a match.'},unicode:{primary:inventory(parsed.records),reference:inventory(reference)},independentReleaseComparison:{status:'blocked',reasons:['Dataset edition/version and independent lineage are not certified by the response','The two source representations differ; exact equality is not established','Raw API redistribution and offline packaging permission are not established','No qualified product content sign-off or approved font/catalog']},scientificApproval:false,productionActivation:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1];
 if(!args.includes('--reference'))throw Error('Pass --reference <authorized raw response file>; raw reference is intentionally not bundled.');
 const report=await runContentComparison06l3({referencePath:resolve(arg('--reference'))});
 const output=resolve(args.includes('--output')?arg('--output'):'docs/06l3/evidence/content-comparison.json');await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({keysCompared:report.comparison.keysCompared,exact:report.comparison.exact,different:report.comparison.different,missing:report.comparison.missing,approval:false,output}));process.exitCode=2;
}
