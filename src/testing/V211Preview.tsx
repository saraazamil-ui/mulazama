import { useState } from 'react';
import V211App from '../V211App';
import type { ProductV211 } from '../application/product-v211';
import type { PreviewClock } from './v211-preview-clock';

export default function V211Preview({ service, clock }: { service: ProductV211; clock: PreviewClock }) {
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const advance = async (weekday: 5 | 6) => {
    setBusy(true); setError('');
    try {
      clock.advance(weekday, service.state.plan?.zoneId ?? 'Asia/Riyadh');
      await service.refresh();
      setGeneration(value => value + 1);
    } catch { setError('تعذر تحديث وقت التجربة؛ أعيدي تحميل الصفحة لقراءة آخر حفظ.'); }
    finally { setBusy(false); }
  };
  return <>
    <aside aria-label="أدوات تجربة المواعيد" className="v211-preview-tools" dir="rtl">
      <details>
        <summary>تجربة الجمعة والسبت{clock.isSimulated() ? ` · تاريخ تجريبي: ${service.today()}` : ''}</summary>
        <p>قدّمي تاريخ هذه التجربة الخاصة لمراجعة الجمعة واختبار انتقال المحفوظ إلى التعاهد يوم السبت. تبقى أحداث التجربة وتواريخها محفوظة بعد إعادة الفتح.</p>
        <div>
          <button disabled={busy} onClick={() => void advance(5)}>الانتقال إلى الجمعة التالية</button>
          <button disabled={busy} onClick={() => void advance(6)}>الانتقال إلى السبت التالي</button>
        </div>
        <p>هذه الأداة تخص المقادير الاصطناعية فقط.</p>
        {error && <p role="alert">{error}</p>}
      </details>
    </aside>
    <V211App key={generation} service={service} />
  </>;
}
