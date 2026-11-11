import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bookmark,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  CircleHelp,
  Clock3,
  Download,
  HeartHandshake,
  Home,
  Info,
  Leaf,
  Link2,
  LockKeyhole,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { ProductV211, SYNTHETIC_CATALOG } from "./application/product-v211";
import type { ProductCommand, ProductState } from "./application/product-v211";
import { unionRanges, type Interval } from "./domain/taahud-v211";
import { v211ContentStatus } from "./content/v211-status";
import "./v211.css";

type Screen =
  | "welcome"
  | "account"
  | "setup"
  | "today"
  | "hifz"
  | "link"
  | "week"
  | "taahud"
  | "progress"
  | "mushaf"
  | "settings"
  | "privacy";
type Session = ProductState["sessions"][number];
type Task = ProductState["tasks"][number];
type Proposal = ProductState["proposals"][number];
type Run = (
  command: ProductCommand,
  message?: string,
  options?: { expectedRevision?: number },
) => Promise<ProductState | null>;
const screenNames: Record<Screen, string> = {
  welcome: "مرحبًا بك",
  account: "الحساب",
  setup: "إعداد رحلتك",
  today: "اليوم",
  hifz: "الحفظ الجديد",
  link: "التثبيت",
  week: "مراجعة الأسبوع",
  taahud: "التعاهد",
  progress: "تقدّمك",
  mushaf: "المصحف",
  settings: "الإعدادات",
  privacy: "خصوصية التجربة",
};
const navigation = [
  { id: "today", label: "اليوم", icon: Home },
  { id: "mushaf", label: "المصحف", icon: BookOpen },
  { id: "week", label: "مراجعة الأسبوع", icon: CalendarDays },
  { id: "taahud", label: "التعاهد", icon: HeartHandshake },
  { id: "progress", label: "التقدّم", icon: TrendingUp },
  { id: "settings", label: "الإعدادات", icon: Settings },
] as const;
const Busy = createContext(false);
const num = (n: number) => n.toLocaleString("ar-SA");
const size = (ranges: readonly Interval[]) =>
  ranges.reduce((sum, r) => sum + r.end - r.start, 0);
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("ar-SA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    calendar: "gregory",
    timeZone: "UTC",
  }).format(new Date(date + "T12:00:00Z"));
const rangeLabel = (range: Interval) =>
  `الوحدات ${num(range.start + 1)}–${num(range.end)}`;
const prefixRanges = (ranges: readonly Interval[], amount: number) => {
  let left = amount;
  return ranges.flatMap((r) => {
    const n = Math.min(left, r.end - r.start);
    left -= n;
    return n ? [{ start: r.start, end: r.start + n }] : [];
  });
};
const contains = (coverage: readonly Interval[], range: Interval) =>
  coverage.some((r) => r.start <= range.start && r.end >= range.end);
function Button({
  children,
  variant = "",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "secondary" | "ghost" | "";
}) {
  const busy = useContext(Busy);
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      className={`v211-btn ${variant} ${className}`}
    >
      {children}
    </button>
  );
}
function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`v211-card ${className}`}>{children}</section>;
}
function Ranges({ ranges }: { ranges: readonly Interval[] }) {
  return (
    <div className="v211-ranges">
      {ranges.map((r) => (
        <span className="v211-range" key={`${r.start}-${r.end}`}>
          {rangeLabel(r)}
        </span>
      ))}
    </div>
  );
}
function Notice({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: "" | "error" | "success";
}) {
  return (
    <div
      className={`v211-alert ${tone}`}
      role={tone === "error" ? "alert" : undefined}
    >
      <Info size={19} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="v211-empty">
      <Leaf size={34} aria-hidden="true" />
      <h2>{title}</h2>
      <p className="v211-subtle">{children}</p>
      {action}
    </div>
  );
}
function Heading({
  title,
  subtitle,
  eyebrow = "رفيق رحلتك مع القرآن",
  date,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  date?: string;
}) {
  return (
    <header className="v211-heading">
      <div>
        <div className="v211-eyebrow">{eyebrow}</div>
        <h1 tabIndex={-1}>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {date && (
        <div className="v211-date">
          <CalendarDays size={17} aria-hidden="true" />
          {dateLabel(date)}
        </div>
      )}
    </header>
  );
}
function initialScreen(configured: boolean): Screen {
  const hash = location.hash.replace("#v211-", "");
  return hash in screenNames
    ? (hash as Screen)
    : configured
      ? "today"
      : "welcome";
}
function describeError(error: unknown) {
  const code = error instanceof Error ? error.message : String(error);
  const errors: Record<string, string> = {
    INVALID_INPUT: "راجعي القيم المدخلة؛ لم يُحفظ التغيير.",
    REVISION_CONFLICT:
      "تغيّر السجل في نافذة أخرى. أعيدي المحاولة بعد تحديث البيانات.",
    IDEMPOTENCY_CONFLICT:
      "تعذر تكرار هذا الطلب بمعطيات مختلفة. حدّثي الصفحة ثم أعيدي المحاولة.",
    NO_NEW_RANGE:
      "اكتملت مقادير التجربة المتاحة. يمكنك متابعة المراجعة والتعاهد.",
    NO_WEEKLY_RANGES: "لا يوجد حفظ مكتمل لهذا الأسبوع؛ لا مراجعة مطلوبة الآن.",
    ADJACENCY_REQUIRED:
      "لا يوجد وجه سابق محفوظ ومتصل؛ التثبيت غير منطبق لهذا المقدار.",
    NO_ADJACENT_COVERAGE: "التثبيت غير منطبق؛ الوجه السابق غير محفوظ بالكامل.",
    SCHEDULE_CONFLICT:
      "يوجد تداخل مع موعد محفوظ. بقي الإنجاز محفوظًا، ويحتاج الموعد إلى مراجعة.",
    STORAGE_FULL: "تعذر الحفظ لعدم توفر مساحة. بقي آخر عدد محفوظ دون تغيير.",
    CONTENT_BLOCKED: "المحتوى القرآني غير متاح حتى اكتمال اعتماد الحزمة.",
  };
  return (
    errors[code] ??
    "تعذر حفظ العملية. بقي آخر حفظ مؤكد؛ أعيدي المحاولة أو حدّثي الصفحة."
  );
}

