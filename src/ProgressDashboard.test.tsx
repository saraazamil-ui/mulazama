import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProgressBar, ProgressContent } from "./ProgressDashboard";
import App from "./App";
import { ApplicationService } from "./application/service";
import { MemoryEventStore } from "./persistence/event-store";
import type { ProgressReadModel } from "./progress/projection";

beforeEach(() => {
  window.history.replaceState({}, "", "/#S14");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function emptyModel() {
  const service = await ApplicationService.open(new MemoryEventStore());
  return service.readProgress();
}

describe("06-D1 accessible progress presentation", () => {
  it("gives a measurable bar a textual amount, percentage and accessible name", () => {
    render(<ProgressBar title="تقدم معتمد للاختبار" completed={7} target={20} unit="وحدة" />);
    const bar = screen.getByRole("progressbar", { name: "تقدم معتمد للاختبار" });
    expect(bar).toHaveAttribute("aria-valuenow", "35");
    expect(bar).toHaveAttribute("aria-valuetext", "٧ من ٢٠ وحدة");
    expect(screen.getByText(/المتبقي: ١٣ وحدة/)).toBeVisible();
    expect(bar.querySelector("span")).toHaveStyle({ width: "35%" });
  });
  it("caps visual completion without hiding an exceeded goal or showing negative remainder", () => {
    render(<ProgressBar title="هدف الاختبار" completed={12} target={10} unit="وحدة" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText(/المنجز: ١٢ وحدة/)).toHaveTextContent("المتبقي: ٠ وحدة");
  });
  it.each([null, 0, -1, NaN, Infinity])("does not present a missing/invalid target %s as zero or loading progress", target => {
    render(<ProgressBar title="تقدم الحفظ" completed={0} target={target} unit="وحدة" reason="الهدف غير معتمد" />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText("غير متاح بعد")).toBeVisible();
    expect(screen.getByText("الهدف غير معتمد")).toBeVisible();
    expect(screen.queryByText(/٠٪/)).not.toBeInTheDocument();
  });
  it("distinguishes loading from an error and makes retry operable by keyboard", async () => {
    const retry = vi.fn(), user = userEvent.setup();
    const view = render(<ProgressContent state={{ status: "loading" }} retry={retry} />);
    expect(screen.getByRole("status")).toHaveTextContent("جارٍ قراءة");
    view.rerender(<ProgressContent state={{ status: "error", message: "سجل غير صالح" }} retry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("سجل غير صالح");
    await user.tab();
    expect(screen.getByRole("button", { name: "إعادة قراءة التقدم" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(retry).toHaveBeenCalledOnce();
  });
  it("shows honest empty history and preserves all scientific gates", async () => {
    const model = await emptyModel();
    const view = render(<ProgressContent state={{ status: "ready", value: model }} retry={() => {}} detailed />);
    expect(view.container.querySelector('[dir="rtl"]')).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText(/لا توجد نتائج تسميع مسجلة لعرض إنجاز الأيام السابقة/)).toBeVisible();
    expect(screen.getByText(model.review.reason)).toBeVisible();
    expect(screen.getByText(model.memorization.reason)).toBeVisible();
    expect(screen.getByText(model.daily.reason)).toBeVisible();
    expect(screen.getByText(/لم تُسجل بلاغات مواضع بعد/)).toBeVisible();
  });
  it("renders measured history separately from unapproved completion, and retains unknown errors and termination", async () => {
    const model: ProgressReadModel = await emptyModel();
    model.activity = { hasEvidence: true, assessedAttempts: 1, completedSessions: 0, last7Days: 0, last30Days: 0 };
    model.days = [{ localDate: model.meta.localDate, completedSessions: 0, assessedAttempts: 1 }];
    model.attempts = [{ attemptId: "fixture-a", sessionId: "fixture-s", unitId: "fixture-u", endedAt: model.meta.asOf,
      localDate: model.meta.localDate, completion: "complete", errors: null, attemptedWords: 3, requestedWords: 10,
      effort: "unknown", hints: 1, revealed: false, termination: "technical_failure", revision: 2, sourceEventIds: ["fixture-event"] }];
    render(<ProgressContent state={{ status: "ready", value: model }} retry={() => {}} detailed />);
    expect(screen.getByText(/نهاية المحاولة: توقف تقني/)).toHaveTextContent("الكلمات المسمّعة: ٣ من ١٠");
    expect(screen.getByText(/الأخطاء المبلّغ عنها: غير معلومة/)).toBeVisible();
    expect(screen.getByText(/نسخة التقييم ٢/)).toBeVisible();
    expect(screen.getByText("٠ جلسات بتسميع مكتمل · ١ محاولات مقيّمة")).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "فترة السجل" }), "all");
    expect(screen.getByText(/نهاية المحاولة: توقف تقني/)).toBeVisible();
  });
});

describe("06-D1 App read model refresh", () => {
  it("reads corrected product facts on focus without manufacturing learning records", async () => {
    const store = new MemoryEventStore(), service = await ApplicationService.open(store);
    await service.dispatch({ type: "mistake.add", draft: { attemptId: null, location: "موضع سابق", type: "word", certainty: "suspected", selfCorrected: null, assistanceUsed: null, note: "" } });
    render(<App service={service} />);
    const region = screen.getByRole("region", { name: "ملخص التقدم" });
    await within(region).findByText("موضع سابق");
    const id = service.state.mistakes[0].id;
    await service.dispatch({ type: "mistake.correct", id, patch: { location: "موضع مصحح", certainty: "observed" }, reason: "تصحيح صريح للاختبار" });
    act(() => window.dispatchEvent(new Event("focus")));
    await within(region).findByText("موضع مصحح");
    expect(within(region).queryByText("موضع سابق")).not.toBeInTheDocument();
    expect(service.state.attempts).toHaveLength(0);
    expect((await store.load()).events).toHaveLength(3);
  });
  it("does not keep stale facts after a refresh failure, and retry recovers", async () => {
    const service = await ApplicationService.open(new MemoryEventStore());
    render(<App service={service} />);
    await screen.findByText(/لا توجد نتائج تسميع مسجلة/);
    const refresh = vi.spyOn(service, "readProgressFresh").mockRejectedValueOnce(new Error("فشل قراءة اختباري"));
    act(() => window.dispatchEvent(new Event("focus")));
    await screen.findByText(/فشل قراءة اختباري/);
    expect(screen.queryByText(/لا توجد نتائج تسميع مسجلة/)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "إعادة قراءة التقدم" }));
    await screen.findByText(/لا توجد نتائج تسميع مسجلة/);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
  it("rereads at Riyadh midnight without adding an event or requiring a page reload", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T20:59:59.000Z"));
    const store = new MemoryEventStore(), service = await ApplicationService.open(store);
    const read = vi.spyOn(service, "readProgressFresh");
    await act(async () => { render(<App service={service} />); });
    expect(read).toHaveBeenCalledOnce();
    expect((await read.mock.results[0].value).meta.localDate).toBe("2026-11-07");
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(read).toHaveBeenCalledTimes(2);
    expect((await read.mock.results[1].value).meta.localDate).toBe("2026-11-08");
    expect((await store.load()).events).toHaveLength(1);
  });
  it("keeps home concise and exposes the trusted summary through progress navigation with no synthetic schedule", async () => {
    window.history.replaceState({}, "", "/#S05");
    const service = await ApplicationService.open(new MemoryEventStore());
    render(<App service={service} />);
    expect(screen.queryByRole("region", { name: "ملخص التقدم" })).not.toBeInTheDocument();
    await userEvent.setup().click(within(screen.getByRole('navigation', { name: 'التنقل الرئيسي' })).getByRole('button', { name: 'تقدمي' }));
    const summary = screen.getByRole("region", { name: "ملخص التقدم" });
    await waitFor(() => expect(within(summary).getByRole("heading", { name: "تقدم الحفظ" })).toBeVisible());
    expect(within(summary).getByRole("heading", { name: "إنجاز ورد اليوم" })).toBeVisible();
    expect(within(summary).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "تقدمي" })).toBeVisible();
  });
});
