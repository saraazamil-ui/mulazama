import { DomainError } from '../core/types';
import { requireVerifiedMushaf, type VerifiedMushaf } from '../mushaf/model';
import type { LearningJourney } from './journey06l3';
import { MushafStudyController, type StudyRange, type StudyPreferenceStorage } from './mushaf-study10b';

/** Reader preferences never grant content, catalogue, or learning access. */
export function openMushafStudy(journey: LearningJourney, mushaf: VerifiedMushaf, databaseName: string, storage: StudyPreferenceStorage): MushafStudyController {
  requireVerifiedMushaf(mushaf);
  if (journey.kind !== mushaf.kind || journey.catalogUnits.some(entry => entry.unit.editionId !== mushaf.editionId))
    throw new DomainError('REFERENCE_MISMATCH', 'المصحف وخطة الحفظ لا ينتميان إلى الطبعة نفسها.');
  const coverageForRange = (range: StudyRange) => {
    const surah = mushaf.surahs.find(s => s.number === range.surah);
    if (!surah || range.fromAyah < 1 || range.toAyah > surah.ayahCount)
      throw new DomainError('REFERENCE_MISMATCH', 'المقدار خارج حدود السورة المتحقق منها.');
    const verses = mushaf.verses.filter(v => v.surah === range.surah && v.ayah >= range.fromAyah && v.ayah <= range.toAyah);
    if (verses.length !== range.toAyah - range.fromAyah + 1)
      throw new DomainError('CONTENT_INTEGRITY_FAILURE', 'خريطة المقدار غير مكتملة.');
    return verses.flatMap(verse => verse.tokenKeys);
  };
  const controller = new MushafStudyController(journey, { databaseName, storage, coverageForRange });
  controller.restore();
  return controller;
}
