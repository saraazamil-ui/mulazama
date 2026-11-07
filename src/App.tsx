import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import type { ReactNode } from "react";
import {
  BookOpen,
  CalendarDays,
  ChartNoAxesCombined,
  Settings,
  ArrowLeft,
  ChevronLeft,
  Clock,
  Leaf,
  ShieldCheck,
  Sun,
  Moon,
  Play,
  Pause,
  Plus,
  RotateCcw,
  Bookmark,
  Headphones,
  FileText,
  Check,
  Trash2,
  Download,
  Upload,
  Link as LinkIcon,
  HeartHandshake,
} from "lucide-react";
import {
  Button,
  Card,
  Notice,
  Empty,
  Field,
  Heading,
  Modal,
  Meta,
  FeedbackContext,
} from "./components";
import { screens, days, personas, kinds, screenComponents } from "./catalog";
import type { Screen } from "./catalog";
import type {
  PrototypeState,
  PlanConfig,
  Persona,
  RangeKind,
  RangeSelection,
  AttemptKind,
  AssessmentInput,
  MistakeDraft,
  ContractId,
  ContractRequestMap,
} from "./domain/contracts";
import { currentRiyadhDate, effectiveBudget } from "./domain/state";
import type { Action } from "./domain/state";
import { ApplicationService } from "./application/service";
import { LearningEngineScreen } from "./LearningEngineScreen";
import { Onboarding } from "./Onboarding";
import { CompanionPanel, type CompanionLoadState } from "./CompanionPanel";
import type { PersonalMemoryReadModel } from "./memory/personal-memory";
import { ProgressContent } from "./ProgressDashboard";
import type { ProgressLoadState } from "./ProgressDashboard";
import type { ProgressReadModel } from "./progress/projection";
import type { CompositeDataController } from "./application/composite-application";
import type {
  LearningUiAdapter,
  LearningScreenId,
} from "./application/learning-ui-adapter";

type Scenario =
  | "normal"
  | "loading"
  | "error"
  | "empty"
  | "capacity"
  | "offline"
  | "saveFailure";
interface AppContext {
  state: PrototypeState;
  progress: ProgressLoadState;
  companion: CompanionLoadState;
  refreshCompanion: () => Promise<void>;
  refreshProgress: () => Promise<void>;
  screen: Screen;
  go: (s: Screen) => void;
  commit: (a: Action) => Promise<boolean>;
  service: ApplicationService;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
  scenario: Scenario;
  setScenario: (s: Scenario) => void;
  part: number;
  setPart: (n: number) => void;
  editAttempt: string | null;
  setEditAttempt: (s: string | null) => void;
  start: (kind: AttemptKind, label?: string, taskId?: string) => Promise<void>;
}
const Context = createContext<AppContext>(null!);
const useApp = () => useContext(Context);
const number = (n: number) => n.toLocaleString("ar-SA");
const date = (s: string | null) =>
  s
    ? new Intl.DateTimeFormat("ar-SA", {
        dateStyle: "medium",
        calendar: "gregory",
        timeZone: "Asia/Riyadh",
      }).format(new Date(s))
    : "لم يحدد بعد";
function rangeLabel(r: RangeSelection) {
  const labels = {
    surah: "سورة رقم",
    juz: "الجزء",
    page: "صفحة معلنة",
    ayah: "آيات السورة " + r.surah,
  };
  return (
    labels[r.kind] +
    " " +
    number(r.start) +
    (r.end !== r.start ? " – " + number(r.end) : "")
  );
}
function useQuery<K extends ContractId>(id: K, input: ContractRequestMap[K]) {
  const { service } = useApp();
  return service.query(id, input);
}
function route(): Screen {
  const hash = window.location.hash.slice(1);
  return hash in screens ? (hash as Screen) : "S01";
}

