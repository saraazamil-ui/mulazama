import { addCivilDays } from '../domain/taahud-v211';
import { localDateAt } from '../application/product-v211';

/** Test time only; this module cannot authorize Quran display or a production account. */
export function createPreviewClock(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string) {
  const saved = storage.getItem(key);
  let offset = saved && /^\d+$/.test(saved) ? Number(saved) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 3660 * 86400000) offset = 0;
  const now = () => new Date(Date.now() + offset);
  return {
    now,
    isSimulated: () => offset > 0,
    advance(weekday: 5 | 6, zone: string) {
      const currentDate = localDateAt(now().toISOString(), zone);
      const day = new Date(currentDate + 'T12:00:00Z').getUTCDay();
      const nextDate = addCivilDays(currentDate, (weekday - day + 7) % 7 || 7);
      // Find local noon, so a DST transition does not accidentally select a different date.
      const desired = Date.parse(nextDate + 'T12:00:00Z');
      let instant = desired;
      const format = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
      for (let n = 0; n < 3; n++) {
        const parts = format.formatToParts(new Date(instant));
        const part = (name: string) => parts.find(p => p.type === name)!.value;
        const wall = Date.parse(`${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}Z`);
        instant += desired - wall;
      }
      const nextOffset = instant - Date.now();
      if (localDateAt(new Date(instant).toISOString(), zone) !== nextDate || nextOffset <= offset || nextOffset > 3660 * 86400000) throw Error('INVALID_PREVIEW_DATE');
      storage.setItem(key, String(nextOffset));
      offset = nextOffset;
      return now();
    },
  };
}
export type PreviewClock = ReturnType<typeof createPreviewClock>;