export default function V211App({ service }: { service: ProductV211 }) {
  const [state, setState] = useState(() => service.state);
  const [screen, setScreen] = useState<Screen>(() =>
    initialScreen(!!service.state.plan),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const mainRef = useRef<HTMLElement>(null),
    serial = useRef(false);
  const go = (next: Screen) => {
    location.hash = `v211-${next}`;
    setScreen(next);
    setError("");
    setMessage("");
  };
  useEffect(() => {
    const changed = () => setScreen(initialScreen(!!service.state.plan));
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, [service]);
  useEffect(() => {
    document.title = `${screenNames[screen]} · مُلازَمَة`;
    mainRef.current?.querySelector("h1")?.focus();
    window.scrollTo({ top: 0 });
  }, [screen]);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      if (serial.current || document.visibilityState === "hidden") return;
      void service
        .refresh()
        .then((next) => {
          if (alive && !serial.current) setState(next);
        })
        .catch(() => {
          if (alive)
            setError("تعذر تحديث السجل المحلي. أعيدي فتح الصفحة للمحاولة.");
        });
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => {
      alive = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, [service]);
  const run: Run = async (
    command,
    success = "حُفظ التغيير على هذا الجهاز.",
    options = {},
  ) => {
    if (serial.current) return null;
    serial.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await service.dispatch(command, options);
      setState(next);
      setMessage(success);
      return next;
    } catch (cause) {
      setError(describeError(cause));
      try {
        setState(await service.refresh());
      } catch {
        /* Keep the confirmed visible state. */
      }
      return null;
    } finally {
      serial.current = false;
      setBusy(false);
    }
  };
  const view = service.view(),
    configured = !!state.plan;
  const safeScreen =
    !configured &&
    !["welcome", "account", "setup", "privacy", "mushaf"].includes(screen)
      ? "welcome"
      : screen;
  const today = service.today();
  const startHifz = async () => {
    if (view.activeHifz) {
      if (
        view.activeHifz.state === "paused" &&
        !(await run({ type: "resume-session", sessionId: view.activeHifz.id }))
      )
        return;
      go("hifz");
      return;
    }
    if (
      await run(
        { type: "start-hifz" },
        "بدأت جلسة الحفظ. النطاق والهدف ثابتان لهذه الجلسة.",
      )
    )
      go("hifz");
  };

  const linkSource = state.sessions
    .filter(
      (s) =>
        s.kind === "hifz" &&
        s.state === "completed" &&
        !state.sessions.some(
          (l) =>
            l.kind === "link" &&
            l.newRange?.start === s.rangeSnapshot[0]?.start,
        ),
    )
    .filter((s) => {
      const start = s.rangeSnapshot[0]?.start;
      return (
        start >= 8 && contains(view.coverage, { start: start - 8, end: start })
      );
    })
    .at(-1);
  const startLink = async () => {
    if (view.activeLink) {
      if (
        view.activeLink.state === "paused" &&
        !(await run({ type: "resume-session", sessionId: view.activeLink.id }))
      )
        return;
      go("link");
      return;
    }
    if (
      linkSource &&
      (await run({ type: "start-link", hifzSessionId: linkSource.id }))
    )
      go("link");
  };
  const exportSummary = async () => {
    let data;
    try {
      data = await service.exportData();
    } catch {
      setError("تعذر التحقق من السجل للتصدير. لم يُنشأ ملف ناقص.");
      return;
    }
    const blob = new Blob(
      [
        JSON.stringify(
          {
            ...data,
            exportedAt: new Date().toISOString(),
            cloudConfirmed: false,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mulazama-preview-${today}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("نُزّل ملخص التجربة المحلية. لا يحتوي على نص قرآني.");
  };
  return (
    <Busy.Provider value={busy}>
      <div className="v211-app" dir="rtl">
        <a
          className="v211-skip"
          href="#v211-main"
          onClick={(event) => {
            event.preventDefault();
            mainRef.current?.focus();
            mainRef.current?.scrollIntoView();
          }}
        >
          انتقل إلى المحتوى
        </a>
        <div
          className="v211-preview-bar"
          role="region"
          aria-label="حالة المعاينة الخاصة"
        >
          <ShieldCheck size={15} aria-hidden="true" />
          <span>
            معاينة خاصة · مقادير تجريبية غير قرآنية · الحفظ على هذا الجهاز فقط
          </span>
        </div>
        <div className="v211-shell">
          <aside className="v211-sidebar" aria-label="القائمة الرئيسية">
            <button
              className="v211-brand"
              onClick={() => go(configured ? "today" : "welcome")}
              aria-label="مُلازَمَة — الرئيسية"
            >
              <span className="v211-brand-mark">
                <BookOpen size={26} />
              </span>
              <span className="v211-brand-name">
                مُلازَمَة<small>رفيق رحلتك مع القرآن</small>
              </span>
            </button>
            <nav className="v211-nav">
              {navigation.map((item) => (
                <button
                  key={item.id}
                  onClick={() => go(item.id)}
                  aria-current={safeScreen === item.id ? "page" : undefined}
                >
                  <item.icon aria-hidden="true" />
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="v211-sidebar-note">
              <Leaf size={26} aria-hidden="true" />
              <strong>القليل المستمر يصنع الرحلة</strong>
              <p>
                خطوة للحفظ، وأخرى للمراجعة. اختاري وتيرتك وعودي من حيث توقفتِ.
              </p>
            </div>
          </aside>
          <div className="v211-workspace">
            <header className="v211-topbar">
              <div className="v211-breadcrumb">
                <BookOpen size={17} aria-hidden="true" />
                <span>مُلازَمَة</span>
                <ChevronLeft size={13} aria-hidden="true" />
                <span>{screenNames[safeScreen]}</span>
              </div>
              <div className="v211-top-actions">
                <span
                  className="v211-save-status"
                  style={error ? { color: "var(--v-error)" } : undefined}
                >
                  {busy ? (
                    <>
                      <Clock3 size={14} />
                      جارٍ الحفظ
                    </>
                  ) : error ? (
                    <>
                      <Info size={14} />
                      تعذر الحفظ
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={14} />
                      {configured ? "محفوظ محليًا" : "على هذا الجهاز"}
                    </>
                  )}
                </span>
                <span
                  className="v211-avatar"
                  role="img"
                  aria-label="التجربة المحلية"
                >
                  <UserRound size={18} />
                </span>
              </div>
            </header>
            <main id="v211-main" ref={mainRef} tabIndex={-1} aria-busy={busy}>
              {error && <Notice tone="error">{error}</Notice>}
              {message && (
                <div className="v211-alert success" role="status">
                  <CheckCircle2 size={19} aria-hidden="true" />
                  {message}
                </div>
              )}
              {safeScreen === "welcome" && <Welcome go={go} />}
              {safeScreen === "account" && (
                <div className="v211-narrow">
                  <Heading
                    title="مساحة خاصة لرحلتك"
                    subtitle="الحسابات الحقيقية ليست مفعّلة في هذه المعاينة."
                  />
                  <Card>
                    <div className="v211-card-title">
                      <div>
                        <LockKeyhole />
                        <h2>جرّبي الرحلة دون بيانات شخصية</h2>
                      </div>
                    </div>
                    <p className="v211-subtle">
                      لا تحتاج التجربة إلى بريد أو كلمة مرور. كل ما تسجلينه هنا
                      بيانات تجريبية محفوظة في هذا المتصفح، ولا تنتقل إلى جهاز
                      آخر.
                    </p>
                    <div className="v211-divider" />
                    <div className="v211-button-row">
                      <Button onClick={() => go("setup")}>
                        متابعة التجربة المحلية <ArrowLeft size={18} />
                      </Button>
                      <Button variant="ghost" onClick={() => go("welcome")}>
                        رجوع
                      </Button>
                    </div>
                  </Card>
                </div>
              )}
              {safeScreen === "setup" && (
                <Setup
                  state={state}
                  service={service}
                  today={today}
                  run={run}
                  go={go}
                />
              )}
              {safeScreen === "today" && (
                <>
                  <Heading
                    title="كل يوم، أقرب إلى وردك"
                    subtitle="رحلتك أمامك. ابدئي بخطوة هادئة، أو أكملي من حيث توقفتِ."
                    date={today}
                  />
                  <Stats state={state} service={service} />
                  <div className="v211-today-grid">
                    <div className="v211-stack">
                      <Card className="v211-task-card featured">
                        <span className="v211-task-icon">
                          <Bookmark size={21} />
                        </span>
                        <h2>الحفظ الجديد</h2>
                        <p className="v211-subtle">
                          {view.activeHifz
                            ? "جلستك محفوظة، ومستعدة للمتابعة."
                            : view.nextRange
                              ? "مقدار واحد، وخطوات صغيرة متتابعة."
                              : "أكملتِ المقادير التجريبية المتاحة."}
                        </p>
                        {view.activeHifz ? (
                          <>
                            <div className="v211-task-detail">
                              <span>
                                {view.activeHifz.state === "paused"
                                  ? "جلسة متوقفة"
                                  : "جلسة جارية"}
                              </span>
                              <strong>
                                {num(view.activeHifz.count)} /{" "}
                                {num(view.activeHifz.targetSnapshot)}
                              </strong>
                            </div>
                            <div className="v211-mini-track">
                              <span
                                style={{
                                  width: `${(view.activeHifz.count / view.activeHifz.targetSnapshot) * 100}%`,
                                }}
                              />
                            </div>
                          </>
                        ) : (
                          view.nextRange && <Ranges ranges={[view.nextRange]} />
                        )}
                        {(view.activeHifz || view.nextRange) && (
                          <Button
                            className="full"
                            onClick={() => void startHifz()}
                          >
                            <Play size={17} />
                            {view.activeHifz ? "متابعة الحفظ" : "بدء الحفظ"}
                          </Button>
                        )}
                      </Card>
                      <Card className="v211-task-card">
                        <span className="v211-task-icon">
                          <Link2 size={21} />
                        </span>
                        <h2>التثبيت</h2>
                        <p className="v211-subtle">
                          {view.activeLink
                            ? "أكملي ربط المقدار الجديد بسابقه."
                            : linkSource
                              ? "وجه جديد وسابق متصل، بعدّاد مستقل."
                              : "يبدأ عندما يكتمل مقدار له سابق محفوظ ومتصل."}
                        </p>
                        {view.activeLink && (
                          <div className="v211-task-detail">
                            <span>تكرارات مسجّلة</span>
                            <strong>
                              {num(view.activeLink.count)} /{" "}
                              {num(view.activeLink.targetSnapshot)}
                            </strong>
                          </div>
                        )}
                        {view.activeLink || linkSource ? (
                          <Button
                            className="full"
                            variant="secondary"
                            onClick={() => void startLink()}
                          >
                            <Link2 size={17} />
                            {view.activeLink ? "متابعة التثبيت" : "بدء التثبيت"}
                          </Button>
                        ) : (
                          <div className="v211-task-detail">
                            <span>غير منطبق حاليًا</span>
                            <span>لا يُحسب نقصًا</span>
                          </div>
                        )}
                      </Card>
                    </div>
                    <div className="v211-stack">
                      <ReaderGate go={go} />
                      <div className="v211-quote-note">
                        <Leaf size={21} />
                        <p>
                          التكرارات إقرار منك بما أنجزتِ، وليست تقييمًا آليًا
                          لصحة التلاوة أو إتقان الحفظ.
                        </p>
                      </div>
                    </div>
                    <div className="v211-stack">
                      <Card className="v211-task-card">
                        <div className="v211-card-title">
                          <div>
                            <CalendarDays size={21} />
                            <h2>مراجعة الأسبوع</h2>
                          </div>
                        </div>
                        <p className="v211-subtle">
                          {new Date(today + "T12:00Z").getUTCDay() === 5
                            ? "اليوم الجمعة: مراجعة جامعة لما اكتمل هذا الأسبوع."
                            : "مراجعة ما اكتمل من حفظك هذا الأسبوع."}
                        </p>
                        <ul className="v211-today-list">
                          <li>
                            <span>
                              <span className="v211-dot" />
                              نافذة الأسبوع
                            </span>
                            <span>السبت – الجمعة</span>
                          </li>
                          <li>
                            <span>مراجعات مكتملة</span>
                            <strong>{num(view.counts.week)}</strong>
                          </li>
                        </ul>
                        <Button
                          className="full"
                          variant="secondary"
                          onClick={() => go("week")}
                        >
                          فتح مراجعة الأسبوع <ArrowLeft size={17} />
                        </Button>
                      </Card>
                      <Card className="v211-task-card">
                        <div className="v211-card-title">
                          <div>
                            <HeartHandshake size={21} />
                            <h2>التعاهد</h2>
                          </div>
                          <span className="v211-chip">
                            كل {num(state.plan!.cycleDays)} أيام
                          </span>
                        </div>
                        <ul className="v211-today-list">
                          <li>
                            <span>مستحق اليوم</span>
                            <strong>{num(view.dueTasks.length)}</strong>
                          </li>
                          <li>
                            <span>متأخرات محفوظة بتاريخها</span>
                            <strong>{num(view.overdueTasks.length)}</strong>
                          </li>
                        </ul>
                        <Button
                          className="full"
                          variant="ghost"
                          onClick={() => go("taahud")}
                        >
                          عرض خطة التعاهد <ArrowLeft size={17} />
                        </Button>
                      </Card>
                    </div>
                  </div>
                </>
              )}
              {(safeScreen === "hifz" || safeScreen === "link") && (
                <SessionScreen
                  kind={safeScreen === "hifz" ? "hifz" : "link"}
                  session={
                    (safeScreen === "hifz"
                      ? view.activeHifz
                      : view.activeLink) ??
                    state.sessions
                      .filter(
                        (s) =>
                          s.kind === (safeScreen === "hifz" ? "hifz" : "link"),
                      )
                      .at(-1)
                  }
                  run={run}
                  go={go}
                  startHifz={startHifz}
                  startLink={startLink}
                  canLink={!!linkSource}
                  hasNext={!!view.nextRange}
                />
              )}
              {safeScreen === "week" && (
                <WeekScreen state={state} service={service} run={run} go={go} />
              )}
              {safeScreen === "taahud" && (
                <TaahudScreen state={state} service={service} run={run} />
              )}
              {safeScreen === "progress" && (
                <ProgressScreen
                  state={state}
                  service={service}
                  exportSummary={exportSummary}
                />
              )}
              {safeScreen === "mushaf" && <MushafScreen go={go} />}
              {safeScreen === "settings" && (
                <SettingsScreen
                  state={state}
                  go={go}
                  exportSummary={exportSummary}
                />
              )}
              {safeScreen === "privacy" && (
                <div className="v211-narrow">
                  <Heading
                    title="خصوصية التجربة"
                    subtitle="ما يُحفظ هنا يبقى في هذا المتصفح."
                  />
                  <Card>
                    <h2>معاينة محلية بمقادير اصطناعية</h2>
                    <p className="v211-subtle">
                      لا تسجّلي بيانات حساسة أو محفوظًا حقيقيًا في هذه المعاينة.
                      تستخدم الرحلة مقادير تجريبية فقط، ولا تطلب اسمًا أو بريدًا
                      أو كلمة مرور. إغلاق النافذة لا يمحو التقدم؛ مسح بيانات
                      الموقع من المتصفح يمحو هذه التجربة المحلية.
                    </p>
                    <div className="v211-divider" />
                    <h2>لا مزامنة سحابية حاليًا</h2>
                    <p className="v211-subtle">
                      عبارة «محفوظ محليًا» تعني تأكيد الحفظ في الجهاز الحالي
                      فقط. الحسابات والاستعادة من جهاز جديد لا تتاح حتى ربط خدمة
                      موثقة. تنزيل الملخص ينشئ ملفًا على جهازك.
                    </p>
                    <div className="v211-form-actions">
                      <Button
                        variant="secondary"
                        onClick={() => go(configured ? "settings" : "welcome")}
                      >
                        عودة <ArrowLeft size={17} />
                      </Button>
                    </div>
                  </Card>
                </div>
              )}
            </main>
            <footer className="v211-footer">
              <span>مُلازَمَة · رفيق رحلتك مع القرآن</span>
              <span>
                نسخة تجريبية V2.1.1 ·{" "}
                <button onClick={() => go("privacy")}>خصوصية التجربة</button>
              </span>
            </footer>
          </div>
        </div>
        {configured && (
          <nav className="v211-mobile-nav" aria-label="التنقل السريع">
            {navigation
              .filter((i) =>
                ["today", "mushaf", "progress", "settings"].includes(i.id),
              )
              .map((item) => (
                <button
                  key={item.id}
                  onClick={() => go(item.id)}
                  aria-current={safeScreen === item.id ? "page" : undefined}
                >
                  <item.icon aria-hidden="true" />
                  {item.label}
                </button>
              ))}
          </nav>
        )}
      </div>
    </Busy.Provider>
  );
}

function Welcome({ go }: { go: (screen: Screen) => void }) {
  return (
    <div className="v211-welcome">
      <span className="v211-brand-mark">
        <BookOpen size={41} />
      </span>
      <div className="v211-eyebrow">أهلًا بك في مُلازَمَة</div>
      <h1 tabIndex={-1}>رحلة تستحقّ الملازمة</h1>
      <p className="v211-welcome-tagline">رفيق رحلتك مع القرآن</p>
      <p className="v211-welcome-description">
        مساحة هادئة لتنظيم الحفظ والتثبيت والمراجعة والتعاهد. ضعي خطتك، واحتفظي
        بخطوتك، وعودي كل مرة من حيث توقفتِ.
      </p>
      <div className="v211-button-row">
        <Button onClick={() => go("account")}>
          ابدئي التجربة <ArrowLeft size={18} />
        </Button>
        <Button variant="ghost" onClick={() => go("mushaf")}>
          <BookOpen size={18} />
          عن المصحف
        </Button>
      </div>
      <p className="v211-tiny" style={{ marginTop: 16 }}>
        تجربة خاصة بمقادير غير قرآنية، دون إنشاء حساب.
      </p>
      <div className="v211-welcome-features">
        <Card>
          <Bookmark size={25} />
          <h2>حفظ بخطوات واضحة</h2>
          <p>هدف ثابت وعدّاد محفوظ، مع توقف واستئناف وقتما تحتاجين.</p>
        </Card>
        <Card>
          <CalendarDays size={25} />
          <h2>مراجعة تجمع الأسبوع</h2>
          <p>ما أنجزتِه في مكان واحد، ومراجعة الجمعة بنطاق واضح.</p>
        </Card>
        <Card>
          <HeartHandshake size={25} />
          <h2>تعاهد على وتيرتك</h2>
          <p>دورة تختارينها، ومواعيد تحفظ المنجز والجزء المتبقي.</p>
        </Card>
      </div>
    </div>
  );
}

function Stats({
  state,
  service,
}: {
  state: ProductState;
  service: ProductV211;
}) {
  const view = service.view();
  const stats = [
    {
      label: "المحفوظ المسجّل",
      value: size(view.coverage),
      unit: "من ٢٤ وحدة",
      foot: "تغطية التجربة الحالية",
      icon: BookOpen,
    },
    {
      label: "الحفظ الجديد",
      value: view.counts.hifz,
      unit: "مقدار",
      foot: "إكمالات مسجّلة",
      icon: Bookmark,
    },
    {
      label: "التثبيت",
      value: view.counts.link,
      unit: "نشاط",
      foot: "إكمالات مستقلة",
      icon: Link2,
    },
    {
      label: "مراجعة الأسبوع",
      value: view.counts.week,
      unit: "مراجعة",
      foot: "مراجعات مكتملة",
      icon: CalendarDays,
    },
    {
      label: "التعاهد",
      value: view.counts.taahud,
      unit: "إنجاز",
      foot: "إنجازات كاملة أو جزئية",
      icon: HeartHandshake,
    },
  ];
  return (
    <section
      className="v211-stats"
      aria-label="مؤشرات التجربة منذ بدايتها"
      data-revision={state.revision}
    >
      {stats.map((s) => (
        <div className="v211-stat" key={s.label}>
          <div className="v211-stat-label">
            <s.icon size={17} aria-hidden="true" />
            {s.label}
          </div>
          <div className="v211-stat-value">
            {num(s.value)}
            <small>{s.unit}</small>
          </div>
          <div className="v211-stat-foot">{s.foot}</div>
        </div>
      ))}
    </section>
  );
}

function ReaderGate({ go }: { go: (screen: Screen) => void }) {
  return (
    <Card className="v211-reader">
      <span className="v211-chip">
        <LockKeyhole size={12} />
        المصحف
      </span>
      <div className="v211-reader-symbol">
        <BookOpen size={36} />
      </div>
      <h2>للقرآن عناية تليق به</h2>
      <p>
        مصدر النص المعتمد هو Tanzil. يبقى عرضه مغلقًا حتى اكتمال مراجعة الحزمة
        واعتمادها.
      </p>
      <Button variant="ghost" onClick={() => go("mushaf")}>
        تفاصيل المصدر والاعتماد <ArrowLeft size={16} />
      </Button>
      <span className="v211-tiny">
        يمكنك تجربة بقية الرحلة بمقادير اصطناعية.
      </span>
    </Card>
  );
}

type Draft = {
  coverage: number[];
  hifzTarget: string;
  linkTarget: string;
  cycleDays: string;
  anchorDate: string;
  zoneId: string;
  startOrdinal: string;
};
function Setup({
  state,
  service,
  today,
  run,
  go,
}: {
  state: ProductState;
  service: ProductV211;
  today: string;
  run: Run;
  go: (s: Screen) => void;
}) {
  const editing = !!state.plan,
    storageKey = "mulazama-v211-synthetic-setup-draft";
  const defaults: Draft = {
    coverage: SYNTHETIC_CATALOG.flatMap((c, i) =>
      contains(state.declaredRanges, c.range) ? [i] : [],
    ),
    hifzTarget: String(state.plan?.hifzTarget ?? 20),
    linkTarget: String(state.plan?.linkTarget ?? 5),
    cycleDays: state.plan ? String(state.plan.cycleDays) : "",
    anchorDate: state.plan?.anchorDate ?? today,
    zoneId: state.plan?.zoneId ?? "Asia/Riyadh",
    startOrdinal: String(state.plan?.startOrdinal ?? 0),
  };
  const [draft, setDraft] = useState<Draft>(() => {
    if (editing) return defaults;
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (
        parsed &&
        Array.isArray(parsed.coverage) &&
        Object.keys(defaults).every(
          (k) => k === "coverage" || typeof parsed[k] === "string",
        )
      )
        return parsed;
    } catch {
      /* A damaged draft is not confirmed progress. */
    }
    return defaults;
  });
  const [step, setStep] = useState(0),
    [validation, setValidation] = useState("");
  const [preview, setPreview] = useState<Awaited<
    ReturnType<ProductV211["previewPlan"]>
  > | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  useEffect(() => {
    if (!editing)
      try {
        localStorage.setItem(storageKey, JSON.stringify(draft));
      } catch {
        /* Draft retention is optional; confirmed storage errors are handled by the service. */
      }
  }, [draft, editing]);
  const set = (key: keyof Draft, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const selectedRanges = draft.coverage
    .map((i) => SYNTHETIC_CATALOG[i]?.range)
    .filter((r): r is Interval => !!r);
  const planCommand = (): Extract<
    ProductCommand,
    { type: "configure-plan" }
  > => ({
    type: "configure-plan",
    hifzTarget: Number(draft.hifzTarget),
    linkTarget: Number(draft.linkTarget),
    cycleDays: Number(draft.cycleDays),
    anchorDate: draft.anchorDate,
    zoneId: draft.zoneId,
    declaredRanges: selectedRanges,
    startOrdinal: Number(draft.startOrdinal),
    rebalance:
      editing &&
      (state.plan!.cycleDays !== Number(draft.cycleDays) ||
        state.plan!.anchorDate !== draft.anchorDate ||
        size(selectedRanges) !== size(state.declaredRanges) ||
        selectedRanges.some((r) => !contains(state.declaredRanges, r))),
  });
  const next = async () => {
    setValidation("");
    if (step === 0) {
      const start = selectedRanges.length
        ? Math.max(...selectedRanges.map((r) => r.end))
        : 0;
      if (!editing)
        setDraft((d) => ({ ...d, startOrdinal: String(Math.min(start, 16)) }));
      setStep(1);
    } else {
      if (
        !/^\d+$/.test(draft.cycleDays) ||
        Number(draft.cycleDays) < 1 ||
        Number(draft.cycleDays) > 366 ||
        !/^\d+$/.test(draft.hifzTarget) ||
        Number(draft.hifzTarget) < 1 ||
        Number(draft.hifzTarget) > 10000 ||
        !/^\d+$/.test(draft.linkTarget) ||
        Number(draft.linkTarget) < 1 ||
        Number(draft.linkTarget) > 10000 ||
        !draft.anchorDate
      ) {
        setValidation(
          "أدخلي أهدافًا صحيحة من ١ إلى ١٠٠٠٠، ومدة دورة من ١ إلى ٣٦٦ يومًا، وتاريخ بداية واضحًا.",
        );
        return;
      }
      setPreviewBusy(true);
      try {
        setPreview(await service.previewPlan(planCommand()));
        setStep(2);
      } catch (cause) {
        setValidation(describeError(cause));
      } finally {
        setPreviewBusy(false);
      }
    }
  };
  const confirm = async () => {
    const saved = await run(
      planCommand(),
      "حُفظت خطتك. التغييرات تخص الجلسات الجديدة فقط.",
      { expectedRevision: preview?.revision },
    );
    if (saved) {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* no secret or committed data in this key */
      }
      go("today");
    } else {
      setPreview(null);
      setStep(1);
    }
  };
  return (
    <div className="v211-narrow">
      <Heading
        title={editing ? "خطتك، على وتيرتك" : "لنهيّئ رحلتك"}
        subtitle="اختيارات قليلة الآن، وخطوة واضحة كل يوم."
      />
      <div className="v211-steps">
        {["المحفوظ", "الخطة", "المراجعة"].map((title, i) => (
          <div key={title} style={{ display: "contents" }}>
            <span
              className={`v211-step ${step === i ? "active" : ""}`}
              aria-current={step === i ? "step" : undefined}
            >
              <span>{num(i + 1)}</span>
              {title}
            </span>
            {i < 2 && <span className="v211-step-line" />}
          </div>
        ))}
      </div>
      {validation && <Notice tone="error">{validation}</Notice>}
      <Card>
        {step === 0 && (
          <>
            <h2>ما المقادير التجريبية المحفوظة؟</h2>
            <p className="v211-subtle">
              اختاري ما تريدين إدخاله في التجربة. اتركيها فارغة للبدء دون محفوظ.
              لا تُحسب الفجوات ضمن المحفوظ.
            </p>
            <div className="v211-checkbox-grid">
              {SYNTHETIC_CATALOG.map((face, i) => (
                <label className="v211-checkbox" key={face.id}>
                  <input
                    type="checkbox"
                    checked={draft.coverage.includes(i)}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        coverage: e.target.checked
                          ? [...d.coverage, i]
                          : d.coverage.filter((v) => v !== i),
                      }))
                    }
                  />
                  <span>
                    {face.title}
                    <small>
                      {rangeLabel(face.range)} · مقدار اصطناعي غير قرآني
                    </small>
                  </span>
                </label>
              ))}
            </div>
            <p className="v211-tiny" style={{ marginTop: 14 }}>
              {selectedRanges.length
                ? `المحدد: ${num(size(selectedRanges))} وحدة تجريبية.`
                : "لا محفوظ سابق — بداية جديدة مسموحة."}
            </p>
          </>
        )}
        {step === 1 && (
          <>
            <h2>حدّدي وتيرة التجربة</h2>
            <p className="v211-subtle">
              الأهداف إقرارات تكرار، وليست وعدًا بالإتقان. تثبت عند بدء كل جلسة.
            </p>
            <div className="v211-form-grid">
              <label className="v211-field">
                <span>بداية الحفظ</span>
                <select
                  value={draft.startOrdinal}
                  onChange={(e) => set("startOrdinal", e.target.value)}
                >
                  {SYNTHETIC_CATALOG.map((c) => (
                    <option key={c.id} value={c.range.start}>
                      {c.title}
                    </option>
                  ))}
                </select>
                <small>اقتراح قابل للتغيير؛ المقادير المحفوظة تُتجاوز.</small>
              </label>
              <label className="v211-field">
                <span>هدف تكرارات الحفظ</span>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  inputMode="numeric"
                  value={draft.hifzTarget}
                  onChange={(e) => set("hifzTarget", e.target.value)}
                />
                <small>الافتراضي ٢٠، ويمكن تغييره للجلسات القادمة.</small>
              </label>
              <label className="v211-field">
                <span>هدف تكرارات التثبيت</span>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  inputMode="numeric"
                  value={draft.linkTarget}
                  onChange={(e) => set("linkTarget", e.target.value)}
                />
                <small>عدّاد مستقل لربط مقدارين متصلين.</small>
              </label>
              <label className="v211-field">
                <span>مدة دورة التعاهد بالأيام</span>
                <input
                  type="number"
                  min="1"
                  max="366"
                  inputMode="numeric"
                  value={draft.cycleDays}
                  onChange={(e) => set("cycleDays", e.target.value)}
                  required
                />
                <small>اختاري المدة صراحةً، من ١ إلى ٣٦٦ يومًا.</small>
              </label>
              <label className="v211-field">
                <span>بداية دورة التعاهد</span>
                <input
                  type="date"
                  value={draft.anchorDate}
                  onChange={(e) => set("anchorDate", e.target.value)}
                  required
                />
              </label>
              <label className="v211-field">
                <span>المنطقة الزمنية</span>
                <select
                  value={draft.zoneId}
                  onChange={(e) => set("zoneId", e.target.value)}
                >
                  <option value="Asia/Riyadh">الرياض</option>
                  <option value="Asia/Dubai">دبي</option>
                  <option value="Africa/Cairo">القاهرة</option>
                  <option value="Europe/London">لندن</option>
                  <option value="America/New_York">نيويورك</option>
                </select>
                <small>تحدد يوم النشاط ونافذة مراجعة الأسبوع.</small>
              </label>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h2>راجعي خطتك ثم ابدئي</h2>
            <p className="v211-subtle">
              ستُحفظ هذه الاختيارات معًا عند التأكيد.
            </p>
            <dl className="v211-summary-list">
              <div>
                <dt>المحفوظ المسجّل</dt>
                <dd>{num(size(selectedRanges))} وحدة تجريبية</dd>
              </div>
              <div>
                <dt>بداية الحفظ</dt>
                <dd>
                  {
                    SYNTHETIC_CATALOG.find(
                      (c) => c.range.start === Number(draft.startOrdinal),
                    )?.title
                  }
                </dd>
              </div>
              <div>
                <dt>هدف الحفظ / التثبيت</dt>
                <dd>
                  {num(Number(draft.hifzTarget))} /{" "}
                  {num(Number(draft.linkTarget))} تكرارًا
                </dd>
              </div>
              <div>
                <dt>دورة التعاهد</dt>
                <dd>{num(Number(draft.cycleDays))} أيام</dd>
              </div>
              <div>
                <dt>بداية الدورة</dt>
                <dd>{dateLabel(draft.anchorDate)}</dd>
              </div>
            </dl>
            <Notice>
              تغيير الخطة يسري على الجلسات التي لم تبدأ. تبقى أهداف الجلسات
              الجارية وأعدادها محفوظة.
            </Notice>
            {preview && (
              <div>
                <h3>أثر الخطة على التعاهد</h3>
                <p className="v211-tiny">
                  المواعيد اليدوية المحفوظة: {num(preview.preservedManual)}. لا
                  يُحذف سجل الإنجازات السابق.
                </p>
                {preview.changes.length ? (
                  <ul className="v211-timeline">
                    {preview.changes.map((change, i) => (
                      <li key={`${change.taskId}-${i}`}>
                        <span className="v211-timeline-icon">
                          <CalendarDays size={17} />
                        </span>
                        <div>
                          <div className="v211-timeline-title">
                            {change.ranges.map(rangeLabel).join("، ")}
                          </div>
                          <div className="v211-timeline-meta">
                            {change.oldDate
                              ? `من ${dateLabel(change.oldDate)} إلى `
                              : "الموعد: "}
                            {change.newDate
                              ? dateLabel(change.newDate)
                              : "إيقاف الجدولة لهذا النطاق"}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="v211-subtle">لا تغيير في المواعيد الحالية.</p>
                )}
              </div>
            )}
          </>
        )}
        <div className="v211-form-actions">
          <Button
            variant="ghost"
            onClick={() =>
              step ? setStep(step - 1) : go(editing ? "settings" : "account")
            }
          >
            <ArrowRight size={17} />
            رجوع
          </Button>
          {step < 2 ? (
            <Button onClick={() => void next()} disabled={previewBusy}>
              {previewBusy
                ? "جارٍ إعداد الملخص"
                : step === 0
                  ? "التالي: الخطة"
                  : "مراجعة الخطة"}
              <ArrowLeft size={17} />
            </Button>
          ) : (
            <Button onClick={() => void confirm()} disabled={!preview}>
              <Check size={18} />
              تأكيد الخطة
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

function SessionScreen({
  kind,
  session,
  run,
  go,
  startHifz,
  startLink,
  canLink,
  hasNext,
}: {
  kind: "hifz" | "link";
  session?: Session | null;
  run: Run;
  go: (s: Screen) => void;
  startHifz: () => Promise<void>;
  startLink: () => Promise<void>;
  canLink: boolean;
  hasNext: boolean;
}) {
  const [showMaterial, setShowMaterial] = useState(false),
    link = kind === "link";
  if (!session)
    return (
      <>
        <Heading title={link ? "تثبيت المحفوظ" : "الحفظ الجديد"} />
        <Card>
          <Empty
            title={link ? "لا تثبيت مطلوب الآن" : "ابدئي جلسة من اليوم"}
            action={
              <Button onClick={() => go("today")}>العودة إلى اليوم</Button>
            }
          >
            {link
              ? "يلزم مقدار محفوظ وسابق متصل دون فجوة. عدم انطباق التثبيت ليس إخفاقًا."
              : "اختاري المقدار القادم لبدء عدّاد مستقل محفوظ."}
          </Empty>
        </Card>
      </>
    );
  const completed = session.state === "completed",
    paused = session.state === "paused";
  return (
    <>
      <Heading
        title={link ? "ثبّتي الصلة بين المقدارين" : "خطوة بعد خطوة، يثبت وردك"}
        eyebrow={link ? "التثبيت · عدّاد مستقل" : "الحفظ الجديد"}
        subtitle={
          link
            ? "هذا النشاط لا يغيّر عدّاد الحفظ الجديد."
            : "نطاق هذه الجلسة وهدفها محفوظان حتى إتمامها."
        }
      />
      <div className="v211-session-layout">
        <Card className="v211-counter-card">
          <span className={`v211-chip ${completed ? "success" : ""}`}>
            {completed
              ? "اكتمل الإقرار"
              : paused
                ? "الجلسة متوقفة"
                : "جلسة جارية"}
          </span>
          <h2 style={{ marginTop: 14 }}>
            {link ? "ربط السابق بالجديد" : "مقدار تجريبي للحفظ"}
          </h2>
          <Ranges ranges={session.rangeSnapshot} />
          <div
            className="v211-counter-ring"
            style={
              {
                "--v-progress": Math.min(
                  100,
                  (session.count / session.targetSnapshot) * 100,
                ),
              } as CSSProperties
            }
          >
            <div className="v211-counter-center">
              <output
                className="v211-counter-number"
                aria-label="عدد التكرارات المحفوظ"
              >
                {num(session.count)}
              </output>
              <span className="v211-counter-target">
                من {num(session.targetSnapshot)} تكرارًا
              </span>
            </div>
          </div>
          {completed ? (
            <div className="v211-stack">
              <Notice tone="success">
                حُفظ إقرار إكمال {link ? "التثبيت" : "الحفظ"} لهذا المقدار.
              </Notice>
              {!link && canLink ? (
                <Button className="full" onClick={() => void startLink()}>
                  الانتقال إلى التثبيت <Link2 size={18} />
                </Button>
              ) : !link && hasNext ? (
                <Button className="full" onClick={() => void startHifz()}>
                  بدء المقدار التالي <ArrowLeft size={18} />
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => go("today")}>
                  العودة إلى اليوم
                </Button>
              )}
            </div>
          ) : paused ? (
            <Button
              className="v211-counter-add"
              onClick={() =>
                void run(
                  { type: "resume-session", sessionId: session.id },
                  "استؤنفت الجلسة من آخر عدد محفوظ.",
                )
              }
            >
              <Play size={23} />
              استئناف الجلسة
            </Button>
          ) : (
            <Button
              className="v211-counter-add"
              onClick={() =>
                void run(
                  { type: "add-repetition", sessionId: session.id },
                  "حُفظ التكرار محليًا.",
                )
              }
            >
              <Plus size={25} />
              إضافة تكرار غيبي
            </Button>
          )}
          <div className="v211-counter-tools">
            {session.count > 0 && (
              <Button
                variant="ghost"
                onClick={() =>
                  void run(
                    { type: "undo-repetition", sessionId: session.id },
                    "عُكس آخر تكرار، مع إبقاء الحدث الأصلي في السجل.",
                  )
                }
              >
                <RotateCcw size={17} />
                تراجع عن آخر تكرار
              </Button>
            )}
            {!completed && !paused && (
              <Button
                variant="ghost"
                onClick={async () => {
                  if (
                    await run(
                      { type: "pause-session", sessionId: session.id },
                      "توقفت الجلسة وحُفظ العدد.",
                    )
                  )
                    go("today");
                }}
              >
                <Pause size={17} />
                توقف واحفظ
              </Button>
            )}
          </div>
          <p className="v211-tiny" style={{ marginTop: 13 }}>
            كل ضغطة مقصودة تسجّل تكرارًا واحدًا بعد الحفظ.
          </p>
        </Card>
        <div className="v211-stack">
          <Card>
            <div className="v211-card-title">
              <div>
                <BookOpen size={21} />
                <h2>مقدار الجلسة</h2>
              </div>
            </div>
            <p className="v211-subtle">
              المقادير هنا اصطناعية لتجربة الرحلة؛ لا تعرض آيات قرآنية.
            </p>
            {link && session.previousRange && (
              <>
                <p className="v211-tiny" style={{ marginTop: 14 }}>
                  المقدار السابق المتصل
                </p>
                <Ranges ranges={[session.previousRange]} />
              </>
            )}
            {link && session.newRange && (
              <>
                <p className="v211-tiny">المقدار الجديد</p>
                <Ranges ranges={[session.newRange]} />
              </>
            )}
            <Button
              variant="secondary"
              className="full"
              style={{ marginTop: 17 }}
              onClick={() => setShowMaterial((v) => !v)}
              aria-expanded={showMaterial}
            >
              <BookOpen size={17} />
              {showMaterial ? "إخفاء مقدار التجربة" : "إظهار مقدار التجربة"}
            </Button>
            {showMaterial && (
              <div className="v211-session-material">
                <strong>مقدار اصطناعي — ليس قرآنًا</strong>
                <Ranges ranges={session.rangeSnapshot} />
                <p>إظهار المقدار وإخفاؤه لا يضيف تكرارًا ولا يغيّر الهدف.</p>
              </div>
            )}
          </Card>
          <div className="v211-quote-note">
            <ShieldCheck size={21} />
            <p>
              التكرار إقرار شخصي. صحة التلاوة تحتاج تلقيًا ومراجعة لدى المختصين.
            </p>
          </div>
          <Button variant="ghost" onClick={() => go("today")}>
            العودة إلى اليوم <ArrowLeft size={17} />
          </Button>
        </div>
      </div>
    </>
  );
}

function WeekScreen({
  state,
  service,
  run,
  go,
}: {
  state: ProductState;
  service: ProductV211;
  run: Run;
  go: (s: Screen) => void;
}) {
  const today = service.today(),
    friday = new Date(today + "T12:00Z").getUTCDay() === 5,
    view = service.view();
  const current = state.reviews.find((r) => r.localDate === today),
    history = state.reviews.filter((r) => r.id !== current?.id);
  return (
    <>
      <Heading
        title={friday ? "مراجعة الجمعة الجامعة" : "مراجعة الأسبوع"}
        subtitle="من السبت إلى الجمعة، اجمعي ما اكتمل من حفظك في مراجعة واضحة."
        date={today}
      />
      <div className="v211-two-col">
        <Card>
          <div className="v211-card-title">
            <div>
              <CalendarDays size={22} />
              <h2>{friday ? "مراجعة الجمعة" : "مراجعة اليوم"}</h2>
            </div>
            {current && (
              <span
                className={`v211-chip ${current.disputed ? "warning" : current.status === "completed" ? "success" : ""}`}
              >
                {current.disputed
                  ? "تأثر النطاق بتصحيح"
                  : current.status === "completed"
                    ? "مكتملة"
                    : "نطاق محفوظ"}
              </span>
            )}
          </div>
          {current ? (
            <>
              <p className="v211-subtle">
                ثُبّت هذا النطاق عند بدء المراجعة، ولن يتسع بعد إنجاز جديد.
              </p>
              <Ranges ranges={current.rangesSnapshot} />
              <p className="v211-tiny">
                {num(size(current.rangesSnapshot))} وحدة تجريبية ·{" "}
                {num(current.sourceCompletionIds.length)} إكمالات مصدرية
              </p>
              {current.disputed ? (
                <Notice>
                  تأثر مصدر هذه المراجعة بتصحيح للحفظ. حُفظ الإقرار الأصلي، ولا
                  يُحتسب الآن إنجازًا فعّالًا لهذا النطاق.
                </Notice>
              ) : current.status !== "completed" ? (
                <Button
                  className="full"
                  style={{ marginTop: 20 }}
                  onClick={() =>
                    void run(
                      { type: "complete-week-review", reviewId: current.id },
                      "حُفظ إقرار المراجعة للنطاق المحدد.",
                    )
                  }
                >
                  <Check size={18} />
                  تسجيل إكمال المراجعة
                </Button>
              ) : (
                <Notice tone="success">
                  أُكملت مراجعة هذا النطاق. إنجازات الحفظ اللاحقة لا تغيّر
                  إقرارك السابق.
                </Notice>
              )}
            </>
          ) : view.weeklyRanges.length === 0 ? (
            <Empty title="لا مراجعة مطلوبة الآن">
              لم يكتمل حفظ جديد في نافذة هذا الأسبوع بعد. سيظهر نطاقه هنا عند
              اكتماله.
            </Empty>
          ) : (
            <>
              <p className="v211-subtle">
                يشمل النطاق ما اكتمل هذا الأسبوع حتى لحظة البدء. لا تُنشأ ديون
                مراجعة عن الأيام التي فاتتك.
              </p>
              <Button
                className="full"
                style={{ marginTop: 22 }}
                onClick={() =>
                  void run(
                    { type: "start-week-review" },
                    "حُفظ نطاق المراجعة عند البدء.",
                  )
                }
              >
                <Play size={17} />
                {friday ? "بدء مراجعة الجمعة" : "بدء مراجعة اليوم"}
              </Button>
              <p className="v211-tiny" style={{ marginTop: 12 }}>
                عند عدم وجود محفوظ مكتمل لهذا الأسبوع، لا تكون هناك مراجعة
                مطلوبة.
              </p>
            </>
          )}
          {view.weeklyLateRanges.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <Notice>
                اكتمل حفظ إضافي بعد تثبيت النطاق. يظهر منفصلًا ولا يُضاف إلى
                المراجعة السابقة.
              </Notice>
              <Ranges ranges={view.weeklyLateRanges} />
            </div>
          )}
        </Card>
        <div className="v211-stack">
          <Card>
            <h2>أسبوع واضح، دون تراكم</h2>
            <ul className="v211-gate-list">
              <li>
                <CheckCircle2 size={18} />
                <span>
                  يوم الجمعة مراجعة جامعة واحدة، تشمل إنجاز الجمعة السابق
                  لبدئها.
                </span>
              </li>
              <li>
                <CheckCircle2 size={18} />
                <span>
                  النطاق ثابت أثناء المراجعة، مع حفظ إقرار الإكمال محليًا.
                </span>
              </li>
              <li>
                <CheckCircle2 size={18} />
                <span>
                  ينتقل المحفوظ المؤهل إلى التعاهد من السبت، حتى لو لم تكتمل
                  مراجعة الجمعة.
                </span>
              </li>
            </ul>
            <Button variant="ghost" onClick={() => go("taahud")}>
              الانتقال إلى التعاهد <ArrowLeft size={17} />
            </Button>
          </Card>
          {history.length > 0 && (
            <Card>
              <h2>مراجعاتك السابقة</h2>
              <ul className="v211-timeline">
                {history
                  .slice()
                  .reverse()
                  .map((r) => (
                    <li key={r.id}>
                      <span className="v211-timeline-icon">
                        <CalendarDays size={18} />
                      </span>
                      <div>
                        <div className="v211-timeline-title">
                          {r.kind === "friday"
                            ? "مراجعة الجمعة"
                            : "مراجعة يومية"}{" "}
                          ·{" "}
                          {r.disputed
                            ? "تأثر النطاق بتصحيح"
                            : r.status === "completed"
                              ? "مكتملة"
                              : "لم تكتمل"}
                        </div>
                        <div className="v211-timeline-meta">
                          {dateLabel(r.localDate)} ·{" "}
                          {num(size(r.rangesSnapshot))} وحدة
                        </div>
                      </div>
                    </li>
                  ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function TaahudScreen({
  state,
  service,
  run,
}: {
  state: ProductState;
  service: ProductV211;
  run: Run;
}) {
  const view = service.view(),
    today = service.today(),
    future = state.tasks.filter(
      (t) => t.status === "pending" && t.dueDate > today,
    );
  return (
    <>
      <Heading
        title="تعاهدٌ يحفظ الصلة"
        subtitle="سجّلي ما أنجزتِه، واختاري موعد عودتك إليه. يبقى غير المنجز على موعده."
        date={today}
      />
      <Card>
        <div className="v211-card-title">
          <div>
            <HeartHandshake size={23} />
            <h2>دورتك: كل {num(state.plan!.cycleDays)} أيام</h2>
          </div>
          <span className="v211-chip">
            {num(size(view.eligibleCoverage))} وحدة مؤهلة
          </span>
        </div>
        <p className="v211-subtle">
          مدة تنظيمية تختارينها، ولا تعني تساوي صعوبة المقادير. المواعيد اليدوية
          محفوظة.
        </p>
        <Button
          variant="ghost"
          style={{ marginTop: 10 }}
          onClick={() =>
            void run(
              { type: "refresh-taahud" },
              "حُدّثت أهلية التعاهد والمواعيد؛ بقي التاريخ محفوظًا.",
            )
          }
        >
          <RotateCcw size={17} />
          تحديث مهام التعاهد
        </Button>
      </Card>
      {view.pendingProposals.length > 0 && (
        <>
          <h2 className="v211-section-title">
            <CalendarDays size={20} />
            اختاري الموعد القادم
          </h2>
          <div className="v211-two-col">
            {view.pendingProposals.map((p) => (
              <ProposalCard key={p.id} proposal={p} run={run} />
            ))}
          </div>
        </>
      )}
      <h2 className="v211-section-title">
        <Clock3 size={20} />
        مستحق اليوم{" "}
        <span className="v211-chip">{num(view.dueTasks.length)}</span>
      </h2>
      {view.dueTasks.length ? (
        <div className="v211-two-col">
          {view.dueTasks.map((t) => (
            <TaskCard key={t.id} task={t} run={run} today={today} />
          ))}
        </div>
      ) : (
        <Card>
          <Empty title="لا مهام مستحقة اليوم">
            قد تكون هناك أيام خالية داخل الدورة. ستظهر المقادير الجديدة عند
            أهليتها.
          </Empty>
        </Card>
      )}
      {view.overdueTasks.length > 0 && (
        <>
          <h2 className="v211-section-title">
            <Clock3 size={20} />
            المتأخرات <span className="v211-chip warning">بتاريخها الأصلي</span>
          </h2>
          <div className="v211-two-col">
            {view.overdueTasks.map((t) => (
              <TaskCard key={t.id} task={t} run={run} today={today} />
            ))}
          </div>
        </>
      )}
      {future.length > 0 && (
        <>
          <h2 className="v211-section-title">
            <CalendarDays size={20} />
            المواعيد القادمة
          </h2>
          <div className="v211-two-col">
            {future.map((t) => (
              <TaskCard key={t.id} task={t} run={run} today={today} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
function TaskCard({
  task,
  run,
  today,
}: {
  task: Task;
  run: Run;
  today: string;
}) {
  const total = size(task.remainingRanges),
    [amount, setAmount] = useState(String(total)),
    [due, setDue] = useState(task.dueDate),
    [validation, setValidation] = useState(""),
    [specific, setSpecific] = useState(false),
    [selectedUnits, setSelectedUnits] = useState<number[]>([]);
  const selectionId = useId(),
    validationId = useId(),
    busy = useContext(Busy);
  const remainingKey = JSON.stringify(task.remainingRanges);
  const ordinals = task.remainingRanges.flatMap((range) =>
    Array.from(
      { length: range.end - range.start },
      (_, index) => range.start + index,
    ),
  );
  useEffect(() => {
    setAmount(String(total));
    setSelectedUnits((selected) =>
      selected.filter((ordinal) =>
        task.remainingRanges.some(
          (range) => ordinal >= range.start && ordinal < range.end,
        ),
      ),
    );
  }, [remainingKey, total]);
  const submit = async () => {
    if (
      specific &&
      (!selectedUnits.length ||
        selectedUnits.some((ordinal) => !ordinals.includes(ordinal)))
    ) {
      setValidation(
        "اختاري وحدة واحدة على الأقل من الوحدات المتبقية. لم يُسجّل أي إنجاز.",
      );
      return;
    }
    if (
      !specific &&
      (!/^\d+$/.test(amount) || Number(amount) < 1 || Number(amount) > total)
    ) {
      setValidation(`اختاري عددًا من ١ إلى ${num(total)} من النطاق المتبقي.`);
      return;
    }
    setValidation("");
    await run(
      {
        type: "complete-taahud",
        taskId: task.id,
        completedRanges: specific
          ? unionRanges(
              selectedUnits.map((ordinal) => ({
                start: ordinal,
                end: ordinal + 1,
              })),
            )
          : prefixRanges(task.remainingRanges, Number(amount)),
      },
      "حُفظ المنجز. بقي الجزء غير المنجز على موعده، وظهر اقتراح للمنجز فقط.",
    );
  };
  return (
    <Card
      className={`v211-taahud-task ${task.dueDate < today ? "overdue" : ""}`}
    >
      <div className="v211-card-title">
        <h3>تعاهد {num(total)} وحدات</h3>
        <span className="v211-chip">
          {task.scheduleSource === "manual"
            ? "موعد يدوي"
            : task.dueDate < today
              ? "متأخر"
              : task.dueDate === today
                ? "اليوم"
                : "قادم"}
        </span>
      </div>
      <Ranges ranges={task.remainingRanges} />
      <div className="v211-task-meta">
        <span>الموعد: {dateLabel(task.dueDate)}</span>
        {task.originalDueDate !== task.dueDate && (
          <span>الأصلي: {dateLabel(task.originalDueDate)}</span>
        )}
      </div>
      {validation && (
        <div id={validationId}>
          <Notice tone="error">{validation}</Notice>
        </div>
      )}
      <Button
        variant="ghost"
        className="small"
        style={{ marginTop: 12 }}
        aria-expanded={specific}
        aria-controls={selectionId}
        onClick={() => {
          setSpecific((value) => !value);
          setValidation("");
        }}
      >
        {specific ? "العودة إلى عدد من البداية" : "اختيار وحدات محددة"}
      </Button>
      {specific && (
        <fieldset
          id={selectionId}
          className="v211-unit-selection"
          disabled={busy}
          aria-describedby={validation ? validationId : undefined}
        >
          <legend>الوحدات المنجزة من هذه المهمة</legend>
          <p className="v211-tiny">
            اختاري ما أنجزتِه فقط، ولو كان متفرقًا. تبقى الفجوات غير المحددة
            مستحقة.
          </p>
          <div className="v211-unit-grid">
            {ordinals.map((ordinal) => (
              <label className="v211-unit-choice" key={ordinal}>
                <input
                  type="checkbox"
                  aria-label={`الوحدة التجريبية ${ordinal + 1}`}
                  checked={selectedUnits.includes(ordinal)}
                  onChange={(event) =>
                    setSelectedUnits((selected) =>
                      event.target.checked
                        ? [...selected, ordinal]
                        : selected.filter((value) => value !== ordinal),
                    )
                  }
                />
                <span>وحدة {num(ordinal + 1)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="v211-task-form">
        {!specific ? (
          <label className="v211-field">
            <span>عدد الوحدات المنجزة</span>
            <input
              type="number"
              min="1"
              max={total}
              value={amount}
              disabled={busy}
              aria-invalid={validation ? true : undefined}
              aria-describedby={validation ? validationId : undefined}
              onChange={(e) => setAmount(e.target.value)}
            />
            <small>من بداية النطاق المتبقي بالترتيب.</small>
          </label>
        ) : (
          <p className="v211-subtle">
            المحدد: {num(selectedUnits.length)} من {num(total)} وحدات متبقية.
          </p>
        )}
        <Button onClick={() => void submit()}>
          <Check size={17} />
          تسجيل المنجز
        </Button>
      </div>
      <details className="v211-help-details">
        <summary>تغيير موعد هذه المهمة</summary>
        <p>
          سيبقى الموعد الأصلي في السجل، ويصبح الموعد الجديد اختيارًا يدويًا.
        </p>
        <div className="v211-task-form">
          <label className="v211-field">
            <span>الموعد الجديد</span>
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          <Button
            variant="secondary"
            onClick={() =>
              void run(
                { type: "reschedule-taahud", taskId: task.id, dueDate: due },
                "حُفظ الموعد اليدوي مع الاحتفاظ بتاريخ الاستحقاق الأصلي.",
              )
            }
          >
            تأكيد تغيير الموعد
          </Button>
        </div>
      </details>
    </Card>
  );
}
function ProposalCard({ proposal, run }: { proposal: Proposal; run: Run }) {
  const [due, setDue] = useState(proposal.dueDate);
  return (
    <Card className="v211-proposal">
      <div className="v211-card-title">
        <div>
          <CheckCircle2 size={20} />
          <h3>المنجز محفوظ</h3>
        </div>
        <span className="v211-chip">موعد ينتظر اختيارك</span>
      </div>
      <Ranges ranges={proposal.ranges} />
      <p className="v211-subtle">
        الاقتراح محسوب من يوم الإنجاز. يمكنك قبوله أو اختيار تاريخ آخر دون فقد
        الإنجاز.
      </p>
      <div className="v211-task-form">
        <label className="v211-field">
          <span>موعد التعاهد القادم</span>
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </label>
        <Button
          onClick={() =>
            void run(
              {
                type: "accept-proposal",
                proposalId: proposal.id,
                dueDate: due,
              },
              "حُفظ موعد التعاهد القادم للجزء المنجز فقط.",
            )
          }
        >
          <Check size={17} />
          تأكيد الموعد
        </Button>
      </div>
    </Card>
  );
}

function ProgressScreen({
  state,
  service,
  exportSummary,
}: {
  state: ProductState;
  service: ProductV211;
  exportSummary: () => void;
}) {
  const view = service.view();
  return (
    <>
      <Heading
        title="أثر خطواتك، كما سجّلتِه"
        subtitle="مؤشرات مستقلة منذ بداية التجربة. لا تمثّل شهادة إتقان أو تقييمًا للتلاوة."
      />
      <Stats state={state} service={service} />
      <div className="v211-two-col">
        <Card>
          <div className="v211-card-title">
            <div>
              <BookOpen size={21} />
              <h2>تغطية المحفوظ</h2>
            </div>
          </div>
          <div className="v211-progress-count">
            {num(size(view.coverage))}
            <small>من ٢٤ وحدة تجريبية متاحة</small>
          </div>
          <div
            className="v211-mini-track"
            role="progressbar"
            aria-label="تغطية المقادير التجريبية"
            aria-valuenow={size(view.coverage)}
            aria-valuemin={0}
            aria-valuemax={24}
          >
            <span style={{ width: `${(size(view.coverage) / 24) * 100}%` }} />
          </div>
          <Ranges ranges={view.coverage} />
          <p className="v211-tiny">
            اتحاد المقادير المعلنة والحفظ المكتمل، دون احتساب الفجوات أو التداخل
            مرتين.
          </p>
        </Card>
        <Card>
          <div className="v211-card-title">
            <div>
              <Download size={21} />
              <h2>ملخص التجربة</h2>
            </div>
          </div>
          <p className="v211-subtle">
            احتفظي بملف يضم الخطة والجلسات والمراجعات والمواعيد الحالية. هذا
            ملخص محلي، ولا يثبت مزامنة سحابية.
          </p>
          <Button
            variant="secondary"
            style={{ marginTop: 20 }}
            onClick={exportSummary}
          >
            <Download size={17} />
            تنزيل ملخص التجربة
          </Button>
        </Card>
      </div>
      <h2 className="v211-section-title">
        <Clock3 size={21} />
        سجل الجلسات
      </h2>
      <Card>
        {state.sessions.length ? (
          <ul className="v211-timeline">
            {state.sessions
              .slice()
              .reverse()
              .map((s) => (
                <li key={s.id}>
                  <span className="v211-timeline-icon">
                    {s.kind === "hifz" ? (
                      <Bookmark size={19} />
                    ) : (
                      <Link2 size={19} />
                    )}
                  </span>
                  <div>
                    <div className="v211-timeline-title">
                      {s.kind === "hifz" ? "حفظ جديد" : "تثبيت"} ·{" "}
                      {s.state === "completed"
                        ? "مكتمل"
                        : s.state === "paused"
                          ? "متوقف"
                          : s.state === "disputed"
                            ? "يحتاج استكمالًا"
                            : "جارٍ"}
                    </div>
                    <div className="v211-timeline-meta">
                      {num(s.count)} / {num(s.targetSnapshot)} تكرارًا ·{" "}
                      {s.rangeSnapshot.map(rangeLabel).join("، ")}
                    </div>
                  </div>
                </li>
              ))}
          </ul>
        ) : (
          <Empty title="تبدأ الحكاية بأول خطوة">
            لم تسجّلي جلسات بعد. سيظهر نشاطك هنا بعد بدء الرحلة.
          </Empty>
        )}
      </Card>
    </>
  );
}
function MushafScreen({ go }: { go: (s: Screen) => void }) {
  return (
    <div className="v211-narrow">
      <Heading title="المصحف" subtitle="نص موثّق، وعرض لا يسبق اعتماده." />
      <Card className="v211-reader large">
        <span className="v211-chip">
          <LockKeyhole size={13} />
          غير متاح للعرض بعد
        </span>
        <div className="v211-reader-symbol">
          <BookOpen size={41} />
        </div>
        <h2>نحفظ للنص سلامته</h2>
        <p>
          اعتمد المشروع Tanzil مصدرًا للنص القرآني. تفعيل الحزمة المحددة ينتظر
          اكتمال الحقوق والمراجعة المختصة وموافقة المالكة على الحزمة نفسها.
        </p>
        <Button variant="secondary" onClick={() => go("today")}>
          العودة إلى الرحلة <ArrowLeft size={18} />
        </Button>
      </Card>
      <div style={{ marginTop: 20 }}>
        <Card>
          <div className="v211-card-title">
            <div>
              <ShieldCheck size={22} />
              <h2>المصدر والاعتماد</h2>
            </div>
          </div>
          <p className="v211-subtle">
            المصدر:{" "}
            <a
              href={v211ContentStatus.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              مشروع Tanzil
            </a>{" "}
            · النص العثماني {v211ContentStatus.sourceVersion}. فحص النقل
            والفهرسة خطوة تقنية منفصلة عن المراجعة العلمية.
          </p>
          <ul className="v211-gate-list">
            <li>
              <LockKeyhole size={18} />
              <span>
                النص القرآني محجوب في هذه المعاينة، ولا تستبدله نصوص مولّدة.
              </span>
            </li>
            <li>
              <LockKeyhole size={18} />
              <span>
                اعتماد المصدر لا يفتح العرض قبل اكتمال اعتماد الحزمة والخط
                والحقوق.
              </span>
            </li>
            <li>
              <CheckCircle2 size={18} />
              <span>
                يمكن تجربة الحفظ والمراجعة والتعاهد بمقادير اصطناعية معزولة.
              </span>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
function SettingsScreen({
  state,
  go,
  exportSummary,
}: {
  state: ProductState;
  go: (s: Screen) => void;
  exportSummary: () => void;
}) {
  return (
    <>
      <Heading
        title="إعدادات تناسب رحلتك"
        subtitle="اختيارات واضحة، مع الحفاظ على ما بدأتِه وما سجّلتِه."
      />
      <div className="v211-two-col">
        <Card>
          <div className="v211-card-title">
            <div>
              <Target size={22} />
              <h2>الخطة</h2>
            </div>
          </div>
          <dl className="v211-summary-list">
            <div>
              <dt>هدف الحفظ</dt>
              <dd>{num(state.plan!.hifzTarget)} تكرارًا</dd>
            </div>
            <div>
              <dt>هدف التثبيت</dt>
              <dd>{num(state.plan!.linkTarget)} تكرارات</dd>
            </div>
            <div>
              <dt>دورة التعاهد</dt>
              <dd>{num(state.plan!.cycleDays)} أيام</dd>
            </div>
            <div>
              <dt>المنطقة الزمنية</dt>
              <dd>
                <bdi>{state.plan!.zoneId}</bdi>
              </dd>
            </div>
          </dl>
          <p className="v211-tiny">
            تسري التغييرات على الجلسات الجديدة. لا تغيّر عدّاد جلسة بدأت أو
            هدفها.
          </p>
          <Button
            variant="secondary"
            style={{ marginTop: 17 }}
            onClick={() => go("setup")}
          >
            <Settings size={17} />
            تعديل الخطة
          </Button>
        </Card>
        <div className="v211-stack">
          <Card>
            <div className="v211-card-title">
              <div>
                <UserRound size={22} />
                <h2>الحساب والحفظ</h2>
              </div>
              <span className="v211-chip">تجربة محلية</span>
            </div>
            <p className="v211-subtle">
              الحسابات الحقيقية والمزامنة بين الأجهزة غير مفعّلة. لا تحتاج هذه
              المعاينة إلى بريد أو كلمة مرور، ولا ترسل تقدمك إلى حساب سحابي.
            </p>
            <div className="v211-divider" />
            <p className="v211-tiny">
              إغلاق الصفحة يحتفظ بالتجربة. مسح بيانات الموقع من المتصفح يمحوها
              من هذا الجهاز.
            </p>
          </Card>
          <Card>
            <div className="v211-card-title">
              <div>
                <ShieldCheck size={22} />
                <h2>بياناتك وخصوصيتك</h2>
              </div>
            </div>
            <div className="v211-stack">
              <Button variant="secondary" onClick={exportSummary}>
                <Download size={17} />
                تنزيل ملخص التجربة
              </Button>
              <Button variant="ghost" onClick={() => go("privacy")}>
                <CircleHelp size={17} />
                عن خصوصية هذه المعاينة
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
