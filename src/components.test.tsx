import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, Empty, Field, Heading, Notice } from "./components";
import App from "./App";
import { ApplicationService } from "./application/service";
import { MemoryEventStore } from "./persistence/event-store";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("accessible interactive components", () => {
  it("Field gives an editable input a programmatic label usable by keyboard", async () => {
    const user = userEvent.setup();
    render(
      <Field label="وقت الدراسة">
        <input type="number" defaultValue={30} />
      </Field>,
    );
    const input = screen.getByRole("spinbutton", { name: "وقت الدراسة" });
    expect(screen.getByLabelText("وقت الدراسة")).toBe(input);
    await user.tab();
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, "45");
    expect(input).toHaveValue(45);
  });
  it("Field labels a select so its current choice is observable", async () => {
    const user = userEvent.setup();
    render(
      <Field label="حالة الأخطاء">
        <select defaultValue="unknown">
          <option value="unknown">غير معلوم</option>
          <option value="none">لم أرصد خطأ</option>
        </select>
      </Field>,
    );
    const select = screen.getByRole("combobox", { name: "حالة الأخطاء" });
    expect(select).toHaveValue("unknown");
    await user.selectOptions(select, "none");
    expect(select).toHaveValue("none");
  });
  it("disabled action cannot trigger mutations and is skipped in keyboard order", async () => {
    const user = userEvent.setup();
    const mutate = vi.fn();
    render(
      <>
        <Button disabled onClick={mutate} variant="danger">
          احذف البيانات
        </Button>
        <Button>إلغاء</Button>
      </>,
    );
    await user.click(screen.getByRole("button", { name: "احذف البيانات" }));
    expect(mutate).not.toHaveBeenCalled();
    await user.tab();
    expect(screen.getByRole("button", { name: "إلغاء" })).toHaveFocus();
  });
  it("ordinary Button inside a form does not accidentally submit or reload the form", async () => {
    const user = userEvent.setup();
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const action = vi.fn();
    render(
      <form onSubmit={submit}>
        <Button variant="secondary" onClick={action}>
          معاينة الوقت
        </Button>
      </form>,
    );
    await user.click(screen.getByRole("button", { name: "معاينة الوقت" }));
    expect(action).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
  });
  it("Notice exposes errors as alerts while informational content does not interrupt", () => {
    render(
      <>
        <Notice tone="error">تعذر تأكيد الحفظ. أعد المحاولة.</Notice>
        <Notice>المراجعة ما زالت معلقة.</Notice>
      </>,
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("تعذر تأكيد الحفظ");
    expect(
      screen.getByText("المراجعة ما زالت معلقة.").closest('[role="alert"]'),
    ).toBeNull();
  });
  it("Heading provides one focusable h1 and a usable named back action", async () => {
    const user = userEvent.setup();
    const back = vi.fn();
    render(
      <Heading
        eyebrow="مُلازَمَة / S10"
        title="استئناف الجلسة"
        description="آخر حفظ مؤكد"
        back={back}
      />,
    );
    const h1 = screen.getByRole("heading", {
      level: 1,
      name: "استئناف الجلسة",
    });
    h1.focus();
    expect(h1).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "رجوع" }));
    expect(back).toHaveBeenCalledOnce();
  });
  it("Empty state offers a meaningful recovery action without implying success", async () => {
    const user = userEvent.setup();
    const add = vi.fn();
    render(
      <Empty
        title="لا توجد نطاقات"
        action={<Button onClick={add}>أضف محفوظك</Button>}
      >
        لم يُختبر محفوظك بعد.
      </Empty>,
    );
    expect(
      screen.getByRole("heading", { name: "لا توجد نطاقات" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "أضف محفوظك" }));
    expect(add).toHaveBeenCalledOnce();
    expect(screen.getByText("لم يُختبر محفوظك بعد.")).toBeVisible();
  });
});

describe("all production screen routes", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });
  it.each(
    Array.from({ length: 19 }, (_, i) => "S" + String(i + 1).padStart(2, "0")),
  )(
    "renders %s from real empty contracts without writing learning facts",
    async (id) => {
      window.history.replaceState({}, "", "/#" + id);
      const store = new MemoryEventStore();
      const service = await ApplicationService.open(store);
      const before = await store.load();
      render(<App service={service} />);
      expect(
        document.querySelector('main[data-screen="' + id + '"]'),
      ).toBeVisible();
      expect(screen.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await store.load()).toEqual(before);
      expect(service.state.attempts).toHaveLength(0);
    },
  );
});

describe("App event-store integration", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/#S01");
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });
  it("a failed event commit never changes the displayed preference or confirmed state", async () => {
    const user = userEvent.setup();
    const store = new MemoryEventStore();
    const service = await ApplicationService.open(store);
    const before = await store.load();
    vi.spyOn(store, "append").mockRejectedValue(
      new Error("تعذر الحفظ للاختبار"),
    );
    render(<App service={service} />);
    await user.click(
      screen.getByRole("button", { name: "تفعيل الوضع الداكن" }),
    );
    expect(screen.getAllByText("تعذر الحفظ للاختبار").length).toBeGreaterThan(
      0,
    );
    expect(service.state.preferences.dark).toBe(false);
    expect(await store.load()).toEqual(before);
    expect(document.documentElement.dataset.theme).toBe("light");
    await user.click(screen.getByRole("button", { name: "إغلاق الرسالة" }));
    await user.click(
      screen.getByRole("button", { name: "تفعيل الوضع الداكن" }),
    );
    expect(service.state.preferences.dark).toBe(false);
    expect(await store.load()).toEqual(before);
  });
  it("uses the approved identity and hides prototype injection controls", async () => {
    const service = await ApplicationService.open(new MemoryEventStore());
    render(<App service={service} />);
    expect(
      screen.getByRole("button", { name: "مُلازَمَة، ورد اليوم" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 1, name: "أهلًا بك في مُلازَمَة" }),
    ).toBeVisible();
    expect(screen.queryByText(/أدوات فحص النموذج/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("حالة الاختبار")).not.toBeInTheDocument();
    expect(
      screen.queryByText("إتقان", { exact: true }),
    ).not.toBeInTheDocument();
  });
  it("blocks learning screens without manufacturing an attempt or a repetition", async () => {
    window.history.replaceState({}, "", "/#S07");
    const store = new MemoryEventStore();
    const service = await ApplicationService.open(store);
    const before = await store.load();
    render(<App service={service} />);
    expect(screen.getByText("النص المعتمد ينتظر الإضافة")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /أنهيت التكرار/ }),
    ).not.toBeInTheDocument();
    expect(service.state.session).toBeNull();
    expect(service.state.attempts).toHaveLength(0);
    expect(await store.load()).toEqual(before);
  });
  it("renders the daily plan from the durable service without reference fixtures", async () => {
    window.history.replaceState({}, "", "/#S05");
    const service = await ApplicationService.open(new MemoryEventStore());
    await service.dispatch({
      type: "config",
      config: { ...service.state.config, configured: true },
    });
    render(<App service={service} />);
    expect(screen.queryByText("إصلاح موضع متكرر")).not.toBeInTheDocument();
    expect(screen.queryByText("اختبار اليوم التالي")).not.toBeInTheDocument();
    expect(screen.queryByText("تدريب مقدار جديد")).not.toBeInTheDocument();
    expect(service.state.attempts).toHaveLength(0);
  });
});
