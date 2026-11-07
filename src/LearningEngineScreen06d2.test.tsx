import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LearningEngineScreen } from "./LearningEngineScreen";
import { CompositeApplication } from "./application/composite-application";
import { MemoryEventStore } from "./persistence/event-store";
import { createSyntheticLearningAccess } from "./testing/learning-access";

const unit = { id: "test-d2-ux", editionId: "test-d2-ux-edition", probeProfileVersionId: "chunk-P0-1", words: 10, coverage: ["test:d2:ux"] };
const complete = { attemptedWords: 10, errors: 2, completion: "complete" as const, effort: "normal" as const, gapVerified: true };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function setup(assessed = false) {
  const store = new MemoryEventStore(), app = await CompositeApplication.open(store, { access: await createSyntheticLearningAccess([unit]) });
  await app.adapter.register(unit, { commandId: "register" });
  await app.adapter.send({ type: "start", unitId: unit.id, sessionId: "s" }, { commandId: "start" });
  await app.adapter.send({ type: "recall", sessionId: "s", attemptId: "a" }, { commandId: "recall" });
  await app.adapter.send({ type: "complete", sessionId: "s", termination: "completed" }, { commandId: "end-recall" });
  if (assessed) await app.adapter.send({ type: "assess", attemptId: "a", observation: complete }, { commandId: "assess" });
  return { store, app };
}
function evidence(name: string, value: unknown) {
  console.info("UX_MEASURED " + name + " " + JSON.stringify(value));
}

