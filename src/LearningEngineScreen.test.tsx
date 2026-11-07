import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { CompositeApplication } from "./application/composite-application";
import { LearningApplication } from "./application/learning";
import { LearningUiAdapter } from "./application/learning-ui-adapter";
import { ApplicationService } from "./application/service";
import { MemoryEventStore } from "./persistence/event-store";
import { createSyntheticLearningAccess } from "./testing/learning-access";
const unit = {
  id: "test-ui-unit",
  editionId: "test-ui-edition",
  probeProfileVersionId: "chunk-P0-1",
  words: 10,
  coverage: ["test:ui:1"],
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  location.hash = "";
});
async function setup() {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const store = new MemoryEventStore(),
    access = await createSyntheticLearningAccess([unit]),
    learning = await LearningApplication.open(store, { access }),
    adapter = new LearningUiAdapter(learning),
    service = await ApplicationService.open(new MemoryEventStore());
  await adapter.register(unit, { commandId: "register" });
  return { store, access, adapter, service };
}
describe("05C actual S07–S13 React route integration with gated HME", () => {
  it("UIS01 S07 renders real repetition receipt and S08 persists a hint and completion", async () => {
    const s = await setup(),
      user = userEvent.setup();
    location.hash = "S07";
    const mounted = render(<App service={s.service} learning={s.adapter} />);
    await user.click(
      screen.getByRole("button", { name: "بدء الوحدة test-ui-unit" }),
    );
    await user.click(screen.getByRole("button", { name: "أنهيت تكرارًا" }));
    expect(
      s.adapter.state.sessions[Object.keys(s.adapter.state.sessions)[0]]
        .repetitions,
    ).toBe(1);
    await user.click(screen.getByRole("button", { name: "بدء محاولة غيبية" }));
    mounted.unmount();
    location.hash = "S08";
    render(<App service={s.service} learning={s.adapter} />);
    await user.click(screen.getByRole("button", { name: "تسجيل كشف النص" }));
    await user.click(screen.getByRole("button", { name: "أكملت المحاولة" }));
    expect(Object.values(s.adapter.state.attempts)[0]).toMatchObject({
      hints: 1,
      revealed: true,
      termination: "completed",
    });
    expect(s.adapter.state.units[unit.id].memory).toBeNull();
  });
  it("UIS02 S09 starts with unknown errors, records V1 and never silently replaces unknown with zero", async () => {
    const s = await setup(),
      user = userEvent.setup();
    await s.adapter.send(
      { type: "start", unitId: unit.id, sessionId: "s" },
      { commandId: "s" },
    );
    await s.adapter.send(
      { type: "recall", sessionId: "s", attemptId: "a" },
      { commandId: "a" },
    );
    await s.adapter.send(
      { type: "complete", sessionId: "s", termination: "completed" },
      { commandId: "complete" },
    );
    location.hash = "S09";
    render(<App service={s.service} learning={s.adapter} />);
    expect(screen.getByLabelText("الأخطاء المعلومة")).toHaveValue(null);
    await user.click(screen.getByRole("button", { name: "حفظ الدليل اليدوي" }));
    expect(s.adapter.state.attempts.a.assessment).toMatchObject({
      errors: null,
      attemptedWords: null,
      source: "V1",
      completion: "unknown",
    });
    expect(s.adapter.state.assessments.a.strictPass).toBeNull();
  });
  it("UIS03 normal App without an injected gated application keeps Quran routes blocked", async () => {
    const s = await setup();
    location.hash = "S07";
    render(<App service={s.service} />);
    expect(
      screen.queryByRole("button", { name: "أنهيت تكرارًا" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("النص المعتمد ينتظر الإضافة")).toBeInTheDocument();
    expect(s.adapter.state.sessions).toEqual({});
  });
  it("UIS04 S18 blocks partial product data management when learning is attached without the unified controller", async () => {
    const s = await setup();
    location.hash = "S18";
    render(<App service={s.service} learning={s.adapter} />);
    expect(screen.getByText(/إدارة البيانات معلقة/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "صدّر النسخة المشفرة" }),
    ).not.toBeInTheDocument();
  });
  it("UIS05 S11 uses configured budget and explicitly entered costs/spent time in the real HME plan", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const access = await createSyntheticLearningAccess([unit]),
      app = await CompositeApplication.open(new MemoryEventStore(), { access }),
      user = userEvent.setup();
    await app.product.dispatch({
      type: "config",
      config: { ...app.product.state.config, configured: true, minutes: 60 },
    });
    await app.adapter.register(unit, { commandId: "test-register-ui" });
    location.hash = "S11";
    render(<App service={app.product} learning={app.adapter} data={app} />);
    expect(
      screen.getByText(/ميزانية اليوم من إعداد المستخدم: 60 دقيقة/),
    ).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("الدقائق المنفقة فعلًا اليوم بإقرارك"),
      "5",
    );
    await user.type(
      screen.getByLabelText("تقدير دقائق الوحدة test-ui-unit"),
      "100",
    );
    await user.click(
      screen.getByRole("button", { name: "حساب التعاهد من حالة المحرك" }),
    );
    // The click starts an asynchronous queued event-store commit; wait for its observable result.
    await waitFor(() => expect(app.adapter.state.plans.at(-1)?.minutes).toBe(60));
    const plan = app.adapter.state.plans.at(-1)!;
    expect(plan.minutes).toBe(60);
    expect(plan.spentMinutes).toBe(5);
    expect(plan.tasks).toHaveLength(0);
    expect(plan.deferred[0].outcome).toBe("not_measured");
  });
  it("UIS06 a delayed navigation frame preserves an engaged input and still focuses an untouched heading", async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    });
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    for (const userAlreadyEngaged of [true, false]) {
      const s = await setup(), user = userEvent.setup();
      history.replaceState(null, "", "#S11");
      const mounted = render(<App service={s.service} learning={s.adapter} />);
      const field = screen.getByLabelText("الدقائق المنفقة فعلًا اليوم بإقرارك");
      const heading = screen.getByRole("heading", { name: "مُلازَمَة — التحقق الوظيفي للتعلم" });
      const frameId = nextFrameId - 1, frame = frames.get(frameId)!;
      expect(frame).toBeTypeOf("function");
      if (userAlreadyEngaged) await user.click(field);
      // Run the actual pending App callback at the exact problematic moment,
      // after input focus but before the first keystroke. No sleeps or timeout changes.
      act(() => frame(0));
      if (userAlreadyEngaged) {
        expect(field).toHaveFocus();
        await user.keyboard("5");
        expect(field).toHaveValue(5);
      } else {
        expect(heading).toHaveFocus();
      }
      mounted.unmount();
      expect(cancel).toHaveBeenCalledWith(frameId);
      expect(frames.has(frameId)).toBe(false);
    }
  });
});