export default function App({
  service,
  learning,
  data,
}: {
  service: ApplicationService;
  learning?: LearningUiAdapter;
  data?: CompositeDataController & { readProgress?: (now?: Date) => ProgressReadModel | Promise<ProgressReadModel>; readPersonalMemory?: (now?: Date) => Promise<PersonalMemoryReadModel> };
}) {
  const [state, setState] = useState<PrototypeState>(() => service.state);
  const [screen, setScreen] = useState<Screen>(() => window.location.hash ? route() : service.state.config.configured ? "S05" : "S01");
  const [progress, setProgress] = useState<ProgressLoadState>({ status: "loading" });
  const [companion, setCompanion] = useState<CompanionLoadState>({ status: "loading" });
  const companionGeneration = useRef(0);
  const refreshCompanion = useCallback(async () => {
    const generation = ++companionGeneration.current;
    if (!data?.readPersonalMemory) {
      setCompanion({ status: "unavailable", message: "قراءة ذاكرة الحافظ غير متاحة في هذه الواجهة. لم يُستنتج تقدم من إعداداتك." });
      return;
    }
    setCompanion({ status: "loading" });
    try {
      const value = await data.readPersonalMemory();
      if (generation === companionGeneration.current) setCompanion({ status: "ready", value });
    } catch (cause) {
      if (generation === companionGeneration.current) setCompanion({ status: "error", message: cause instanceof Error ? cause.message : "تعذر التحقق من السجل المحلي." });
    }
  }, [data]);
  useEffect(() => {
    void refreshCompanion();
    return () => { companionGeneration.current++; };
  }, [refreshCompanion, state.revision, screen]);
  const progressGeneration = useRef(0);
  const refreshProgress = useCallback(async () => {
    const generation = ++progressGeneration.current;
    setProgress({ status: "loading" });
    try {
      // Read a fresh snapshot without mutating the command service during background updates.
      const value = await (data?.readProgress ? data.readProgress() : service.readProgressFresh());
      if (generation === progressGeneration.current) setProgress({ status: "ready", value });
    } catch (cause) {
      if (generation === progressGeneration.current) setProgress({ status: "error", message: cause instanceof Error ? cause.message : "تعذر التحقق من السجل المحلي." });
    }
  }, [service, data]);
  useEffect(() => {
    void refreshProgress();
    return () => { progressGeneration.current++; };
  }, [refreshProgress, state.revision, screen]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const scheduleMidnight = () => {
      const nextMidnight = Date.parse(`${currentRiyadhDate()}T00:00:00+03:00`) + 86400000;
      timer = setTimeout(() => { void refreshProgress(); scheduleMidnight(); }, Math.max(1, nextMidnight - Date.now() + 50));
    };
    const onFocus = () => { void refreshProgress(); void refreshCompanion(); };
    const onVisible = () => { if (document.visibilityState === "visible") onFocus(); };
    scheduleMidnight();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshProgress, refreshCompanion]);
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [part, setPart] = useState(1);
  const [editAttempt, setEditAttempt] = useState<string | null>(null);
  const [leave, setLeave] = useState<Screen | null>(null);
  const [help, setHelp] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const go = (s: Screen) => {
    if (
      stateRef.current.session &&
      ["S07", "S08"].includes(screen) &&
      !["S07", "S08", "S09", "S10", "S12"].includes(s)
    ) {
      setLeave(s);
      return;
    }
    window.location.hash = s;
    setScreen(s);
  };
  const commit = async (action: Action): Promise<boolean> => {
    try {
      const next = await service.dispatch(action);
      setState(next);
      stateRef.current = next;
      setError("");
      setRecoveryRequired(false);
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "تعذر تأكيد الحفظ. بقي آخر حفظ مؤكد.",
      );
      return false;
    }
  };
  const start = async (
    kind: AttemptKind,
    label = "نطاق لم يُحل إلى محتوى معتمد",
    taskId?: string,
  ) => {
    if (stateRef.current.session) {
      go("S10");
      return;
    }
    if (
      await commit({ type: "session.start", kind, rangeLabel: label, taskId })
    )
      go(kind === "new" ? "S07" : "S08");
  };
  useEffect(() => {
    const onHash = async () => {
      const next = route();
      const current = stateRef.current;
      if (
        current.session &&
        ["training", "recall"].includes(current.session.phase) &&
        !["S07", "S08", "S09", "S10", "S12"].includes(next)
      ) {
        if (!(await commit({ type: "session.pause" }))) return;
      }
      setScreen(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = state.preferences.dark
      ? "dark"
      : "light";
    document.documentElement.dataset.large = String(
      state.preferences.largeText,
    );
    document.documentElement.dataset.motion = state.preferences.reducedMotion
      ? "reduced"
      : "normal";
  }, [state.preferences]);
  useEffect(() => {
    document.title = screens[screen] + " | مُلازَمَة";
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>("h1")?.focus(),
    );
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [screen]);
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(""), 6000);
    return () => clearTimeout(id);
  }, [message]);
  const nav = [
    { id: "S05", label: "اليوم", icon: CalendarDays },
    { id: "S16", label: "المصحف", icon: BookOpen },
    { id: "S14", label: "تقدمي", icon: ChartNoAxesCombined },
    { id: "S17", label: "الإعدادات", icon: Settings },
  ] as const;
  const section =
    screen === "S16"
      ? "S16"
      : ["S14", "S15", "S19"].includes(screen)
        ? "S14"
        : ["S17", "S18"].includes(screen)
          ? "S17"
          : "S05";
  const contents: Record<Screen, ReactNode> = {
    S01: <Welcome />,
    S02: state.config.configured ? <Plan /> : <Page id="S02" description="ثلاث خطوات لتهيئة هدفك ومحفوظك ووقتك.">
      <Onboarding config={state.config} ranges={state.ranges} onSave={async input => {
        try {
          const next = await service.configureOnboarding(input);
          setState(next); stateRef.current = next; setError(""); setRecoveryRequired(false);
          return true;
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "تعذر تأكيد حفظ الإعداد.");
          return false;
        }
      }} onComplete={() => go("S05")} />
    </Page>,
    S03: <Ranges />,
    S04: (
      <LearningContentBoundary id="S04">
        <Diagnostic />
      </LearningContentBoundary>
    ),
    S05: <Today />,
    S06: <Capacity />,
    S07: (
      <LearningContentBoundary id="S07">
        <Training />
      </LearningContentBoundary>
    ),
    S08: (
      <LearningContentBoundary id="S08">
        <Recall />
      </LearningContentBoundary>
    ),
    S09: (
      <LearningContentBoundary id="S09">
        <Assessment />
      </LearningContentBoundary>
    ),
    S10: (
      <LearningContentBoundary id="S10">
        <Resume />
      </LearningContentBoundary>
    ),
    S11: (
      <LearningContentBoundary id="S11">
        <Maintenance />
      </LearningContentBoundary>
    ),
    S12: <Mistakes />,
    S13: (
      <LearningContentBoundary id="S13">
        <Recovery />
      </LearningContentBoundary>
    ),
    S14: <Progress />,
    S15: (
      <LearningContentBoundary id="S15">
        <Detail />
      </LearningContentBoundary>
    ),
    S16: (
      <LearningContentBoundary id="S16">
        <Reader />
      </LearningContentBoundary>
    ),
    S17: <Preferences />,
    S18: <Data controller={data} learningAttached={!!learning} />,
    S19: <Forecast />,
  };
  if (
    learning &&
    ["S07", "S08", "S09", "S10", "S11", "S12", "S13"].includes(screen)
  ) {
    contents[screen] = (
      <LearningEngineScreen
        key={screen}
        adapter={learning}
        onCommitted={() => { void refreshProgress(); void refreshCompanion(); }}
        id={screen as LearningScreenId}
      />
    );
  }
  return (
    <FeedbackContext.Provider value={error}>
      <Context.Provider
        value={{
          state,
          progress,
          refreshProgress,
          companion,
          refreshCompanion,
          screen,
          go,
          commit,
          notify: setMessage,
          scenario,
          setScenario,
          part,
          setPart,
          editAttempt,
          setEditAttempt,
          service,
          refresh: async () => {
            const next = await service.refresh();
            setState(next);
            stateRef.current = next;
          },
          start,
        }}
      >
        <a
          className="skip-link"
          href="#main-content"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById("main-content")?.focus();
          }}
        >
          تجاوز إلى المحتوى
        </a>
        <div className="app-shell">
          <aside className="sidebar">
            <button
              className="brand"
              onClick={() => go("S05")}
              aria-label="مُلازَمَة، ورد اليوم"
            >
              <span className="brand-mark">
                <BookOpen size={28} />
              </span>
              <span>
                <strong>مُلازَمَة</strong>
                <small>رفيق رحلتك مع القرآن</small>
              </span>
            </button>
            <div className="side-caption">مساحتك اليومية</div>
            <nav aria-label="التنقل الرئيسي">
              {nav.map((n) => (
                <button
                  key={n.id}
                  className={"nav-item " + (section === n.id ? "active" : "")}
                  aria-current={section === n.id ? "page" : undefined}
                  onClick={() => go(n.id)}
                >
                  <n.icon size={21} />
                  <span>{n.label}</span>
                  {section === n.id && <span className="nav-dot" />}
                </button>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <Leaf size={26} />
              <p>
                خطوة صغيرة،
                <br />
                وصلة تتجدد كل يوم.
              </p>
              <span className="side-line" />
              <button className="help-button" onClick={() => setHelp(true)}>
                عن مُلازَمَة وخصوصيتك <ShieldCheck size={17} />
              </button>
              <small>MULAZAMA · 06-L2</small>
            </div>
          </aside>
          <div className="workspace">
            <header className="topbar">
              <div className="mobile-brand">
                <BookOpen size={22} />
                <strong>مُلازَمَة</strong>
              </div>
              <span className="breadcrumb">
                مساحتك / <strong>{screens[screen]}</strong>
              </span>
              <div className="top-actions">
                <span className="demo-badge">
                  <span /> إصدار هندسي
                </span>
                <button
                  className="icon-button"
                  aria-label={
                    state.preferences.dark
                      ? "تفعيل الوضع الفاتح"
                      : "تفعيل الوضع الداكن"
                  }
                  onClick={async () =>
                    await commit({
                      type: "preferences",
                      patch: { dark: !state.preferences.dark },
                    })
                  }
                >
                  {state.preferences.dark ? (
                    <Sun size={20} />
                  ) : (
                    <Moon size={20} />
                  )}
                </button>
              </div>
            </header>
            <div className="prototype-strip" role="region" aria-label="حالة النسخة">
              إصدار هندسي 06-L2 · جلسات القرآن موقوفة حتى اعتماد المحتوى
            </div>
            <main
              id="main-content"
              tabIndex={-1}
              data-screen={screen}
              data-component-id={screen + "-" + screenComponents[screen]}
            >
              {recoveryRequired && (
                <Notice tone="warning">
                  توجد حالة محفوظة تعذر قراءتها. الكتابة موقوفة لحمايتها.
                  <Button variant="secondary" onClick={() => go("S18")}>
                    إصلاح البيانات
                  </Button>
                </Notice>
              )}
              {error && (
                <Notice tone="error">
                  {error}{" "}
                  <Button variant="ghost" onClick={() => setError("")}>
                    إغلاق الرسالة
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      try {
                        const next = await service.refresh();
                        setState(next);
                        stateRef.current = next;
                        setError("");
                      } catch (cause) {
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : "تعذر إعادة فتح البيانات.",
                        );
                      }
                    }}
                  >
                    إعادة قراءة البيانات
                  </Button>
                </Notice>
              )}
              {contents[screen]}
            </main>
            <nav className="bottom-nav" aria-label="التنقل على الهاتف">
              {nav.map((n) => (
                <button
                  key={n.id}
                  aria-current={section === n.id ? "page" : undefined}
                  onClick={() => go(n.id)}
                >
                  <n.icon size={21} />
                  <span>{n.label}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>
        <div className="toast" role="status" aria-live="polite">
          {message}
        </div>
        {help && (
          <Modal title="عن مُلازَمَة" onClose={() => setHelp(false)}>
            <p>
              تُحفظ إعداداتك ووقائعك محليًا بعد تأكيد كتابة سجل الأحداث. لا حساب
              إلزامي ولا رفع تلقائي للبيانات. مسح بيانات المتصفح قد يزيل نسختك
              المحلية.
            </p>
            <p>
              المحتوى القرآني والصوت والتفسير ينتظر الاعتماد. النسخ المصدرة
              مشفرة بكلمة مرور تختارينها؛ احتفظي بها خارج هذا الجهاز.
            </p>
            <Button
              onClick={() => {
                setHelp(false);
                go("S18");
              }}
            >
              إدارة البيانات
            </Button>
          </Modal>
        )}
        {leave && (
          <Modal title="حفظ الجلسة قبل المغادرة" onClose={() => setLeave(null)}>
            <p>سنحفظ آخر خطوة مؤكدة، وتبقى المحاولة غير المكتملة بلا نتيجة.</p>
            <div className="actions">
              <Button
                onClick={async () => {
                  if (await commit({ type: "session.pause" })) {
                    window.location.hash = leave;
                    setScreen(leave);
                    setLeave(null);
                  }
                }}
              >
                أوقف مؤقتًا وتابع
              </Button>
              <Button variant="secondary" onClick={() => setLeave(null)}>
                أكمل جلستي
              </Button>
            </div>
          </Modal>
        )}
      </Context.Provider>
    </FeedbackContext.Provider>
  );
}
function Page({
  id,
  description,
  children,
}: {
  id: Screen;
  description?: string;
  children: ReactNode;
}) {
  const { go } = useApp();
  return (
    <>
      <Heading
        eyebrow={"مُلازَمَة / " + id}
        title={screens[id]}
        description={description}
        back={
          ["S01", "S05", "S14", "S16", "S17"].includes(id)
            ? undefined
            : () => go("S05")
        }
      />
      {children}
    </>
  );
}
function LearningContentBoundary({
  id,
  children,
}: {
  id: Screen;
  children: ReactNode;
}) {
  const content = useQuery("C01", { operation: "read" });
  if (!content.ok || content.value.status === "unavailable")
    return (
      <Page id={id}>
        <Card>
          <ContentUnavailable />
          <Notice>
            جلسات القرآن والتشخيص والتعاهد معلقة حتى اكتمال اعتماد النص والطبعة
            والخرائط. إعدادك وبياناتك المحفوظة باقية.
          </Notice>
        </Card>
      </Page>
    );
  return <>{children}</>;
}
function ContentUnavailable() {
  return (
    <div className="content-unavailable">
      <BookOpen size={38} />
      <h2>النص المعتمد ينتظر الإضافة</h2>
      <p>
        حفاظًا على سلامة القرآن، لا نعرض نصًا بديلًا.
        <br />
        تتاح هنا تجربة الأدوات فقط دون تلاوة فعلية.
      </p>
      <Meta>المصدر والطبعة والبصمة: غير معتمدة</Meta>
    </div>
  );
}
function Welcome() {
  const { go } = useApp();
  return (
    <Page id="S01">
      <section className="welcome">
        <div className="welcome-copy">
          <span className="pill">
            <Leaf size={16} /> بداية هادئة لرحلة ممتدة
          </span>
          <h2>
            ورد واضح.
            <br />
            وصلة <em>تتجدد.</em>
          </h2>
          <p>
            مساحة تجمع الحفظ والمراجعة وتعاهد القديم،
            <br />
            لتعرف خطوتك التالية وتعود إليها باطمئنان.
          </p>
          <div className="actions">
            <Button onClick={() => go("S02")}>
              ابدأ إعداد تجربتك <ArrowLeft size={19} />
            </Button>
            <Button variant="secondary" onClick={() => go("S18")}>
              لدي نسخة احتياطية
            </Button>
          </div>
          <div className="welcome-facts">
            <span>العربية · RTL</span>
            <span>حفص عن عاصم · مستهدف</span>
            <span>دون حساب</span>
          </div>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <div className="arch">
            <div className="arch-inner">
              <BookOpen size={92} strokeWidth={1} />
              <span>مُلازَمَة</span>
              <small>برفقٍ، كل يوم</small>
            </div>
          </div>
          <span className="art-orbit one" />
          <span className="art-orbit two" />
        </div>
      </section>
      <div className="three-grid">
        <Card>
          <Bookmark />
          <h3>مقدار يناسب يومك</h3>
          <p>حدد الوقت والمسار، وافهم سبب كل خطوة.</p>
        </Card>
        <Card>
          <HeartHandshake />
          <h3>عودة دون أحكام</h3>
          <p>المجهول يبقى مجهولًا، والمراجعة باب للعودة.</p>
        </Card>
        <Card>
          <ShieldCheck />
          <h3>تجربتك على جهازك</h3>
          <p>حفظ محلي دون حساب إلزامي أو تسجيل صوت.</p>
        </Card>
      </div>
      <Notice>
        يمكنك تجربة الإعداد الآن. جلسات القرآن الفعلية تنتظر حزمة محتوى معتمدة.
      </Notice>
      <p className="policy-links"><a href="./privacy.html">الخصوصية في هذه النسخة</a> · <a href="./support.html">المساعدة</a> · <a href="./terms.html">حدود الاستخدام</a></p>
      <Button variant="ghost" onClick={() => go("S17")}>
        المصدر والخصوصية <ChevronLeft size={16} />
      </Button>
    </Page>
  );
}
function Plan() {
  const { state, commit, go } = useApp();
  const [form, setForm] = useState<PlanConfig>(state.config);
  const [localError, setError] = useState("");
  const [preview, setPreview] = useState(false);
  const change = (patch: Partial<PlanConfig>) => setForm({ ...form, ...patch });
  const save = () => {
    if (
      !Number.isInteger(form.minutes) ||
      form.minutes < 0 ||
      form.minutes > 1440
    ) {
      setError("أدخل عدد دقائق صحيحًا بين 0 و1440.");
      return;
    }
    if (!form.days.length && form.minutes > 0) {
      setError(
        "اختر يومًا واحدًا على الأقل، أو اجعل الوقت صفرًا للتوقف المؤقت.",
      );
      return;
    }
    if (
      !Number.isInteger(form.startSurah) ||
      form.startSurah < 1 ||
      form.startSurah > 114
    ) {
      setError("رقم السورة يجب أن يكون بين 1 و114.");
      return;
    }
    setError("");
    setPreview(true);
  };
  return (
    <Page id="S02" description="بضع اختيارات؛ ويمكنك تعديلها في أي وقت.">
      <Card>
        <div className="section-title">
          <h2>ما المسار الأقرب إليك؟</h2>
          <Meta>١ / اختياراتك</Meta>
        </div>
        <div className="persona-grid" role="radiogroup" aria-label="مسار الحفظ">
          {Object.entries(personas).map(([key, label]) => (
            <label
              key={key}
              className={"choice " + (form.persona === key ? "selected" : "")}
            >
              <input
                type="radio"
                name="persona"
                value={key}
                checked={form.persona === key}
                onChange={() =>
                  change({
                    persona: key as Persona,
                    goal: key === "complete" ? "maintain" : form.goal,
                  })
                }
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <div className="two-grid">
          <Field label="الوقت اليومي بالدقائق">
            <input
              type="number"
              min="0"
              max="1440"
              value={Number.isNaN(form.minutes) ? "" : form.minutes}
              onChange={(e) =>
                change({
                  minutes: e.target.value === "" ? NaN : Number(e.target.value),
                })
              }
            />
          </Field>
          <Field label="الهدف">
            <select
              value={form.goal}
              onChange={(e) =>
                change({ goal: e.target.value as PlanConfig["goal"] })
              }
            >
              <option value="memorize" disabled={form.persona === "complete"}>
                الحفظ والمراجعة
              </option>
              <option value="maintain">تعاهد محفوظي</option>
            </select>
          </Field>
        </div>
        <fieldset>
          <legend>أيام النشاط</legend>
          <div className="day-options">
            {days.map((day, i) => (
              <label
                key={day}
                className={"day " + (form.days.includes(i) ? "selected" : "")}
              >
                <input
                  type="checkbox"
                  checked={form.days.includes(i)}
                  onChange={() =>
                    change({
                      days: form.days.includes(i)
                        ? form.days.filter((d) => d !== i)
                        : [...form.days, i],
                    })
                  }
                />
                {day}
              </label>
            ))}
          </div>
        </fieldset>
        {form.goal === "memorize" && (
          <Field
            label="سورة البداية (رقم مرجعي)"
            hint="مرجع مُصرّح به ينتظر حلّه إلى حزمة محتوى معتمدة"
          >
            <input
              type="number"
              min="1"
              max="114"
              value={form.startSurah}
              onChange={(e) => change({ startSurah: Number(e.target.value) })}
            />
          </Field>
        )}
        <Notice>
          المنهج التكيفي الهجين: تدريب، ثم تسميع، ثم مراجعة. أعداد التكرار
          والمواعيد سيحددها المحرك بعد اعتماده.
        </Notice>
        {localError && <Notice tone="error">{localError}</Notice>}
        <div className="actions">
          <Button onClick={save}>
            راجع اختياراتك <ArrowLeft size={18} />
          </Button>
          <Button variant="ghost" onClick={() => go("S16")}>
            تصفح الآن
          </Button>
        </div>
      </Card>
      {preview && (
        <Modal title="اعتماد الإعداد" onClose={() => setPreview(false)}>
          <p>
            {personas[form.persona]} · {number(form.minutes)} دقيقة ·{" "}
            {number(form.days.length)} أيام.
          </p>
          <Notice>
            سيُحفظ إعدادك محليًا. اختيار الوقت لا يثبت إمكان تحقيق جميع
            الالتزامات؛ تبقى جلسات القرآن معلقة حتى اعتماد المحتوى.
          </Notice>
          <div className="actions">
            <Button
              onClick={async () => {
                if (
                  await commit({
                    type: "config",
                    config: { ...form, configured: true },
                  })
                ) {
                  setPreview(false);
                  go(form.persona === "beginner" ? "S05" : "S03");
                }
              }}
            >
              اعتمد وتابع
            </Button>
            <Button variant="secondary" onClick={() => setPreview(false)}>
              رجوع للتعديل
            </Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}
function Ranges() {
  const { state, commit, go } = useApp();
  const [kind, setKind] = useState<RangeKind>("surah");
  const [start, setStart] = useState(1),
    [end, setEnd] = useState(1),
    [surah, setSurah] = useState(1);
  const [error, setError] = useState("");
  const add = async (range?: RangeSelection) => {
    const r = range ?? {
      id: crypto.randomUUID(),
      kind,
      start,
      end,
      ...(kind === "ayah" ? { surah } : {}),
      editionId: "prototype-unverified" as const,
      ...(kind === "page" ? { layoutId: "prototype-layout-unverified" } : {}),
      status: "declared_unassessed" as const,
    };
    if (r.start > r.end) {
      setError("النهاية يجب أن تساوي البداية أو تأتي بعدها.");
      return;
    }
    setError("");
    await commit({ type: "range.add", range: r });
  };
  return (
    <Page id="S03" description="أضف ما سبق أن حفظته، ولو كان في مواضع متفرقة.">
      <div className="two-grid wide-left">
        <Card>
          <h2>أضف نطاقًا</h2>
          <Field label="طريقة التحديد">
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as RangeKind);
                setStart(1);
                setEnd(1);
              }}
            >
              <option value="surah">سور كاملة</option>
              <option value="juz">أجزاء كاملة</option>
              <option value="page">صفحات</option>
              <option value="ayah">نطاق آيات</option>
            </select>
          </Field>
          {kind === "ayah" && (
            <Field label="رقم السورة">
              <input
                type="number"
                value={surah}
                onChange={(e) => setSurah(Number(e.target.value))}
              />
            </Field>
          )}
          <div className="two-grid">
            <Field label="البداية">
              <input
                type="number"
                min="1"
                value={start}
                onChange={(e) => setStart(Number(e.target.value))}
              />
            </Field>
            <Field label="النهاية">
              <input
                type="number"
                min="1"
                value={end}
                onChange={(e) => setEnd(Number(e.target.value))}
              />
            </Field>
          </div>
          {kind === "page" && (
            <Notice tone="warning">
              لم تعتمد طبعة بعد. تُحفظ الأرقام كاختيار معلق؛ لا تتحول إلى آيات
              أو مقدار محفوظ.
            </Notice>
          )}
          {kind === "ayah" && (
            <Notice>
              تُفحص الحدود العددية فقط. صحة نهاية الآيات تنتظر خريطة المحتوى
              المعتمدة.
            </Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          <Button onClick={() => add()}>
            <Plus size={18} /> أضف النطاق
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              add({
                id: crypto.randomUUID(),
                kind: "juz",
                start: 1,
                end: 30,
                editionId: "prototype-unverified",
                status: "declared_unassessed",
              })
            }
          >
            حفظت القرآن كاملًا
          </Button>
        </Card>
        <Card>
          <div className="section-title">
            <h2>النطاقات المعلنة</h2>
            <Meta>{number(state.ranges.length)} نطاق</Meta>
          </div>
          {!state.ranges.length ? (
            <Empty title="لم تضف محفوظًا سابقًا">
              أضف نطاقًا معلومًا، وأكمل البقية لاحقًا.
            </Empty>
          ) : (
            <ul className="range-list">
              {state.ranges.map((r) => (
                <li key={r.id}>
                  <div>
                    <strong>{rangeLabel(r)}</strong>
                    <small>محفوظ معلن · لم يُختبر بعد</small>
                  </div>
                  <Button
                    variant="ghost"
                    aria-label={"إزالة " + rangeLabel(r)}
                    onClick={async () =>
                      await commit({ type: "range.remove", id: r.id })
                    }
                  >
                    <Trash2 size={17} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Notice>
            النطاقات المنفصلة تبقى منفصلة. يوحّد التداخل داخل النوع نفسه؛ لا
            يعرض مجموع كلمات قبل اعتماد خريطة السور والأجزاء والصفحات.
          </Notice>
        </Card>
      </div>
      <div className="actions">
        <Button disabled={!state.ranges.length} onClick={() => go("S04")}>
          تابع إلى الفحص <ArrowLeft size={18} />
        </Button>
        <Button variant="secondary" onClick={() => go("S05")}>
          أكمل لاحقًا
        </Button>
      </div>
    </Page>
  );
}
function Diagnostic() {
  const { state, start, go } = useApp();
  return (
    <Page id="S04" description="نفهم مقدارًا واحدًا، ولا نحكم على كل المحفوظ.">
      <Card>
        {state.ranges.length ? (
          <>
            <Meta>عينة عرض تجريبية · ليست اختيار HME</Meta>
            <h2>{rangeLabel(state.ranges[0])}</h2>
            <p>
              هذه تجربة لمسار التشخيص فقط. بقية المحفوظ لم يُختبر، ولا ينتج عنها
              حكم تعلم.
            </p>
            <div className="stat-row">
              <div>
                <small>المعلن</small>
                <strong>{number(state.ranges.length)} نطاق</strong>
              </div>
              <div>
                <small>التغطية المؤهلة</small>
                <strong>غير مقاسة</strong>
              </div>
              <div>
                <small>الوقت المتوقع</small>
                <strong>لم يقدّره المحرك</strong>
              </div>
            </div>
            <Button
              onClick={() => start("diagnostic", rangeLabel(state.ranges[0]))}
            >
              ابدأ المقطع التجريبي <Play size={17} />
            </Button>
          </>
        ) : (
          <Empty
            title="لم تضف نطاقًا للفحص"
            action={<Button onClick={() => go("S03")}>أضف محفوظك</Button>}
          >
            لا ننشئ عينة بلا نطاق معلن.
          </Empty>
        )}
      </Card>
      <div className="actions">
        <Button variant="secondary" onClick={() => go("S05")}>
          أكمل الفحص لاحقًا
        </Button>
        <Button variant="ghost" onClick={() => go("S03")}>
          عدّل المحفوظ المعلن
        </Button>
      </div>
    </Page>
  );
}
function Today() {
  const { state, go, start, scenario, progress, refreshProgress, service, companion, refreshCompanion } = useApp();
  const learningBlocked = service.releaseGates.some(gate => gate.status !== "passed");
  const query = useQuery("C04", {
    operation: "read",
    scenario:
      scenario === "capacity"
        ? "capacity"
        : scenario === "empty"
          ? "empty"
          : "normal",
  });
  if (!query.ok) return <Notice tone="error">{query.error.message}</Notice>;
  const plan = query.value;
  const tasks = plan.tasks;
  const next = tasks.find((t) => t.executionStatus === "pending");
  return (
    <Page id="S05" description="مُلازَمَة · رفيقك في حفظ القرآن وإتقانه.">
      <div className="dashboard-grid">
        <Card className="next-card">
          <div className="section-title">
            <h2>خطوتك التالية</h2>
            <span className="small-dot" />
          </div>
          {learningBlocked ? (
            <>
              <h3>{state.config.configured ? "إعدادك محفوظ، وننتظر إتاحة الجلسات" : "لنهيئ وردك"}</h3>
              <p>يمكنك ضبط هدفك ووقتك ومحفوظك المعلن. بدء الحفظ والمراجعة ينتظر اعتماد جلسات القرآن.</p>
              <Button onClick={() => go("S02")}>
                {state.config.configured ? "راجع هدفك ووقتك" : "أكمل إعدادك"} <ArrowLeft size={18} />
              </Button>
              {state.session && <p>سجل جلستك المتوقفة محفوظ؛ استئنافها ينتظر الاعتماد.</p>}
            </>
          ) : state.session ? (
            <>
              <Meta>جلسة محفوظة</Meta>
              <h3>نكمل من حيث توقفت</h3>
              <p>{state.session.rangeLabel}</p>
              <Button onClick={() => go("S10")}>
                استأنف جلستك <Play size={17} />
              </Button>
            </>
          ) : next ? (
            <>
              <Meta>مهمة عرض · {kinds[next.kind as AttemptKind]}</Meta>
              <h3>{next.title}</h3>
              <p>{next.rangeLabel}</p>
              <Button
                onClick={() => start(next.kind, next.rangeLabel, next.id)}
              >
                ابدأ وردك <ArrowLeft size={18} />
              </Button>
              <details>
                <summary>لماذا هذه المهمة؟</summary>
                <p>{next.reason} هذا ترتيب ثابت لا قرار حي من HME.</p>
              </details>
            </>
          ) : (
            <Empty
              title={
                tasks.length &&
                tasks.every((t) => t.executionStatus === "performed")
                  ? "اكتملت مهام العرض المخططة"
                  : "لا مهام مخططة الآن"
              }
              action={
                <Button variant="secondary" onClick={() => go("S02")}>
                  عدّل إعدادك
                </Button>
              }
            >
              لا يعني ذلك انتهاء المراجعات أو اكتمال الحفظ.
            </Empty>
          )}
        </Card>
        <section className="hero-card">
          <span className="pill">
            <Leaf size={16} /> ورد هادئ، أثر مستمر
          </span>
          <h2>وردك وتقدمك في مكان واحد.</h2>
          <div className="hero-footer">
            <span>
              <Clock size={18} />
              {number(effectiveBudget(state))} دقيقة متاحة اليوم
            </span>
            <Button variant="secondary" onClick={() => go("S06")}>
              راجع خطتك <ArrowLeft size={18} />
            </Button>
          </div>
          <div className="hero-decoration" aria-hidden="true">
            ۞
          </div>
        </section>
      </div>
      {scenario === "capacity" && (
        <Notice tone="warning">
          تحتاج الخطة إلى إعادة توزيع. تبقى المراجعات غير المخططة ظاهرة، ولا
          يزيد الجديد لتغطية العجز.
        </Notice>
      )}
      <section aria-label="ملخص التقدم">
        <ProgressContent state={progress} retry={refreshProgress} />
        <div className="actions"><Button onClick={() => go("S14")}>تفاصيل تقدمي <ChevronLeft size={16} /></Button></div>
      </section>
      <CompanionPanel state={companion} retry={refreshCompanion} />
      <div className="section-title section-spaced">
        <h2>مسارات وردك</h2>
        <span className="muted">المواعيد التعليمية تنتظر اعتماد المحتوى</span>
      </div>
      <div className="three-grid">
        {[
          {
            title: "الحفظ الجديد",
            icon: BookOpen,
            desc:
              state.config.goal === "maintain"
                ? "لا حفظ جديد لمسار التعاهد"
                : "تدريب يتبعه اختبار مستقل",
            id: "S07",
          },
          {
            title: "المراجعة",
            icon: RotateCcw,
            desc: "تسميع يبدأ والنص مخفي",
            id: "S06",
          },
          {
            title: "التثبيت والتعاهد",
            icon: HeartHandshake,
            desc: "تعاهد القديم وفحص الاتصال",
            id: "S11",
          },
        ].map((v, i) => (
          <button
            className={"path-card path-" + i}
            key={v.id}
            disabled={learningBlocked && v.id !== "S06"}
            onClick={() => go(v.id as Screen)}
          >
            <span className="path-icon">
              <v.icon size={25} />
            </span>
            <h3>{v.title}</h3>
            <p>{v.desc}</p>
            <span className="path-link">
              {learningBlocked && v.id !== "S06" ? "غير متاح حتى اعتماد جلسات القرآن" : "مراجعة الخطة"} <ArrowLeft size={17} />
            </span>
          </button>
        ))}
      </div>
      <Card className="soft-card">
        <h2>مساحة للعودة</h2>
        <p>يمكنك مراجعة خطة العودة والتوقعات دون تغيير سجل ما أنجزته.</p>
        <Button variant="ghost" disabled={learningBlocked} onClick={() => go("S13")}>رتّب عودتك <ArrowLeft size={18} /></Button>
        <Button variant="ghost" onClick={() => go("S19")}>توقع تقدمك</Button>
      </Card>
    </Page>
  );
}
function Capacity() {
  const { state, commit } = useApp();
  const [minutes, setMinutes] = useState(state.config.minutes);
  const [todayMinutes, setTodayMinutes] = useState(effectiveBudget(state));
  const [confirm, setConfirm] = useState<"usual" | "today" | null>(null);
  const query = useQuery("C04", {
    operation: "read",
    localDate: currentRiyadhDate(),
  });
  if (!query.ok)
    return (
      <Page id="S06">
        <Notice tone="error">{query.error.message}</Notice>
      </Page>
    );
  const plan = query.value;
  return (
    <Page
      id="S06"
      description="وقتك المعتاد ووقت اليوم منفصلان؛ تبقى الاستحقاقات بتاريخها الأصلي."
    >
      <Card>
        <h2>القدرة والخطة الحالية</h2>
        <p>{plan.reason}</p>
        <div className="stat-row">
          <div>
            <small>وقت اليوم</small>
            <strong>{number(effectiveBudget(state))} دقيقة</strong>
          </div>
          <div>
            <small>زمن المهام المخططة</small>
            <strong>
              {plan.plannedMinutes === null
                ? "غير متاح"
                : number(plan.plannedMinutes) + " دقيقة"}
            </strong>
          </div>
          <div>
            <small>المهام المؤجلة</small>
            <strong>{number(plan.deferred.length)}</strong>
          </div>
        </div>
        <Notice>
          لم تُنشأ مراجعات أو التزامات افتراضية. إعداد الوقت متاح؛ اختيار مهام
          القرآن ينتظر حزمة محتوى معتمدة.
        </Notice>
      </Card>
      <div className="two-grid">
        <Card>
          <h2>الوقت المعتاد</h2>
          <Field label="الدقائق المعتادة">
            <input
              type="number"
              min="0"
              max="1440"
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </Field>
          <Button onClick={() => setConfirm("usual")}>
            راجع تعديل الوقت المعتاد
          </Button>
        </Card>
        <Card>
          <h2>وقت اليوم فقط</h2>
          <Field label="دقائق اليوم">
            <input
              type="number"
              min="0"
              max="1440"
              value={todayMinutes}
              onChange={(e) => setTodayMinutes(Number(e.target.value))}
            />
          </Field>
          <Button onClick={() => setConfirm("today")}>
            راجع تعديل وقت اليوم
          </Button>
        </Card>
      </div>
      {confirm && (
        <Modal title="تأكيد تعديل الوقت" onClose={() => setConfirm(null)}>
          <p>
            {confirm === "today"
              ? "يتغير وقت اليوم فقط؛ يبقى الوقت المعتاد وأيام النشاط كما هي."
              : "يتغير وقتك المعتاد؛ يبقى سجل التعلم والاستحقاقات السابقة كما هي."}
          </p>
          <div className="actions">
            <Button
              onClick={async () => {
                const ok = await commit(
                  confirm === "today"
                    ? {
                        type: "plan.todayBudget",
                        minutes: todayMinutes,
                        localDate: currentRiyadhDate(),
                      }
                    : { type: "config", config: { ...state.config, minutes } },
                );
                if (ok) setConfirm(null);
              }}
            >
              تأكيد التعديل
            </Button>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              إلغاء
            </Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}
function Training() {
  const { state, commit, go, start, notify } = useApp();
  const [mode, setMode] = useState("preparation");
  const [busy, setBusy] = useState(false);
  const s = state.session;
  const repeat = async () => {
    if (busy) return;
    setBusy(true);
    if (
      await commit({ type: "session.repeat", commandId: crypto.randomUUID() })
    )
      notify("حُفظ تكرار تجريبي واحد. ما زال اختبار الاسترجاع مستقلًا.");
    setTimeout(() => setBusy(false), 350);
  };
  return (
    <Page id="S07" description="التدريب يمهّد للحفظ؛ والعداد لا يثبت الإتقان.">
      {!s ? (
        <Card>
          <Empty
            title="جرّب جلسة التدريب"
            action={
              <Button onClick={() => start("new")}>
                ابدأ جلسة تدريب تجريبية
              </Button>
            }
          >
            لا يوجد نص معتمد، لذا لن تُسجل هذه التجربة تعلمًا فعليًا.
          </Empty>
        </Card>
      ) : s.phase !== "training" ? (
        <Card>
          <Empty
            title="لديك جلسة في مرحلة أخرى"
            action={
              <Button onClick={() => go("S10")}>عرض الجلسة المحفوظة</Button>
            }
          >
            استأنفها أو أنهها قبل بدء تدريب جديد.
          </Empty>
        </Card>
      ) : (
        <>
          <div className="session-bar">
            <Meta>{s.rangeLabel}</Meta>
            <Button
              variant="secondary"
              onClick={async () => {
                if (await commit({ type: "session.pause" })) go("S10");
              }}
            >
              <Pause size={17} /> إيقاف مؤقت
            </Button>
          </div>
          <div className="two-grid">
            <Card>
              <div
                className="mode-tabs"
                role="group"
                aria-label="مرحلة التدريب"
              >
                {[
                  ["preparation", "تهيئة"],
                  ["listening", "استماع"],
                  ["reading", "نظر"],
                  ["practice", "تدريب"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    aria-pressed={mode === id}
                    onClick={() => setMode(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <ContentUnavailable />
              <div className="actions">
                <Button
                  variant="secondary"
                  onClick={() =>
                    notify("الصوت المرجعي غير مرفق؛ لم نسجل استماعًا.")
                  }
                >
                  <Headphones size={18} /> استمع
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    notify("لا يتوفر تفسير معتمد؛ لا نولّد بديلًا له.")
                  }
                >
                  <FileText size={18} /> اقرأ المعنى
                </Button>
              </div>
            </Card>
            <Card className="counter-card">
              <span className="eyebrow">تكرارات أكّدتها في هذه الجلسة</span>
              <output
                className="counter"
                aria-live="polite"
                aria-label="عدد التكرارات"
              >
                {number(s.repeats)}
              </output>
              <p>
                لا يوجد عدد مستهدف صادر من المحرك.
                <br />
                جرّب إقرار دورة مكتملة مرة واحدة.
              </p>
              <Button disabled={busy} onClick={repeat}>
                <Plus size={22} /> أنهيت تكرارًا
              </Button>
              <span className="muted">حفظ محلي تجريبي بعد كل إقرار</span>
              <Button
                variant="secondary"
                onClick={async () => {
                  if (await commit({ type: "session.startRecall" })) go("S08");
                }}
              >
                انتقل إلى تجربة التسميع <ArrowLeft size={18} />
              </Button>
            </Card>
          </div>
          <Notice>
            التنقل بين خطوات العرض لا يسجل تعرضًا قرآنيًا. متطلبات التدريب
            الفعلية لا يمكن اجتيازها قبل توفر حزمة المحتوى وملف المنهج.
          </Notice>
          <div className="actions">
            <Button
              variant="ghost"
              onClick={async () => {
                if (await commit({ type: "session.pause" })) go("S10");
              }}
            >
              أحتاج إلى استراحة
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                notify(
                  "اقتراح تصغير الوحدة ينتظر HME وحدود محتوى معتمدة. لم نغيّر النطاق.",
                )
              }
            >
              صعّب عليّ هذا المقدار
            </Button>
          </div>
        </>
      )}
    </Page>
  );
}
function Recall() {
  const { state, commit, go, start, notify } = useApp();
  const s = state.session;
  const a = state.attempts.find((a) => a.id === s?.attemptId);
  const assist = async (type: "attempt.hint" | "attempt.reveal") => {
    if (await commit({ type })) {
      notify("حُفظ طلب المساعدة. لا يوجد نص قرآني لعرضه في النموذج.");
    }
  };
  return (
    <Page
      id="S08"
      description="مساحة التسميع خالية من الإجابة، بصريًا وفي شجرة الإتاحة."
    >
      {!s ? (
        <Card>
          <Empty
            title="ابدأ تجربة تسميع"
            action={
              <Button onClick={() => start("review")}>
                ابدأ التسميع التجريبي
              </Button>
            }
          >
            مسار يدوي بلا ميكروفون، ولا نص أو نتيجة تعلم.
          </Empty>
        </Card>
      ) : s.phase !== "recall" ? (
        <Card>
          <Empty
            title="المحاولة ليست في وضع التسميع"
            action={
              <Button
                onClick={() => go(s.phase === "assessment" ? "S09" : "S10")}
              >
                تابع الجلسة
              </Button>
            }
          >
            لا ننشئ محاولة ثانية عند فتح الشاشة.
          </Empty>
        </Card>
      ) : (
        <>
          <div className="session-bar">
            <Meta>
              {kinds[s.kind]} · {s.rangeLabel}
            </Meta>
            <Button
              variant="secondary"
              onClick={async () => {
                if (await commit({ type: "session.pause" })) go("S10");
              }}
            >
              <Pause size={17} /> إيقاف مؤقت
            </Button>
          </div>
          <Card className="recall-card">
            <div className="recall-symbol" aria-hidden="true">
              <Bookmark size={40} strokeWidth={1.2} />
            </div>
            <h2>خذ وقتك في التسميع</h2>
            <p>
              النص غير موجود في هذه التجربة.
              <br />
              جرّب تسجيل المساعدة أو ملاحظة خطأ، ثم التقييم.
            </p>
            <Meta>محاولة تجريبية جارية</Meta>
            <div className="recall-tools">
              <Button
                variant="secondary"
                onClick={async () => {
                  if (
                    await commit({
                      type: "mistake.add",
                      draft: {
                        attemptId: s.attemptId,
                        location: null,
                        type: "unknown",
                        certainty: "suspected",
                        selfCorrected: null,
                        assistanceUsed: null,
                        note: "",
                      },
                    })
                  )
                    go("S12");
                }}
              >
                ضع علامة على خطأ
              </Button>
              <Button
                variant="secondary"
                onClick={() => assist("attempt.hint")}
              >
                أحتاج إلى تلميح
              </Button>
              <Button variant="ghost" onClick={() => assist("attempt.reveal")}>
                أظهر النص
              </Button>
            </div>
            {a && a.hints > 0 && (
              <Notice tone="warning">
                سُجل {number(a.hints)} طلب مساعدة. إخفاء النص أو وصف الجهد بأنه
                سهل لا يمحو هذه الواقعة.
              </Notice>
            )}
            <div className="actions centered">
              <Button
                onClick={async () => {
                  if (await commit({ type: "attempt.finish" })) go("S09");
                }}
              >
                <Check size={19} /> أنهيت التسميع
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  if (
                    await commit({
                      type: "attempt.finish",
                      termination: "memory_failure",
                    })
                  )
                    go("S09");
                }}
              >
                لم أستطع الإكمال
              </Button>
            </div>
          </Card>
        </>
      )}
    </Page>
  );
}
function Assessment() {
  const { state, commit, go, editAttempt, setEditAttempt } = useApp();
  const [viewId] = useState(editAttempt ?? state.session?.attemptId);
  const current = state.attempts.find((a) => a.id === viewId);
  const [input, setInput] = useState<AssessmentInput>({
    completion: current?.completion ?? "unknown",
    errorObservation: current?.errorObservation ?? "unknown",
    effort: current?.effort ?? "unknown",
  });
  const [editing, setEditing] = useState(!!editAttempt);
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setInput({
      completion: current?.completion ?? "unknown",
      errorObservation: current?.errorObservation ?? "unknown",
      effort: current?.effort ?? "unknown",
    });
  }, [current?.id]);
  if (!current)
    return (
      <Page id="S09">
        <Card>
          <Empty
            title="لا توجد محاولة لتقييمها"
            action={
              <Button onClick={() => go("S08")}>انتقل إلى التسميع</Button>
            }
          >
            فتح شاشة التقييم لا ينشئ محاولة أو نجاحًا.
          </Empty>
        </Card>
      </Page>
    );
  const hasMistakes = state.mistakes.some(
    (m) => m.attemptId === current.id && m.certainty !== "disputed",
  );
  const report = current.assessed && !editing;
  const submit = async () => {
    const ok = await commit(
      editing
        ? { type: "attempt.correct", id: current.id, input, reason }
        : { type: "attempt.assess", input },
    );
    if (ok) {
      setEditing(false);
      setEditAttempt(null);
      setSaved(true);
    }
  };
  return (
    <Page id="S09" description="ما تتذكره صراحة، وما لا تعرفه يبقى غير معلوم.">
      <Card>
        <Meta>{current.rangeLabel} · بحسب تقييمك V1</Meta>
        {report ? (
          <>
            <h2>{saved ? "حُفظ تقريرك التجريبي" : "تقرير المحاولة المحفوظ"}</h2>
            <div className="stat-row">
              <div>
                <small>اكتمال التسميع</small>
                <strong>
                  {
                    {
                      complete: "كامل بحسب تقريرك",
                      partial: "جزئي",
                      unknown: "غير معلوم",
                    }[current.completion]
                  }
                </strong>
              </div>
              <div>
                <small>طلبات المساعدة</small>
                <strong>{number(current.hints)}</strong>
              </div>
              <div>
                <small>نتيجة الإتقان</small>
                <strong>غير مقاسة</strong>
              </div>
            </div>
            <Notice>
              حُفظ تقرير ذاتي، وليس نتيجة تحقق مستقلة. قرار المحرك والموعد
              المخطط واستحقاق السياسة: غير متاحة.
            </Notice>
            {current.status === "disputed" && (
              <Notice tone="warning">
                توجد مساعدة أو بيانات ناقصة أو متعارضة؛ لا تمنح هذه المحاولة
                نجاحًا صارمًا.
              </Notice>
            )}
            <div className="actions">
              <Button
                onClick={async () => {
                  if (!state.session || (await commit({ type: "session.end" })))
                    go("S05");
                }}
              >
                إلى ورد اليوم
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(true);
                  setReason("");
                }}
              >
                صحح تقييمي
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2>
              {editing ? "تصحيح التقييم مع حفظ الأصل" : "كيف كان تسميعك؟"}
            </h2>
            <div className="three-grid">
              <Field label="اكتمال التسميع">
                <select
                  value={input.completion}
                  onChange={(e) =>
                    setInput({
                      ...input,
                      completion: e.target
                        .value as AssessmentInput["completion"],
                    })
                  }
                >
                  <option value="unknown">غير معلوم</option>
                  <option value="complete">كامل</option>
                  <option value="partial">جزئي</option>
                </select>
              </Field>
              <Field label="الأخطاء بحسب ملاحظتك">
                <select
                  value={input.errorObservation}
                  onChange={(e) =>
                    setInput({
                      ...input,
                      errorObservation: e.target
                        .value as AssessmentInput["errorObservation"],
                    })
                  }
                >
                  <option value="unknown">لا أتذكر بدقة</option>
                  <option value="none">لم أرصد خطأ</option>
                  <option value="present">رصدت خطأ</option>
                </select>
              </Field>
              <Field label="الجهد">
                <select
                  value={input.effort}
                  onChange={(e) =>
                    setInput({
                      ...input,
                      effort: e.target.value as AssessmentInput["effort"],
                    })
                  }
                >
                  <option value="unknown">لم أحدد</option>
                  <option value="hard">بجهد كبير</option>
                  <option value="normal">بجهد معتاد</option>
                  <option value="easy">بسهولة</option>
                </select>
              </Field>
            </div>
            {(current.hints > 0 || current.revealed) && (
              <Notice tone="warning">
                سُجلت مساعدة في هذه المحاولة؛ اختيار «بسهولة» لا يلغيها.
              </Notice>
            )}
            {hasMistakes && input.errorObservation === "none" && (
              <Notice tone="warning">
                تعارض: توجد بلاغات خطأ مرتبطة بالمحاولة. سيبقى الادعاء محفوظًا
                مع التعارض، دون تحويله إلى نجاح.
              </Notice>
            )}
            {(input.completion === "unknown" ||
              input.errorObservation === "unknown") && (
              <Notice>
                يمكنك حفظ تقرير ناقص؛ لن يتحول المجهول إلى صفر أخطاء أو نتيجة
                ناجحة.
              </Notice>
            )}
            {editing && (
              <Field label="سبب التصحيح">
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="اشرح ما أردت تصحيحه"
                />
              </Field>
            )}
            <div className="actions">
              <Button onClick={submit}>
                {editing ? "احفظ التصحيح" : "احفظ التقييم"}
              </Button>
              <Button variant="secondary" onClick={() => go("S12")}>
                أضف خطأ
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  setEditAttempt(null);
                  if (editing) setEditing(false);
                  else if (await commit({ type: "session.pause" })) {
                    go("S10");
                  }
                }}
              >
                إلغاء التقييم
              </Button>
            </div>
          </>
        )}
        <details>
          <summary>سجل التصحيحات</summary>
          <p>
            عدد التصحيحات المرتبطة:{" "}
            {number(
              state.corrections.filter((c) => c.targetId === current.id).length,
            )}
            . لا تنشئ التصحيحات محاولات إضافية.
          </p>
          {state.corrections
            .filter((c) => c.targetId === current.id)
            .map((c) => (
              <p key={c.id}>
                {date(c.at)} — {c.reason}
              </p>
            ))}
        </details>
      </Card>
    </Page>
  );
}
function Resume() {
  const { state, commit, go } = useApp();
  const s = state.session;
  const recall =
    s?.phase === "recall" ||
    (s?.phase === "paused" && s.previousPhase === "recall");
  return (
    <Page id="S10">
      <Card>
        {!s ? (
          <Empty
            title="لا توجد جلسة غير مكتملة"
            action={<Button onClick={() => go("S05")}>إلى ورد اليوم</Button>}
          >
            تظهر هنا آخر نقطة حفظ مؤكدة عندما تبدأ جلسة.
          </Empty>
        ) : (
          <>
            <Meta>آخر حفظ: {date(s.updatedAt)}</Meta>
            <h2>{s.rangeLabel}</h2>
            <div className="stat-row">
              <div>
                <small>المرحلة</small>
                <strong>
                  {recall
                    ? "تسميع منقطع"
                    : s.phase === "training" || s.previousPhase === "training"
                      ? "تدريب"
                      : "تقييم"}
                </strong>
              </div>
              <div>
                <small>تكرارات محفوظة</small>
                <strong>{number(s.repeats)}</strong>
              </div>
            </div>
            <Notice>
              ما قيل أو فُعل خارج النموذج لا نستعيده بالتخمين. التوقف لا يعني
              خطأ حفظ، والمساعدة المسجلة لا تُمحى.
            </Notice>
            <div className="actions">
              {recall ? (
                <>
                  <Button
                    onClick={async () => {
                      if (await commit({ type: "session.restartRecall" }))
                        go("S08");
                    }}
                  >
                    ابدأ محاولة جديدة
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      if (await commit({ type: "session.finishedBeforeStop" }))
                        go("S09");
                    }}
                  >
                    كنت قد أنهيت التسميع
                  </Button>
                </>
              ) : (
                <Button
                  onClick={async () => {
                    if (await commit({ type: "session.resume" }))
                      go(
                        s.phase === "training" || s.previousPhase === "training"
                          ? "S07"
                          : "S09",
                      );
                  }}
                >
                  استأنف{" "}
                  {s.phase === "training" || s.previousPhase === "training"
                    ? "التدريب"
                    : "التقييم"}
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={async () => {
                  if (await commit({ type: "session.end" })) go("S05");
                }}
              >
                أنهِ الجلسة الآن
              </Button>
            </div>
          </>
        )}
      </Card>
    </Page>
  );
}
function Maintenance() {
  const { state, start, go, scenario } = useApp();
  return (
    <Page id="S11" description="تعاهد مستمر، واتصال يحتاج دليلًا مستقلًا.">
      <div className="two-grid">
        <Card>
          <Meta>الدورة الحالية: غير منشأة من HME</Meta>
          <h2>لكل مقدار عناية، ولكل رابط اختبار.</h2>
          <p>
            النطاقات المعلنة: {number(state.ranges.length)}. لا تتحول إلى محفوظ
            ثابت بمجرد إدخالها.
          </p>
          <div className="stat-row">
            <div>
              <small>التغطية الفعلية</small>
              <strong>غير مقاسة</strong>
            </div>
            <div>
              <small>الروابط</small>
              <strong>لم تُختبر</strong>
            </div>
          </div>
          <div className="actions">
            <Button onClick={() => start("maintenance")}>
              جرّب التعاهد <Play size={16} />
            </Button>
            <Button
              variant="secondary"
              onClick={() => start("link", "رابط تجريبي بلا موضع قرآني")}
            >
              جرّب التسميع المتصل
            </Button>
          </div>
        </Card>
        <Card className="soft-card">
          <h2>قدرة دورة التعاهد</h2>
          {scenario === "capacity" ? (
            <Notice tone="warning">
              مثال AC15: دورة كلفتها 900 دقيقة خلال 30 يومًا، وقدرة صيانة 20
              دقيقة يوميًا لا تكفي. لا يمدد النموذج سقف الدورة صامتًا.
            </Notice>
          ) : (
            <p>
              تقدير عبء المراجعة والوقت المتاح ينتظر ربط المحرك. لا نعرض دورة
              مكتملة أو قدرة مضمونة.
            </p>
          )}
          <Button variant="secondary" onClick={() => go("S06")}>
            إعادة توزيع الدورة
          </Button>
        </Card>
      </div>
      <Card>
        <h2>مواضع تحتاج عناية</h2>
        <p>
          بلاغاتك ظاهرة في سجل الأخطاء. لا يوجد زر يمنح «تم العلاج» دون إعادة
          اختبار مؤهلة.
        </p>
        <Button variant="ghost" onClick={() => go("S12")}>
          افتح سجل الأخطاء <ArrowLeft size={17} />
        </Button>
      </Card>
    </Page>
  );
}
function Mistakes() {
  const { state, commit, go, start, notify } = useApp();
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<string | null>(() =>
    state.session?.phase === "recall"
      ? ([...state.mistakes]
          .reverse()
          .find(
            (m) =>
              m.attemptId === state.session?.attemptId &&
              m.location === null &&
              m.type === "unknown" &&
              !m.note,
          )?.id ?? null)
      : null,
  );
  const [location, setLocation] = useState(""),
    [type, setType] = useState<MistakeDraft["type"]>("unknown"),
    [certainty, setCertainty] =
      useState<MistakeDraft["certainty"]>("suspected"),
    [note, setNote] = useState(""),
    [self, setSelf] = useState("unknown"),
    [assist, setAssist] = useState("unknown");
  const bool = (s: string) => (s === "unknown" ? null : s === "yes");
  const save = async () => {
    const fields = {
      location: location.trim() || null,
      type,
      certainty,
      selfCorrected: bool(self),
      assistanceUsed: bool(assist),
      note,
    };
    const ok = await commit(
      editing
        ? {
            type: "mistake.correct",
            id: editing,
            patch: fields,
            reason: "تصحيح صريح من محرر الخطأ",
          }
        : {
            type: "mistake.add",
            draft: { ...fields, attemptId: state.session?.attemptId ?? null },
          },
    );
    if (ok) {
      setEditing(null);
      setLocation("");
      setNote("");
      notify("حُفظ بلاغ الخطأ. الموضع غير المحدد يبقى مسودة.");
    }
  };
  const list = state.mistakes.filter(
    (m) =>
      filter === "all" ||
      filter === m.certainty ||
      filter === m.type ||
      filter === m.treatment,
  );
  return (
    <Page id="S12" description="فرّق بين ما لاحظته وما تظن أنه وقع.">
      <div className="two-grid">
        <Card>
          <h2>{editing ? "صحح المعلومة" : "أضف بلاغ خطأ"}</h2>
          <Meta>
            {state.session?.attemptId
              ? "مرتبط بالمحاولة الحالية"
              : "ملاحظة عامة، لا محاولة تاريخية"}
          </Meta>
          <Field
            label="الموضع إن كنت تعرفه"
            hint="مرجع وصفي فقط؛ لا تكتب نص الآية هنا"
          >
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="مثال: رقم السورة والآية"
              maxLength={200}
            />
          </Field>
          <div className="two-grid">
            <Field label="نوع الخطأ">
              <select
                value={type}
                onChange={(e) =>
                  setType(e.target.value as MistakeDraft["type"])
                }
              >
                <option value="unknown">غير محدد</option>
                <option value="word">لفظي</option>
                <option value="link">ربط</option>
                <option value="confusion">خلط</option>
              </select>
            </Field>
            <Field label="درجة التأكد">
              <select
                value={certainty}
                onChange={(e) =>
                  setCertainty(e.target.value as MistakeDraft["certainty"])
                }
              >
                <option value="suspected">أظن أنه وقع</option>
                <option value="observed">لاحظته</option>
                <option value="disputed">لم يقع / أصحح البلاغ</option>
              </select>
            </Field>
            <Field label="صححت بنفسك؟">
              <select value={self} onChange={(e) => setSelf(e.target.value)}>
                <option value="unknown">غير معلوم</option>
                <option value="yes">نعم</option>
                <option value="no">لا</option>
              </select>
            </Field>
            <Field label="استخدمت مساعدة؟">
              <select
                value={assist}
                onChange={(e) => setAssist(e.target.value)}
              >
                <option value="unknown">غير معلوم</option>
                <option value="yes">نعم</option>
                <option value="no">لا</option>
              </select>
            </Field>
          </div>
          <Field label="ملاحظة اختيارية">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
          </Field>
          <div className="actions">
            <Button onClick={save}>
              {editing ? "احفظ تصحيح الخطأ" : "احفظ البلاغ"}
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                go(
                  state.session?.phase === "recall"
                    ? "S08"
                    : state.session?.phase === "assessment"
                      ? "S09"
                      : "S05",
                )
              }
            >
              العودة للمحاولة
            </Button>
          </div>
        </Card>
        <Card>
          <Field label="تصفية السجل">
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">كل البلاغات</option>
              <option value="observed">مرصود</option>
              <option value="suspected">مشتبه</option>
              <option value="link">ربط</option>
              <option value="confusion">خلط</option>
              <option value="awaiting_retest">ينتظر إعادة اختبار</option>
              <option value="disputed">مصحح / منفي</option>
            </select>
          </Field>
          {!list.length ? (
            <Empty title="لا توجد بلاغات في هذا العرض">
              هذا لا يعني اكتمال التحقق من المحفوظ.
            </Empty>
          ) : (
            list.map((m) => (
              <article className="mistake-item" key={m.id}>
                <Meta>
                  {m.certainty === "suspected"
                    ? "مشتبه"
                    : m.certainty === "observed"
                      ? "مرصود بحسب تقريرك"
                      : "مصحح / منفي"}
                </Meta>
                <h3>{m.location ?? "مسودة بلا موضع محدد"}</h3>
                <p>{m.note || "لا توجد ملاحظة إضافية"}</p>
                <small>
                  {date(m.createdAt)} ·{" "}
                  {m.treatment === "open"
                    ? "لم تُثبت المعالجة"
                    : "ينتظر إعادة اختبار"}
                </small>
                <div className="actions">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditing(m.id);
                      setLocation(m.location ?? "");
                      setType(m.type);
                      setCertainty(m.certainty);
                      setNote(m.note);
                      setSelf(
                        m.selfCorrected === null
                          ? "unknown"
                          : m.selfCorrected
                            ? "yes"
                            : "no",
                      );
                      setAssist(
                        m.assistanceUsed === null
                          ? "unknown"
                          : m.assistanceUsed
                            ? "yes"
                            : "no",
                      );
                    }}
                  >
                    صحح هذه المعلومة
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      if (
                        await commit({
                          type: "mistake.correct",
                          id: m.id,
                          patch: { treatment: "awaiting_retest" },
                          reason: "طلب معالجة، لا اجتياز",
                        })
                      )
                        start("new", m.location ?? "موضع غير محدد");
                    }}
                  >
                    جرّب المعالجة
                  </Button>
                </div>
              </article>
            ))
          )}
        </Card>
      </div>
    </Page>
  );
}
function Recovery() {
  const { state, commit, start, go, notify } = useApp();
  const [answer, setAnswer] = useState(state.recoveryReport);
  const [minutes, setMinutes] = useState(state.config.minutes);
  return (
    <Page id="S13" description="غيابك لا يحكم على محفوظك. نبدأ بما يمكن فحصه.">
      <Card className="recovery-card">
        <HeartHandshake size={42} />
        <h2>لنعد بخطوة مناسبة.</h2>
        <p>
          تجربة مسار العودة لا تصفّر تاريخًا، ولا تسجل إخفاقًا عن أيام الغياب.
        </p>
        <div className="two-grid">
          <Field label="وقتك المتاح في الإعداد">
            <input
              type="number"
              min="0"
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </Field>
          <Field label="هل راجعت خارج التطبيق؟">
            <select
              value={answer}
              onChange={async (e) => {
                const value = e.target
                  .value as PrototypeState["recoveryReport"];
                if (await commit({ type: "recovery.report", value }))
                  setAnswer(value);
              }}
            >
              <option value="skipped">أفضل التخطي</option>
              <option value="yes">نعم</option>
              <option value="no">لا</option>
              <option value="unknown">لا أتذكر</option>
            </select>
          </Field>
        </div>
        <Notice>
          هذا تصريح عام. لا يولّد محاولات مؤرخة أو نتيجة إتقان. اختيار العينة
          الحقيقي ينتظر C03.
        </Notice>
        <div className="actions">
          <Button
            onClick={async () => {
              if (
                await commit({
                  type: "config",
                  config: { ...state.config, minutes },
                })
              ) {
                notify(
                  "حُفظ الوقت. حُفظ تصريح المراجعة الخارجية ولا يكوّن أدلة.",
                );
                start(
                  "recovery",
                  state.ranges[0]
                    ? rangeLabel(state.ranges[0])
                    : "نطاق عودة توضيحي",
                );
              }
            }}
          >
            ابدأ بخطوة تجريبية
          </Button>
          <Button variant="secondary" onClick={() => go("S05")}>
            أكمل لاحقًا
          </Button>
        </div>
      </Card>
    </Page>
  );
}
function Progress() {
  const { state, go, setPart, progress, refreshProgress, companion, refreshCompanion } = useApp();
  return (
    <Page id="S14" description="إنجازك المسجل، ونتائجك الذاتية، وما يحتاج إلى دليل إضافي.">
      <section aria-label="ملخص التقدم"><ProgressContent state={progress} retry={refreshProgress} detailed /></section>
      <CompanionPanel state={companion} retry={refreshCompanion} detailed />
      <Card>
        <h2>المحفوظ المعلن</h2>
        <p>{number(state.ranges.length)} نطاقًا معلنًا محفوظًا محليًا. التصريح لا يثبت اجتياز الحفظ، ولا يدخل في نسبة الإنجاز.</p>
        <Button variant="ghost" onClick={() => go("S03")}>إدارة النطاقات <ArrowLeft size={17} /></Button>
        <details>
          <summary>استكشاف الأجزاء المعلنة</summary>
          <div className="juz-grid" aria-label="الأجزاء الثلاثون">
            {Array.from({ length: 30 }, (_, i) => {
              const declared = state.ranges.some(r => r.kind === "juz" && r.start <= i + 1 && r.end >= i + 1);
              return <button key={i} className={declared ? "declared" : ""}
                aria-label={`الجزء ${i + 1}، ${declared ? "محفوظ معلن غير مختبر" : "لم يُختبر بعد"}`}
                onClick={() => { setPart(i + 1); go("S15"); }}>
                <span>{number(i + 1)}</span><small>{declared ? "معلن" : "غير مختبر"}</small>
              </button>;
            })}
          </div>
        </details>
        <div className="actions">
          <Button variant="secondary" onClick={() => go("S12")}>سجل الأخطاء</Button>
          <Button variant="ghost" onClick={() => go("S19")}>عرض التوقعات</Button>
        </div>
      </Card>
    </Page>
  );
}
function Detail() {
  const { part, state, go, start, setEditAttempt } = useApp();
  return (
    <Page
      id="S15"
      description={"الجزء " + number(part) + " · لا توجد خريطة طبعة معتمدة بعد"}
    >
      <Card>
        <Meta>تغطية غير مقاسة</Meta>
        <h2>ما الذي اختُبر في هذا النطاق؟</h2>
        <div className="stat-row">
          <div>
            <small>الألفاظ</small>
            <strong>لم تُختبر</strong>
          </div>
          <div>
            <small>الاتصال</small>
            <strong>لم يُختبر</strong>
          </div>
          <div>
            <small>صفحات الطبعة</small>
            <strong>غير متاحة</strong>
          </div>
        </div>
        <Notice>
          لا نورّث ثبات الجزء من متوسط المقاطع. تحويل الجزء إلى سور وآيات وصفحات
          ينتظر C01؛ لا نختلق روابط أو مواضع.
        </Notice>
        <div className="actions">
          <Button
            onClick={() => start("review", "الجزء " + part + " — مرجع تجريبي")}
          >
            جرّب مراجعة هذا المقدار
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              start("link", "رابط في الجزء " + part + " — غير محلول إلى نص")
            }
          >
            جرّب اختبار الربط
          </Button>
          <Button variant="ghost" onClick={() => go("S16")}>
            افتح المصحف
          </Button>
        </div>
      </Card>
      <Card>
        <h2>المحاولات التجريبية</h2>
        <p>
          سجل عام للتجربة؛ لا يمثل تغطية هذا الجزء لأن النطاقات لم تُحل إلى نص.
        </p>
        {!state.attempts.length ? (
          <Empty title="لا توجد محاولات">
            ابدأ مسارًا تجريبيًا لتفحص التقييم والتصحيح.
          </Empty>
        ) : (
          state.attempts.map((a) => (
            <div className="task-row" key={a.id}>
              <div>
                <strong>{a.rangeLabel}</strong>
                <p>
                  {a.assessed ? "تقرير ذاتي محفوظ" : "غير مكتملة"} ·{" "}
                  {date(a.startedAt)}
                </p>
              </div>
              {a.assessed && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditAttempt(a.id);
                    go("S09");
                  }}
                >
                  صحح التقييم
                </Button>
              )}
            </div>
          ))
        )}
      </Card>
    </Page>
  );
}
function Reader() {
  const { notify, state, commit, start } = useApp();
  const [surah, setSurah] = useState(1),
    [ayah, setAyah] = useState(1),
    [size, setSize] = useState(24),
    [begin, setBegin] = useState<string | null>(null),
    [end, setEnd] = useState<string | null>(null);
  return (
    <Page
      id="S16"
      description="النص ثابت من مصدر معتمد؛ لا نولّده ولا نعيد صياغته."
    >
      <Card>
        <div className="reader-controls">
          <Field label="رقم السورة">
            <input
              type="number"
              min="1"
              max="114"
              value={surah}
              onChange={(e) => setSurah(Number(e.target.value))}
            />
          </Field>
          <Field label="رقم الآية">
            <input
              type="number"
              min="1"
              value={ayah}
              onChange={(e) => setAyah(Number(e.target.value))}
            />
          </Field>
          <Button
            variant="secondary"
            onClick={() =>
              notify(
                Number.isInteger(surah) &&
                  surah >= 1 &&
                  surah <= 114 &&
                  Number.isInteger(ayah) &&
                  ayah >= 1
                  ? "الموضع محدد للمعاينة فقط؛ تعذر حلّه دون حزمة معتمدة."
                  : "أدخل أرقامًا صحيحة للنطاق.",
              )
            }
          >
            اذهب إلى
          </Button>
          <Button
            variant="ghost"
            onClick={() => setSize(Math.min(size + 2, 40))}
            disabled={size === 40}
          >
            كبّر النص
          </Button>
          <Button
            variant="ghost"
            onClick={() => setSize(Math.max(size - 2, 18))}
            disabled={size === 18}
          >
            صغّر النص
          </Button>
        </div>
        <div className="reader-stage" style={{ fontSize: size }}>
          <ContentUnavailable />
        </div>
        <div className="actions centered">
          <Button
            variant="secondary"
            onClick={() =>
              notify("التلاوة المعتمدة غير مرفقة. لم يبدأ صوت أو يسجل استماع.")
            }
          >
            <Headphones size={18} /> استمع
          </Button>
          <Button
            variant="secondary"
            onClick={() => notify("لا يتوفر تفسير معتمد بمصدره وترخيصه.")}
          >
            <FileText size={18} /> التفسير ومصدره
          </Button>
        </div>
      </Card>
      <Card>
        <h2>تجربة تحديد المقدار</h2>
        <p>
          البداية: {begin ?? "غير محددة"} · النهاية: {end ?? "غير محددة"}
        </p>
        <div className="actions">
          <Button
            variant="secondary"
            onClick={() => setBegin("سورة " + surah + "، آية " + ayah)}
          >
            حدد بداية المقدار
          </Button>
          <Button
            variant="secondary"
            onClick={() => setEnd("سورة " + surah + "، آية " + ayah)}
          >
            حدد نهايته
          </Button>
          <Button
            onClick={async () => {
              if (state.session?.phase === "recall")
                await commit({ type: "attempt.reveal" });
              start("new", "مقدار عرض غير معتمد");
            }}
          >
            جرّب أدوات الحفظ
          </Button>
        </div>
        <Notice>
          إنشاء وحدة قرآن صالحة والتحقق من الحدود متوقفان إلى حين اعتماد
          المحتوى.
        </Notice>
      </Card>
    </Page>
  );
}
function Preferences() {
  const { state, commit, go, notify, service } = useApp();
  return (
    <Page id="S17" description="اضبط ما يجعل تجربتك أهدأ وأوضح.">
      <div className="two-grid">
        <Card>
          <h2>الخطة والمحفوظ</h2>
          <div className="setting-row">
            <div>
              <strong>{personas[state.config.persona]}</strong>
              <p>
                {number(state.config.minutes)} دقيقة ·{" "}
                {number(state.config.days.length)} أيام
              </p>
            </div>
            <Button variant="secondary" onClick={() => go("S02")}>
              تعديل خطتي
            </Button>
          </div>
          <Button variant="ghost" onClick={() => go("S03")}>
            تعديل المحفوظ المعلن <ArrowLeft size={17} />
          </Button>
          <h2>المظهر وإمكانية الوصول</h2>
          {(
            [
              ["dark", "الوضع الداكن"],
              ["largeText", "تكبير النص"],
              ["reducedMotion", "تقليل الحركة"],
            ] as const
          ).map(([key, label]) => (
            <label className="toggle-row" key={key}>
              <span>{label}</span>
              <input
                type="checkbox"
                checked={state.preferences[key]}
                onChange={async (e) =>
                  await commit({
                    type: "preferences",
                    patch: { [key]: e.target.checked },
                  })
                }
              />
            </label>
          ))}
        </Card>
        <Card>
          <h2>التذكيرات</h2>
          <label className="toggle-row">
            <span>تفضيل التذكير</span>
            <input
              type="checkbox"
              checked={state.preferences.reminder}
              onChange={async (e) =>
                await commit({
                  type: "preferences",
                  patch: { reminder: e.target.checked },
                })
              }
            />
          </label>
          <Notice>
            إذن النظام لم يُطلب. لا توجد إشعارات مجدولة؛ حفظ التفضيل لا يعني
            تفعيلها.
          </Notice>
          <h2>بوابات التحقق</h2>
          <p>جلسات القرآن تنتظر اكتمال أدلة الاعتماد. نجاح البناء لا يفتحها.</p>
          <ul>
            {service.releaseGates.map((g) => (
              <li key={g.gate}>
                <span dir="ltr">{g.gate}</span> —{" "}
                {
                  (
                    {
                      G01: "سلامة المحتوى",
                      G02: "مطابقة الجدولة",
                      G03: "عقود المحرك",
                      G04: "موثوقية التخزين",
                      G05: "النسخ والاستعادة",
                      G06: "رحلات المتصفح",
                      G07: "المنصة",
                      G08: "إمكانية الوصول",
                      G09: "المراجعة الأمنية",
                      G10: "المراجعة المتخصصة",
                    } as Record<string, string>
                  )[g.gate]
                }
                : {g.status === "passed" ? "متحققة" : "معلقة"}
              </li>
            ))}
          </ul>
          <h2>المحتوى والمنهج</h2>
          <p>
            العربية، حفص عن عاصم مستهدفان. النص والطبعة والصوت والتفسير غير
            معتمدة في هذه الحزمة.
          </p>
          <Button
            variant="ghost"
            onClick={() =>
              notify(
                "HME-0.1 / 05A-1، سياسة P0-1. اجتازت النواة المصححة 40 حالة مقابل ts-fsrs 5.4.2. تشغيلها وترحيل السجلات واعتماد المحتوى ما زالت معلقة؛ لا ترقية صامتة.",
              )
            }
          >
            عرض الإصدارات
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              notify(
                "مسار المحتوى ينتظر المصدر والترخيص والبصمة وخريطة الطبعة. لا توجد حزمة لتنزيلها الآن.",
              )
            }
          >
            إدارة المحتوى
          </Button>
        </Card>
      </div>
      <Card>
        <div className="setting-row">
          <div>
            <h2>الخصوصية وبياناتك</h2>
            <p>
              سجل محلي مشفر داخل المتصفح. لا حساب إلزامي ولا رفع تلقائي. لا يوفر
              هذا حماية من وصول شخص إلى متصفحك المفتوح.
            </p>
          </div>
          <Button onClick={() => go("S18")}>إدارة البيانات والنسخ</Button>
        </div>
        <details>
          <summary>عن النموذج والمساعدة</summary>
          <p className="policy-links"><a href="./privacy.html">الخصوصية</a> · <a href="./support.html">الدعم والمساعدة</a> · <a href="./terms.html">حدود الاستخدام</a></p>
          <p>
            مُلازَمَة — MULAZAMA، إصدار هندسي 06-L2 للويب. اختبار هاتف حقيقي ومراجعة متخصصة لم ينجزا بعد. المطابقة الحسابية المصححة مثبتة، وتشغيل الجلسات واعتماد المحتوى ما زالا معلقين.
          </p>
        </details>
      </Card>
    </Page>
  );
}
function Data({
  controller,
  learningAttached = false,
}: {
  controller?: CompositeDataController;
  learningAttached?: boolean;
}) {
  const { state, commit, service, refresh, notify, go } = useApp();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState<"delete" | "restore" | null>(null);
  const [pending, setPending] = useState<{
    serialized: string;
    eventCount: number;
    fileName: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastExport, setLastExport] = useState("");
  const dataService = controller ?? service;
  const exportData = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const serialized = await dataService.exportBackup(password);
      const url = URL.createObjectURL(
        new Blob([serialized], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "mulazama-encrypted-backup.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setLastExport(new Date().toISOString());
      notify(
        "جُهزت النسخة المشفرة للتنزيل. احتفظي بكلمة المرور والملف خارج هذا الجهاز.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "تعذر تصدير النسخة؛ لم تتغير البيانات.",
      );
    } finally {
      setBusy(false);
    }
  };
  const readFile = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setPending(null);
    try {
      if (file.size > 50_000_000)
        throw new Error("حجم الملف يتجاوز 50 ميغابايت؛ لم تتغير البيانات.");
      const serialized = await file.text();
      const inspection = await dataService.inspectBackup(serialized, password);
      if (!inspection.compatible) throw new Error(inspection.reason);
      setPending({
        serialized,
        eventCount: inspection.eventCount,
        fileName: file.name,
      });
      setConfirm("restore");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "تعذر فحص النسخة؛ لم تتغير البيانات.",
      );
    } finally {
      setBusy(false);
    }
  };
  const restore = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await dataService.replaceFromBackup(
        pending.serialized,
        password,
        true,
      );
      await refresh();
      setPending(null);
      setConfirm(null);
      notify("استُبدلت البيانات بعد التحقق من النسخة المشفرة.");
      go(next.session ? "S10" : "S05");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "فشلت الاستعادة؛ بقيت البيانات السابقة.",
      );
    } finally {
      setBusy(false);
    }
  };
  if (learningAttached && !controller)
    return (
      <Page id="S18">
        <Notice tone="error">
          إدارة البيانات معلقة: يلزم ربط نسخة موحدة تشمل إعداداتك ووقائع التعلم
          معًا. لم تُجهز نسخة جزئية ولم تُحذف بيانات.
        </Notice>
      </Page>
    );
  return (
    <Page
      id="S18"
      description="نسخة محلية مشفرة، واستعادة كاملة بعد فحصها وتأكيد الاستبدال."
    >
      <Card>
        <Field
          label="كلمة مرور النسخة"
          hint="استخدمي 12 حرفًا على الأقل. لا يمكن استعادة كلمة المرور المفقودة."
        >
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Notice>
          كلمة المرور لا تُحفظ ولا تُرفع. احتفظي بنسخة من الملف وكلمة المرور في
          مكان مناسب.
        </Notice>
      </Card>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="two-grid">
        <Card>
          <Download />
          <h2>تصدير نسخة مشفرة</h2>
          <p>
            تشمل سجل الأحداث والإعدادات والتصريحات. لا تحتوي نص قرآن أو تسجيلات
            صوتية.
          </p>
          <Button disabled={busy} onClick={exportData}>
            صدّر النسخة المشفرة
          </Button>
          <p className="muted">
            آخر تجهيز في هذه الزيارة:{" "}
            {lastExport ? date(lastExport) : "لا يوجد"}
          </p>
        </Card>
        <Card>
          <Upload />
          <h2>فحص نسخة واستعادتها</h2>
          <p>
            أدخلي كلمة مرور النسخة، ثم اختاري الملف. لا يغير الفحص البيانات
            الحالية.
          </p>
          <Field label="اختر النسخة المشفرة">
            <input
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(e) => {
                void readFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </Field>
        </Card>
      </div>
      <Card className="danger-card">
        <h2>حذف بيانات التعلم</h2>
        <p>
          يحذف التصريحات والمحاولات والأخطاء والجلسات والتصحيحات. تبقى إعدادات
          البداية وتفضيلات العرض بهوية محلية جديدة. تحتاج النسخ المصدرة خارج
          التطبيق إلى حذفها من مكانها.
        </p>
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => setConfirm("delete")}
        >
          <Trash2 size={18} /> احذف بيانات التعلم كاملة
        </Button>
      </Card>
      {confirm === "delete" && (
        <Modal
          title="هل تريد حذف بيانات التعلم؟"
          onClose={() => setConfirm(null)}
        >
          <p>
            سيُمسح السجل الحالي: {number(state.ranges.length)} نطاقات،{" "}
            {number(state.attempts.length)} محاولات،{" "}
            {number(state.mistakes.length)} بلاغات. يلزم ملف نسخة سابقة
            لاسترجاعها.
          </p>
          <div className="actions">
            <Button
              autoFocus
              data-dialog-initial-focus="true"
              variant="secondary"
              onClick={() => setConfirm(null)}
            >
              إلغاء
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                let deleted = false;
                if (controller) {
                  setBusy(true);
                  try {
                    await controller.reset(true);
                    await refresh();
                    deleted = true;
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "تعذر الحذف؛ لم يثبت اكتماله.",
                    );
                  } finally {
                    setBusy(false);
                  }
                } else deleted = await commit({ type: "reset" });
                if (deleted) {
                  setConfirm(null);
                  notify(
                    "حُذفت بيانات التعلم. النسخ الخارجية تحتاج حذفًا منفصلًا.",
                  );
                  go("S01");
                }
              }}
            >
              تأكيد الحذف
            </Button>
          </div>
        </Modal>
      )}
      {confirm === "restore" && pending && (
        <Modal
          title="مراجعة الملف قبل الاستبدال"
          onClose={() => {
            setConfirm(null);
            setPending(null);
          }}
        >
          <p>
            الملف: <bdi>{pending.fileName}</bdi> · {number(pending.eventCount)}{" "}
            أحداث.
          </p>
          <Notice tone="warning">
            ستستبدل النسخة جميع بياناتك الحالية. لا تدمج البيانات ولا تستورد
            أذونات النظام.
          </Notice>
          <div className="actions">
            <Button disabled={busy} onClick={restore}>
              تأكيد الاستبدال الكامل
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setConfirm(null);
                setPending(null);
              }}
            >
              إلغاء
            </Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}
