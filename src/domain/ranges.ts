import type { RangeSelection } from "./contracts";

export function validateRange(range: RangeSelection): string | null {
  if (!range || !["surah", "juz", "page", "ayah"].includes(range.kind))
    return "اختر نوع نطاق معروفًا.";
  if (
    range.editionId !== "prototype-unverified" ||
    range.status !== "declared_unassessed"
  )
    return "هوية النطاق أو حالته غير متوافقة مع النموذج.";
  if (!range.id || range.id.length > 200) return "معرّف النطاق غير صالح.";
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    range.start < 1 ||
    range.end < range.start
  )
    return "حدد بداية ونهاية صحيحتين؛ النهاية لا تسبق البداية.";
  if (range.kind === "surah" && range.end > 114)
    return "رقم السورة بين 1 و114.";
  if (range.kind === "juz" && range.end > 30) return "رقم الجزء بين 1 و30.";
  if (range.kind === "page" && (!range.layoutId || range.layoutId.length > 200))
    return "حدد هوية طبعة الصفحة؛ لا تُحوّل الصفحات إلى آيات دون خريطة معتمدة.";
  if (range.kind === "page" && range.end > 10000)
    return "رقم الصفحة خارج حدود الإدخال التجريبي.";
  if (
    range.kind === "ayah" &&
    (!Number.isSafeInteger(range.surah) ||
      (range.surah ?? 0) < 1 ||
      (range.surah ?? 0) > 114)
  )
    return "حدد السورة لنطاق الآيات.";
  if (range.kind === "ayah" && range.end > 1000)
    return "رقم الآية خارج حدود الإدخال التجريبي؛ التحقق المرجعي النهائي معلق على الحزمة.";
  return null;
}

function axis(r: RangeSelection): string {
  return [
    r.editionId,
    r.kind,
    r.kind === "ayah" ? r.surah : "",
    r.kind === "page" ? r.layoutId : "",
  ].join(":");
}
/** Merge actual overlap on one explicit coordinate axis only; never fill non-adjacent gaps. */
export function normalizeRanges(ranges: RangeSelection[]): RangeSelection[] {
  const ordered = ranges
    .map((r) => ({ ...r }))
    .sort(
      (a, b) =>
        axis(a).localeCompare(axis(b)) || a.start - b.start || a.end - b.end,
    );
  return ordered.reduce<RangeSelection[]>((out, r) => {
    const previous = out.at(-1);
    if (previous && axis(previous) === axis(r) && r.start <= previous.end)
      previous.end = Math.max(previous.end, r.end);
    else out.push(r);
    return out;
  }, []);
}
export function rangeLabel(r: RangeSelection): string {
  const span = r.start === r.end ? `${r.start}` : `${r.start}–${r.end}`;
  if (r.kind === "ayah") return `السورة ${r.surah}، الآيات ${span}`;
  if (r.kind === "page") return `الصفحات ${span} · ${r.layoutId}`;
  return `${r.kind === "surah" ? "السور" : "الأجزاء"} ${span}`;
}
export function declarationSummary(ranges: RangeSelection[]): string {
  if (!ranges.length) return "لم يُدخل محفوظ سابق.";
  return `${normalizeRanges(ranges).length} نطاقات معلنة غير مختبرة. لا يُجمع مقدار الأنواع المختلفة قبل اعتماد خريطة المحتوى.`;
}
