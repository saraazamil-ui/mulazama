import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { HistoryApplication } from "./application/history-application";
import { MemoryEventStore } from "./persistence/event-store";
afterEach(cleanup);

it.each(["beginner", "prior"] as const)("L1J01 actual App journey interaction count: %s", async persona => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  window.history.replaceState({}, "", "/#S01");
  const store = new MemoryEventStore(), app = await HistoryApplication.open(store);
  const user = userEvent.setup(); let interactions = 0;
  const click = async (name: string) => { await user.click(screen.getByRole("button", { name })); interactions++; };
  render(<App service={app.product} data={app} />);
  await click("ابدأ إعداد تجربتك");
  if (persona === "prior") { await user.click(screen.getByRole("radio", { name: "لدي محفوظات سابقة وأريد مراجعتها" })); interactions++; }
  await click("التالي: المحفوظات والهدف");
  if (persona === "prior") await click("أضف إلى اختياراتي");
  await click("التالي: الوقت المناسب");
  await click("احفظ واذهب إلى الرئيسية");
  expect(document.querySelector('main[data-screen="S05"]')).toBeVisible();
  expect(app.product.state.config.configured).toBe(true);
  expect(app.product.state.ranges).toHaveLength(persona === "prior" ? 1 : 0);
  expect(app.product.state.attempts).toEqual([]);
  expect(interactions).toBe(persona === "prior" ? 6 : 4);
  const reopened = await HistoryApplication.open(store);
  expect(reopened.product.state.config).toEqual(app.product.state.config);
  expect(reopened.product.state.ranges).toEqual(app.product.state.ranges);
  console.log(JSON.stringify({ phase: "06L1", persona, semanticInteractions: interactions, endpoint: "S05 blocked daily plan", sessionsStarted: 0 }));
});
