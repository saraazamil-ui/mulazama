import { createRoot } from 'react-dom/client';
import V211Preview from './V211Preview';
import { ProductV211, type ProductEvent, type ProductState } from '../application/product-v211';
import { IndexedDbProductStore } from '../persistence/product-v211-store';
import { v211DatabaseIdentity } from './v211-identity';
import { createPreviewClock } from './v211-preview-clock';
import '../v211.css';
import './v211-preview.css';

const root = createRoot(document.getElementById('root')!);
async function boot() {
  if (import.meta.env.MODE !== 'test' || !['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
    throw Error('PRIVATE_PREVIEW_ONLY');
  }
  const name = v211DatabaseIdentity(localStorage);
  const store = await IndexedDbProductStore.open<ProductState, ProductEvent>(name);
  try {
    const clock = createPreviewClock(localStorage, name + ':preview-clock');
    const service = await ProductV211.open(store, { clock: clock.now });
    root.render(<V211Preview service={service} clock={clock} />);
  } catch (error) {
    store.close();
    throw error;
  }
}
void boot().catch(error => {
  console.error('V211_PREVIEW_START_FAILED', error instanceof Error ? error.message : 'UNKNOWN');
  root.render(<main dir="rtl" className="v211-boot-error">
    <h1>تعذر فتح المعاينة الخاصة</h1>
    <p role="alert">لم نستطع قراءة السجل المحلي بأمان. لم نحذف أي بيانات أو ننشئ سجلًا بديلًا.</p>
    <p>هذه المعاينة تعمل داخل بيئة مُلازَمَة الخاصة، وتحتاج إلى السماح بالتخزين في المتصفح.</p>
    <button onClick={() => location.reload()}>أعد المحاولة</button>
  </main>);
});
