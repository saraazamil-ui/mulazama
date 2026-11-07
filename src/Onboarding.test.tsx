import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Onboarding } from "./Onboarding";
import { HistoryApplication } from "./application/history-application";
import { MemoryEventStore } from "./persistence/event-store";
import type { OnboardingSubmission } from "./application/service";

afterEach(cleanup);
async function setup(store = new MemoryEventStore()) {
  const app = await HistoryApplication.open(store), complete = vi.fn();
  const save = vi.fn(async (input: OnboardingSubmission) => { try { await app.product.configureOnboarding(input); return true; } catch { return false; } });
  render(<Onboarding config={app.product.state.config} ranges={app.product.state.ranges} onSave={save} onComplete={complete} />);
  const user = userEvent.setup();
  const next = async () => user.click(screen.getByRole("button", { name: /التالي:/ }));
  return { app, store, complete, save, user, next };
}

describe("06-L1 onboarding user journeys with real persistence", () => {
  it.each([
    ["أبدأ الحفظ من الصفر", "beginner", "memorize", false],
    ["لدي محفوظات سابقة وأريد مراجعتها", "returning", "maintain", true],
    ["أريد الجمع بين الحفظ الجديد والمراجعة", "scattered", "memorize", true],
  ] as const)("L1U01 %s reaches three steps with explicit unassessed declarations", async (label, persona, goal, prior) => {
    const s = await setup(); const before = await s.store.load();
    await s.user.click(screen.getByRole("radio", { name: label }));
    await s.next();
    expect(screen.getByRole("heading", { name: "المحفوظات والهدف" })).toHaveFocus();
    if (prior) {
      expect(screen.getByText(/ليست حفظًا تحقق بالتسميع/)).toBeVisible();
      await s.user.click(screen.getByRole("button", { name: "أضف إلى اختياراتي" }));
    }
    await s.next();
    expect(screen.getByRole("heading", { name: "الوقت المناسب" })).toHaveFocus();
    expect(await s.store.load()).toEqual(before);
    await s.user.click(screen.getByRole("button", { name: "احفظ واذهب إلى الرئيسية" }));
    expect(s.complete).toHaveBeenCalledOnce();
    expect(s.app.product.state.config).toMatchObject({ persona, goal, configured: true });
    expect(s.app.product.state.ranges).toHaveLength(prior ? 1 : 0);
    expect(s.app.product.state.ranges.every(range => range.status === "declared_unassessed")).toBe(true);
    expect(s.app.product.state.attempts).toEqual([]);
    expect((await s.app.readProgress()).memorization.percent).toBeNull();
  });
  it("L1U02 a write error keeps the user on the form and retry retains one setup only", async () => {
    let fail = false; const store = new MemoryEventStore(() => { if (fail) throw Error("quota"); });
    const s = await setup(store);
    await s.user.click(screen.getByRole("radio", { name: "لدي محفوظات سابقة وأريد مراجعتها" }));
    await s.next(); await s.user.click(screen.getByRole("button", { name: "أضف إلى اختياراتي" })); await s.next();
    const before = await store.load(); fail = true;
    await s.user.click(screen.getByRole("button", { name: "احفظ واذهب إلى الرئيسية" }));
    expect(screen.getByRole("alert")).toHaveTextContent("لم يُؤكد حفظ الإعداد");
    expect(s.complete).not.toHaveBeenCalled(); expect(await store.load()).toEqual(before);
    fail = false; await s.user.click(screen.getByRole("button", { name: "احفظ واذهب إلى الرئيسية" }));
    expect(s.save.mock.calls[0][0].commandId).toBe(s.save.mock.calls[1][0].commandId);
    expect(s.complete).toHaveBeenCalledOnce(); expect(s.app.product.state.ranges).toHaveLength(1);
    expect((await store.load()).events.filter(event => event.type === "UserPlanConfigRevised")).toHaveLength(1);
  });
  it("L1U03 invalid goal and invalid time cannot silently become saved defaults", async () => {
    const s = await setup(); await s.next();
    await s.user.clear(screen.getByLabelText(/سورة البداية/)); await s.next();
    expect(screen.getByRole("alert")).toHaveTextContent("رقم سورة البداية");
    await s.user.type(screen.getByLabelText(/سورة البداية/), "114"); await s.next();
    await s.user.clear(screen.getByLabelText("الوقت اليومي بالدقائق"));
    await s.user.click(screen.getByRole("button", { name: "احفظ واذهب إلى الرئيسية" }));
    expect(screen.getByRole("alert")).toHaveTextContent("وقتًا صحيحًا");
    expect(s.save).not.toHaveBeenCalled(); expect(s.app.product.state.config.configured).toBe(false);
  });
  it("L1U04 an explicit later choice never infers prior memorization from default range fields", async () => {
    const s = await setup();
    await s.user.click(screen.getByRole("radio", { name: "لدي محفوظات سابقة وأريد مراجعتها" }));
    await s.next(); await s.user.click(screen.getByRole("button", { name: "أحدد محفوظاتي لاحقًا — التالي" }));
    await s.user.click(screen.getByRole("button", { name: "احفظ واذهب إلى الرئيسية" }));
    expect(s.complete).toHaveBeenCalledOnce(); expect(s.app.product.state.ranges).toEqual([]);
  });
  it("L1U05 repeated additions and overlapping selectors do not duplicate declared coverage", async () => {
    const s = await setup();
    await s.user.click(screen.getByRole("radio", { name: "أريد الجمع بين الحفظ الجديد والمراجعة" })); await s.next();
    await s.user.click(screen.getByRole("button", { name: "أضف إلى اختياراتي" }));
    await s.user.click(screen.getByRole("button", { name: "أضف إلى اختياراتي" }));
    await s.user.clear(screen.getByLabelText("نهاية المحفوظ السابق")); await s.user.type(screen.getByLabelText("نهاية المحفوظ السابق"), "3");
    await s.user.click(screen.getByRole("button", { name: "أضف إلى اختياراتي" })); await s.next();
    await s.user.click(screen.getByRole("button", { name: "احفظ واذهب إلى الرئيسية" }));
    expect(s.app.product.state.ranges.map(range => [range.start, range.end])).toEqual([[1, 3]]);
    expect((await s.store.load()).events.filter(event => event.type === "PriorKnowledgeDeclared")).toHaveLength(1);
  });
  it("L1U06 going back preserves drafts and keyboard activation progresses with focus", async () => {
    const s = await setup(); await s.next();
    await s.user.clear(screen.getByLabelText(/سورة البداية/)); await s.user.type(screen.getByLabelText(/سورة البداية/), "114");
    await s.next(); await s.user.click(screen.getByRole("button", { name: "رجوع" }));
    expect(screen.getByLabelText(/سورة البداية/)).toHaveValue(114);
    screen.getByRole("button", { name: "التالي: الوقت المناسب" }).focus(); await s.user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "الوقت المناسب" })).toHaveFocus();
    expect(s.save).not.toHaveBeenCalled();
  });
  it("L1U07 switching to prior review cannot trap the user behind an invalid hidden new-hifz field", async () => {
    const s = await setup(); const originalStart = s.app.product.state.config.startSurah;
    await s.next(); await s.user.clear(screen.getByLabelText(/سورة البداية/));
    await s.user.click(screen.getByRole("button", { name: "رجوع" }));
    await s.user.click(screen.getByRole("radio", { name: "لدي محفوظات سابقة وأريد مراجعتها" }));
    await s.next();
    expect(screen.queryByLabelText(/سورة البداية/)).not.toBeInTheDocument();
    await s.user.click(screen.getByRole("button", { name: "أحدد محفوظاتي لاحقًا — التالي" }));
    expect(screen.getByRole("heading", { name: "الوقت المناسب" })).toBeVisible();
    await s.user.click(screen.getByRole("button", { name: "احفظ واذهب إلى الرئيسية" }));
    expect(s.complete).toHaveBeenCalledOnce();
    expect(s.app.product.state.config).toMatchObject({ startSurah: originalStart, goal: "maintain", configured: true });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