describe("06-D2 preserved observations and measured minimal-input UX (synthetic service scenario)", () => {
  it("records five form actions for new full-scope assessment", async () => {
    const { app, store } = await setup(), user = userEvent.setup(), actions: string[] = [];
    render(<LearningEngineScreen adapter={app.adapter} id="S09" />);
    await user.type(screen.getByLabelText("الأخطاء المعلومة"), "2"); actions.push("enter known errors");
    await user.selectOptions(screen.getByLabelText("اكتمال النطاق"), "complete"); actions.push("select completion");
    await user.selectOptions(screen.getByLabelText("الجهد"), "normal"); actions.push("select effort");
    await user.click(screen.getByRole("checkbox", { name: "أؤكد خلو الفاصل من التعرض ذي الصلة" })); actions.push("confirm exposure gap");
    await user.click(screen.getByRole("button", { name: "حفظ الدليل اليدوي" })); actions.push("submit");
    await waitFor(() => expect(app.adapter.state.attempts.a.assessment).toMatchObject(complete));
    expect(actions).toHaveLength(5);
    evidence("ux-after-new", { phase: "06-D2", measured: true, actions, count: actions.length, events: (await store.load()).events.filter(e => e.type === "AssessmentSubmitted").length, limitations: "Component + real service/store, synthetic units. One field fill/choice/submit is one semantic action; not a human time or keystroke study." });
  });
  it("hydrates saved correction fields and measures three actions without re-entering saved observations", async () => {
    const { app, store } = await setup(true), user = userEvent.setup(), actions: string[] = [];
    render(<LearningEngineScreen adapter={app.adapter} id="S09" />);
    const blankOnReopen = screen.getByLabelText<HTMLInputElement>("الكلمات التي حاولت تسميعها").value === "" && screen.getByLabelText<HTMLSelectElement>("اكتمال النطاق").value === "unknown";
    expect(blankOnReopen).toBe(false);
    expect(screen.getByLabelText("الكلمات التي حاولت تسميعها")).toHaveValue(10);
    expect(screen.getByLabelText("الأخطاء المعلومة")).toHaveValue(2);
    expect(screen.getByLabelText("اكتمال النطاق")).toHaveValue("complete");
    expect(screen.getByLabelText("الجهد")).toHaveValue("normal");
    expect(screen.getByRole("checkbox", { name: "أؤكد خلو الفاصل من التعرض ذي الصلة" })).toBeChecked();
    await user.clear(screen.getByLabelText("الأخطاء المعلومة"));
    await user.type(screen.getByLabelText("الأخطاء المعلومة"), "1"); actions.push("replace known errors");
    await user.type(screen.getByLabelText("سبب تصحيح التقييم"), "تصحيح عدد الأخطاء"); actions.push("enter correction reason");
    await user.click(screen.getByRole("button", { name: "حفظ تصحيح مؤرخ للمحاولة الأصلية" })); actions.push("submit correction");
    await waitFor(() => expect(app.adapter.state.attempts.a.assessment).toMatchObject({ ...complete, errors: 1 }));
    expect(actions).toHaveLength(3);
    evidence("ux-after-correction", { phase: "06-D2", measured: true, blankOnReopen, actions, count: actions.length, corrections: (await store.load()).events.filter(e => e.type === "AssessmentCorrected").length, limitations: "Component + real service/store, synthetic units; filling a field is one semantic action." });
  });
  it("explicit full-scope selection uses registered size but does not invent errors, effort or exposure-gap evidence", async () => {
    const { app } = await setup(), user = userEvent.setup();
    render(<LearningEngineScreen adapter={app.adapter} id="S09" />);
    await user.selectOptions(screen.getByLabelText("اكتمال النطاق"), "complete");
    expect(screen.getByLabelText("الكلمات التي حاولت تسميعها")).toHaveValue(10);
    expect(screen.getByLabelText("الأخطاء المعلومة")).toHaveValue(null);
    expect(screen.getByLabelText("الجهد")).toHaveValue("unknown");
    expect(screen.getByRole("checkbox", { name: "أؤكد خلو الفاصل من التعرض ذي الصلة" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "حفظ الدليل اليدوي" }));
    await waitFor(() => expect(app.adapter.state.attempts.a.assessment).toMatchObject({ attemptedWords: 10, completion: "complete", errors: null, effort: "unknown", gapVerified: false }));
    expect(app.adapter.state.assessments.a.strictPass).toBeNull();
  });
  it("a reason alone cannot create a duplicate no-op correction", async () => {
    const { app, store } = await setup(true), user = userEvent.setup(), before = await store.load();
    render(<LearningEngineScreen adapter={app.adapter} id="S09" />);
    await user.type(screen.getByLabelText("سبب تصحيح التقييم"), "سبب بلا تعديل");
    const save = screen.getByRole("button", { name: "حفظ تصحيح مؤرخ للمحاولة الأصلية" });
    expect(save).toBeDisabled();
    await user.click(save);
    expect(await store.load()).toEqual(before);
  });
  it("partial scope remains manually editable without fabricating full completion", async () => {
    const { app } = await setup(), user = userEvent.setup();
    render(<LearningEngineScreen adapter={app.adapter} id="S09" />);
    await user.selectOptions(screen.getByLabelText("اكتمال النطاق"), "complete");
    await user.selectOptions(screen.getByLabelText("اكتمال النطاق"), "partial");
    await user.clear(screen.getByLabelText("الكلمات التي حاولت تسميعها"));
    await user.type(screen.getByLabelText("الكلمات التي حاولت تسميعها"), "4");
    await user.click(screen.getByRole("button", { name: "حفظ الدليل اليدوي" }));
    await waitFor(() => expect(app.adapter.state.attempts.a.assessment).toMatchObject({ attemptedWords: 4, completion: "partial", errors: null }));
    expect((await app.readProgress()).daily.completedSessions).toBe(0);
  });
  it("a failed durable write preserves the correction draft and every original observation", async () => {
    const { app, store } = await setup(true), user = userEvent.setup(), before = await store.load(), onCommitted = vi.fn();
    render(<LearningEngineScreen adapter={app.adapter} id="S09" onCommitted={onCommitted} />);
    await user.clear(screen.getByLabelText("الأخطاء المعلومة"));
    await user.type(screen.getByLabelText("الأخطاء المعلومة"), "1");
    await user.type(screen.getByLabelText("سبب تصحيح التقييم"), "تصحيح العدد");
    vi.spyOn(store, "append").mockRejectedValueOnce(new Error("test-write-not-confirmed"));
    await user.click(screen.getByRole("button", { name: "حفظ تصحيح مؤرخ للمحاولة الأصلية" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("test-write-not-confirmed"));
    expect(screen.getByLabelText("الأخطاء المعلومة")).toHaveValue(1);
    expect(screen.getByLabelText("الكلمات التي حاولت تسميعها")).toHaveValue(10);
    expect(screen.getByLabelText("سبب تصحيح التقييم")).toHaveValue("تصحيح العدد");
    expect(app.adapter.state.attempts.a.assessment).toMatchObject(complete);
    expect(await store.load()).toEqual(before);
    expect(screen.getByRole("status")).not.toHaveTextContent("حُفظ الإجراء");
    expect(onCommitted).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "حفظ تصحيح مؤرخ للمحاولة الأصلية" }));
    await waitFor(() => expect(app.adapter.state.attempts.a.assessment?.errors).toBe(1));
    expect((await store.load()).events.filter(e => e.type === "AssessmentCorrected")).toHaveLength(1);
    expect(onCommitted).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "حفظ تصحيح مؤرخ للمحاولة الأصلية" })).toBeDisabled();
  });
  it("shows pending confirmation, locks draft inputs during commit and reports success only after the durable acknowledgement", async () => {
    const { app, store } = await setup(), user = userEvent.setup();
    const originalAppend = store.append.bind(store), onCommitted = vi.fn();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(store, "append").mockImplementationOnce(async (...args) => { await held; return originalAppend(...args); });
    render(<LearningEngineScreen adapter={app.adapter} id="S09" onCommitted={onCommitted} />);
    await user.selectOptions(screen.getByLabelText("اكتمال النطاق"), "complete");
    await user.click(screen.getByRole("button", { name: "حفظ الدليل اليدوي" }));
    expect(screen.getByRole("status")).toHaveTextContent("جارٍ تأكيد الحفظ");
    expect(screen.getByRole("status")).not.toHaveTextContent("حُفظ الإجراء");
    expect(screen.getByLabelText("الأخطاء المعلومة")).toBeDisabled();
    expect(app.adapter.state.attempts.a.assessment).toBeNull();
    expect(onCommitted).not.toHaveBeenCalled();
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("حُفظ الإجراء محليًا بعد تأكيد الكتابة"));
    expect((await store.load()).events.filter(e => e.type === "AssessmentSubmitted")).toHaveLength(1);
    expect(onCommitted).toHaveBeenCalledOnce();
  });
  it("saved unknown values reopen unchanged and typing a reason never turns unknown evidence into zero", async () => {
    const { app } = await setup(), user = userEvent.setup();
    await app.adapter.send({ type: "assess", attemptId: "a", observation: { attemptedWords: null, errors: null, completion: "unknown", effort: "unknown", gapVerified: false } }, { commandId: "unknown-assessment" });
    render(<LearningEngineScreen adapter={app.adapter} id="S09" />);
    expect(screen.getByLabelText("الكلمات التي حاولت تسميعها")).toHaveValue(null);
    expect(screen.getByLabelText("الأخطاء المعلومة")).toHaveValue(null);
    await user.type(screen.getByLabelText("سبب تصحيح التقييم"), "لم تتوفر معلومات جديدة");
    expect(screen.getByRole("button", { name: "حفظ تصحيح مؤرخ للمحاولة الأصلية" })).toBeDisabled();
    expect(app.adapter.state.attempts.a.assessment).toMatchObject({ errors: null, attemptedWords: null, completion: "unknown" });
  });

});
