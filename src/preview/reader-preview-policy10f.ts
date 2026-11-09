export const READER_PREVIEW_ORIGIN = 'https://mulazama-preview-05a.sara-a-zamil.chatgpt.site';
export const READER_PREVIEW_DATABASE_KEY = 'mulazama-reader-preview-db-10f';
const databasePattern = /^mulazama-reader-preview-10f-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** Private-preview identity cannot select the ordinary learner database. */
export function readerPreviewDatabase(storage: Pick<Storage, 'getItem'|'setItem'>, uuid:()=>string = ()=>crypto.randomUUID()): string {
  const existing = storage.getItem(READER_PREVIEW_DATABASE_KEY);
  if (existing !== null) {
    if (!databasePattern.test(existing)) throw Error('تعذر التحقق من هوية سجل التجربة. لم نمسح أي بيانات.');
    return existing;
  }
  const name = `mulazama-reader-preview-10f-${uuid()}`;
  if (!databasePattern.test(name)) throw Error('تعذر إنشاء هوية آمنة للتجربة.');
  storage.setItem(READER_PREVIEW_DATABASE_KEY, name);
  return name;
}

export function readerPreviewOriginAllowed(origin:string): boolean {
  try {
    const url=new URL(origin);
    return url.origin===READER_PREVIEW_ORIGIN || (url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  } catch { return false; }
}