function Forecast() {
  const { state, commit, go } = useApp();
  const [minutes, setMinutes] = useState(state.config.minutes);
  const [preview, setPreview] = useState(false);
  const [approve, setApprove] = useState(false);
  const query = useQuery("C10", { operation: "preview", minutes });
  return (
    <Page
      id="S19"
      description="تقدير يتغير بحسب الوقت والمراجعات والأداء الفعلي."
    >
      <Card className="forecast-intro">
        <ChartNoAxesCombined size={38} />
        <h2>
          نحتاج إلى بيانات أكثر،
          <br />
          قبل أن نقدّر الطريق.
        </h2>
        <p>{query.ok ? query.value.reason : "تعذر قراءة حالة التوقع."}</p>
        <Meta>لا تاريخ ختام شخصي · لا موعد للإتقان</Meta>
      </Card>
      <div className="four-grid">
        {[1, 3, 6, 12].map((n) => (
          <Card key={n}>
            <span className="eyebrow">
              {n === 1
                ? "بعد شهر"
                : n === 12
                  ? "بعد سنة"
                  : "بعد " + number(n) + " أشهر"}
            </span>
            <h2>غير متاح</h2>
            <p>لا توجد بيانات مؤهلة</p>
          </Card>
        ))}
      </div>
      <Card>
        <details>
          <summary>كيف سيُحسب؟</summary>
          <p>
            خدمة منتج مستقلة عن HME تحتاج إنجازًا فعليًا وزمنًا موثقًا وعبء
            مراجعة معروفًا وتحققًا من كفاية البيانات. لا يُضرب مقدار يومي في عدد
            الأيام لتوليد موعد مضمون. السيناريوهات البعيدة تنتظر بوابة D08.
          </p>
        </details>
        <Field label="جرّب وقتًا مختلفًا بالدقائق">
          <input
            type="number"
            min="0"
            max="1440"
            value={minutes}
            onChange={(e) => {
              setMinutes(Number(e.target.value));
              setPreview(false);
            }}
          />
        </Field>
        <div className="actions">
          <Button variant="secondary" onClick={() => setPreview(true)}>
            معاينة الوقت
          </Button>
          <Button
            disabled={!preview || minutes === state.config.minutes}
            onClick={() => setApprove(true)}
          >
            اعتمد الوقت
          </Button>
          <Button variant="ghost" onClick={() => go("S05")}>
            إلى ورد اليوم
          </Button>
        </div>
        {preview && (
          <Notice>
            معاينة {number(minutes)} دقيقة فقط. إعدادك المحفوظ ما زال{" "}
            {number(state.config.minutes)} دقيقة، والتوقع يظل ممتنعًا حتى تتوفر
            بيانات مؤهلة.
          </Notice>
        )}
      </Card>
      {approve && (
        <Modal title="اعتماد الوقت في إعدادك" onClose={() => setApprove(false)}>
          <p>
            سيتغير الوقت المعتاد من {number(state.config.minutes)} إلى{" "}
            {number(minutes)} دقيقة. لا يُنتج هذا التعديل توقعًا شخصيًا.
          </p>
          <div className="actions">
            <Button
              onClick={async () => {
                if (
                  await commit({
                    type: "config",
                    config: { ...state.config, minutes },
                  })
                )
                  setApprove(false);
              }}
            >
              تأكيد اعتماد الوقت
            </Button>
            <Button variant="secondary" onClick={() => setApprove(false)}>
              إلغاء
            </Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}
