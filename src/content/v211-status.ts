/** Safe public metadata only. Never import candidate source, slices or review tooling into the app. */
export const v211ContentStatus = Object.freeze({
  publisher: 'Tanzil Project',
  sourceVersion: '1.1',
  sourceUrl: 'https://tanzil.net/',
  state: 'structurally-verified' as const,
  ayahs: 6236,
  surahs: 114,
  referencePages: 604,
  quranDisplayAllowed: false,
  productionReady: false,
  pending: ['مراجعة الحقوق والرواية والبسملة', 'المراجعة المختصة للنص والفهرسة والخط', 'موافقة المالكة على الحزمة المحددة'] as const,
});
