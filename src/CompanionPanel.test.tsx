import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompanionPanel, companionIntervalLabel } from "./CompanionPanel";
import { projectPersonalMemory } from "./memory/personal-memory";
import { addCompanionAttempt, addCompanionReport, appendCompanionEvent, attemptId, companionFixture, companionNow, observation } from "./companion/test-fixture";

afterEach(cleanup);
const ready = (snapshot = companionFixture()) => ({ status: "ready" as const, value: projectPersonalMemory(snapshot, companionNow) });
describe("06-L1 factual companion presentation", () => {
  it("L1UI01 loading, unavailable and error states contain no invented summary and retry is keyboard accessible", async () => {
    const retry = vi.fn(), user = userEvent.setup();
    const view = render(<CompanionPanel state={{ status: "loading" }} retry={retry} />);
    expect(screen.getByRole("status")).toHaveTextContent("جارٍ قراءة ذاكرة الحافظ");
    view.rerender(<CompanionPanel state={{ status: "unavailable", message: "مصدر ذاكرة الحافظ غير متاح" }} retry={retry} />);
    expect(screen.getByText("مصدر ذاكرة الحافظ غير متاح")).toBeVisible();
    expect(screen.queryByText("محاولات لها نتيجة")).not.toBeInTheDocument();
    view.rerender(<CompanionPanel state={{ status: "error", message: "فشل مصدر السجل" }} retry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("فشل مصدر السجل");
    await user.tab();
    expect(screen.getByRole("button", { name: "إعادة قراءة ذاكرة الحافظ" })).toHaveFocus();
    await user.keyboard("{Enter}"); expect(retry).toHaveBeenCalledOnce();
  });
  it("L1UI02 new user has truthful lack of evidence, RTL and no sessions or fake progress", () => {
    const snapshot = companionFixture(); snapshot.events = snapshot.events.slice(0, 1); snapshot.revision = 1;
    const view = render(<CompanionPanel state={ready(snapshot)} retry={() => {}} detailed />);
    expect(screen.getByRole("region", { name: "ذاكرة الحافظ" })).toHaveAttribute("dir", "rtl");
    expect(screen.getByText(/لا توجد نتائج تسميع مرتبطة بمقاطع/)).toBeVisible();
    expect(screen.getByText("ثبات الحفظ: يحتاج إلى تسميعات إضافية لتقديره.")).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(view.container.querySelector("a")).toBeNull();
  });
  it("L1UI03 compact home panel shows only factual counts and preserves the scientific limit", () => {
    const snapshot = companionFixture(); addCompanionReport(snapshot);
    render(<CompanionPanel state={ready(snapshot)} retry={() => {}} />);
    expect(screen.getByText("محاولات لها نتيجة")).toBeVisible();
    expect(screen.getByText("مواضع مبلّغ عنها مرتبطة")).toBeVisible();
    expect(screen.queryByText("موضع تجريبي")).not.toBeInTheDocument();
    expect(screen.getByText(/تفاصيل النتائج والبلاغات وحدودها/)).toBeVisible();
  });
  it("L1UI04 details preserve corrected error totals, original result and location conflict", async () => {
    const snapshot = companionFixture(); addCompanionReport(snapshot);
    appendCompanionEvent(snapshot, { type: "AssessmentCorrected", attemptId, expectedAssessmentRevision: 1,
      reason: "تصحيح محفوظ", observation: { ...observation, errors: 0 } });
    render(<CompanionPanel state={ready(snapshot)} retry={() => {}} detailed />);
    await userEvent.setup().click(screen.getByText("سجل مقطع ١ · ١ محاولات لها نتيجة"));
    expect(screen.getByText(/الأخطاء المبلّغ عنها: ٠/)).toBeVisible();
    expect(screen.getByText(/يوجد بلاغ محفوظ يتعارض/)).toBeVisible();
    await userEvent.setup().click(screen.getByText("تاريخ تصحيحات هذه النتيجة"));
    expect(screen.getByText(/النتيجة الأصلية/)).toHaveTextContent("عدد الأخطاء: ١");
    expect(screen.getByText(/السبب:/)).toHaveTextContent("تصحيح محفوظ");
    expect(screen.getByText(/التصحيح يعود إلى المحاولة الأصلية/)).toBeVisible();
  });
  it("L1UI05 repeat and timed observations are descriptive, without stable-weakness diagnosis", async () => {
    const snapshot = companionFixture(); addCompanionReport(snapshot);
    addCompanionAttempt(snapshot, "next"); addCompanionReport(snapshot, "next");
    render(<CompanionPanel state={ready(snapshot)} retry={() => {}} detailed />);
    expect(screen.getByText(/هذا لا يثبت ضعفًا مستمرًا/)).toBeVisible();
    await userEvent.setup().click(screen.getByText("سجل مقطع ١ · ٢ محاولات لها نتيجة"));
    expect(screen.getByText("تكرر البلاغ بالنص نفسه في فرص مسجلة مختلفة.")).toBeVisible();
    expect(screen.getByText(/الفاصل منذ آخر تعرض مسجل: ١ يوم/)).toHaveTextContent("وليست حكمًا بثبات الحفظ أو ضعفه");
    expect(screen.queryByText("ثبات متقدم")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ابدأ/ })).not.toBeInTheDocument();
  });
  it("L1UI06 unknown observation remains unknown, rather than becoming zero errors", async () => {
    const snapshot = companionFixture();
    appendCompanionEvent(snapshot, { type: "AssessmentCorrected", attemptId, expectedAssessmentRevision: 1,
      reason: "لا أتذكر العدد", observation: { ...observation, errors: null, attemptedWords: null, completion: "unknown" } });
    render(<CompanionPanel state={ready(snapshot)} retry={() => {}} detailed />);
    await userEvent.setup().click(screen.getByText("سجل مقطع ١ · ١ محاولات لها نتيجة"));
    expect(screen.getByText(/الكلمات المسمّعة: غير معلومة/)).toHaveTextContent("الأخطاء المبلّغ عنها: غير معلومة");
    expect(screen.getByText(/الاكتمال غير معلوم/)).toBeVisible();
  });
  it("L1UI07 arbitrary location text is escaped and never decoded into canonical scripture", async () => {
    const snapshot = companionFixture(); addCompanionReport(snapshot, attemptId, '<script>alert("test")</script>');
    const view = render(<CompanionPanel state={ready(snapshot)} retry={() => {}} detailed />);
    await userEvent.setup().click(screen.getByText("سجل مقطع ١ · ١ محاولات لها نتيجة"));
    expect(screen.getByText('<script>alert("test")</script>')).toBeVisible();
    expect(view.container.querySelector("script")).toBeNull();
    expect(screen.getByText(/هذا عنوان للسجل؛ لا يحدد سورة أو آية/)).toBeVisible();
  });
  it.each([[0, "أقل من ثانية"], [120000, "٢ دقيقة"], [90061000, "١ يوم و١ ساعة و١ دقيقة و١ ثانية"]])("L1UI08 formats actual elapsed time %d without calendar rounding", (milliseconds, label) => {
    expect(companionIntervalLabel(milliseconds)).toBe(label);
  });
});
