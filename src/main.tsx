import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { openRuntimeApplication } from "./application/runtime-application06l3";
import "./styles.css";
const root = createRoot(document.getElementById("root")!);
// Registration caches the versioned app shell only. Quran and personal events have independent stores.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register(new URL('sw.js',document.baseURI),{scope:'./'}).catch(()=>{
      // App remains usable online; no claim of successful offline installation is made here.
    });
  });
}
root.render(
  <main dir="rtl" role="status">
    <h1>مُلازَمَة</h1>
    <p>جارٍ فتح بياناتك المحلية…</p>
  </main>,
);
openRuntimeApplication()
  .then(({history,journey}) => {
    root.render(
      <StrictMode>
        <App service={history.product} data={history} journey={journey} />
      </StrictMode>,
    );
  })
  .catch((cause) => {
    root.render(
      <main dir="rtl">
        <h1>مُلازَمَة</h1>
        <div role="alert">
          <p>
            تعذر فتح البيانات المحلية. لم ننشئ سجلًا بديلًا ولم نمسح بياناتك.
          </p>
          <p>
            {cause instanceof Error
              ? cause.message
              : "تعذر الوصول إلى التخزين."}
          </p>
        </div>
        <button onClick={() => location.reload()}>إعادة المحاولة</button>
      </main>,
    );
  });
