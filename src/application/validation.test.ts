import { describe, expect, it, vi } from "vitest";
import { validateProductAction, validateViewQuery } from "./validation";
import { initialState } from "../domain/state";
import { DomainError } from "../core/types";
import type { ContractId } from "../domain/contracts";

const config = () => initialState().config;
const range = () => ({
  id: "range-1",
  kind: "juz",
  start: 1,
  end: 2,
  editionId: "prototype-unverified",
  status: "declared_unassessed",
});
const draft = () => ({
  attemptId: null,
  location: null,
  type: "unknown",
  certainty: "suspected",
  selfCorrected: null,
  assistanceUsed: null,
  note: "",
});
const rejected = (fn: () => void) => {
  expect(fn).toThrow(DomainError);
  try {
    fn();
  } catch (error) {
    expect((error as DomainError).code).toBe("INVALID_INPUT");
  }
};

describe("product action runtime schemas", () => {
  it("accepts every enabled product command without mutation or coercion", () => {
    const actions = [
      { type: "config", config: config() },
      { type: "plan.todayBudget", minutes: 0, localDate: "2026-11-05" },
      { type: "range.add", range: range() },
      { type: "range.remove", id: "range-1" },
      { type: "preferences", patch: { dark: true, largeText: false } },
      { type: "recovery.report", value: "unknown" },
      { type: "mistake.add", draft: draft() },
      {
        type: "mistake.correct",
        id: "mistake-1",
        patch: { location: null, note: "تصحيح", treatment: "awaiting_retest" },
        reason: "تصحيح صريح",
      },
      {
        type: "reset",
        commandId: "command-1",
        expectedRevision: 0,
        now: "2026-11-05T10:00:00Z",
      },
    ];
    for (const action of actions) {
      const before = structuredClone(action);
      expect(() => validateProductAction(action)).not.toThrow();
      expect(action).toEqual(before);
    }
  });
  it.each([
    null,
    undefined,
    [],
    {},
    "config",
    { type: 3 },
    { type: "does.not.exist" },
    { type: "reset", extra: true },
  ])("rejects malformed or unknown command %j", (input) =>
    rejected(() => validateProductAction(input)),
  );
  it.each([NaN, Infinity, -Infinity, -1, 1441, 0.5, "30", null])(
    "rejects an invalid minute value %j",
    (minutes) =>
      rejected(() =>
        validateProductAction({
          type: "config",
          config: { ...config(), minutes },
        }),
      ),
  );
  it("rejects exact-schema extension keys in config and preferences", () => {
    rejected(() =>
      validateProductAction({
        type: "config",
        config: { ...config(), secret: "extra" },
      }),
    );
    rejected(() =>
      validateProductAction({
        type: "preferences",
        patch: { dark: true, version: 2 },
      }),
    );
    rejected(() =>
      validateProductAction({ type: "preferences", patch: { dark: "true" } }),
    );
    rejected(() => validateProductAction({ type: "preferences", patch: {} }));
  });
  it("rejects custom prototypes and own prototype-pollution keys", () => {
    rejected(() =>
      validateProductAction(
        Object.assign(Object.create({ inherited: true }), { type: "reset" }),
      ),
    );
    rejected(() =>
      validateProductAction({
        type: "config",
        config: Object.assign(Object.create({ role: "admin" }), config()),
      }),
    );
    rejected(() =>
      validateProductAction(
        JSON.parse(
          '{"type":"preferences","patch":{"__proto__":{"dark":true}}}',
        ),
      ),
    );
    rejected(() =>
      validateProductAction(JSON.parse('{"type":"reset","constructor":"bad"}')),
    );
  });
  it("does not invoke accessor fields while validating the schema", () => {
    const get = vi.fn(() => true);
    const patch = {};
    Object.defineProperty(patch, "dark", { get, enumerable: true });
    rejected(() => validateProductAction({ type: "preferences", patch }));
    expect(get).not.toHaveBeenCalled();
  });
  it("rejects invalid, sparse, duplicated and accessor-bearing day arrays", () => {
    for (const days of [[0, 0], [7], [-1], [0.2], [], Array(2)])
      rejected(() =>
        validateProductAction({
          type: "config",
          config: { ...config(), days },
        }),
      );
    const get = vi.fn(() => 1);
    const days = [0];
    Object.defineProperty(days, "0", { get, enumerable: true });
    rejected(() =>
      validateProductAction({ type: "config", config: { ...config(), days } }),
    );
    expect(get).not.toHaveBeenCalled();
    expect(() =>
      validateProductAction({
        type: "config",
        config: { ...config(), minutes: 0, days: [] },
      }),
    ).not.toThrow();
  });
  it.each(["id", "attemptId", "revision", "createdAt", "constructor"])(
    "prevents mistake correction from rewriting %s",
    (key) => {
      rejected(() =>
        validateProductAction({
          type: "mistake.correct",
          id: "mistake-1",
          patch: { [key]: "replacement" },
          reason: "تصحيح",
        }),
      );
    },
  );
  it("keeps unknown observations nullable instead of coercing them to zero or false", () => {
    const action = { type: "mistake.add", draft: draft() };
    validateProductAction(action);
    expect(action.draft.selfCorrected).toBeNull();
    expect(action.draft.assistanceUsed).toBeNull();
    rejected(() =>
      validateProductAction({
        type: "mistake.add",
        draft: { ...draft(), selfCorrected: 0 },
      }),
    );
    rejected(() =>
      validateProductAction({
        type: "mistake.add",
        draft: { ...draft(), type: "invented" },
      }),
    );
    rejected(() =>
      validateProductAction({
        type: "mistake.correct",
        id: "mistake-1",
        patch: { note: "تصحيح" },
        reason: " ",
      }),
    );
  });
  it.each(["__proto__", "constructor", "prototype", "", "bad\nidentifier"])(
    "rejects reserved or invalid command identifiers %j",
    (commandId) =>
      rejected(() => validateProductAction({ type: "reset", commandId })),
  );
  it.each([
    "2026-11-05T10:00:00+03:00",
    "2026-11-05",
    "2026-02-30T10:00:00Z",
    "2026-11-05T25:00:00Z",
  ])("requires a real UTC timestamp %s", (now) =>
    rejected(() => validateProductAction({ type: "reset", now })),
  );
  it("validates local dates, revisions and range references before mutation", () => {
    rejected(() =>
      validateProductAction({
        type: "plan.todayBudget",
        minutes: 30,
        localDate: "2026-02-30",
      }),
    );
    rejected(() =>
      validateProductAction({ type: "reset", expectedRevision: -1 }),
    );
    rejected(() =>
      validateProductAction({ type: "reset", expectedRevision: NaN }),
    );
    rejected(() =>
      validateProductAction({
        type: "range.add",
        range: { ...range(), start: 3, end: 2 },
      }),
    );
    rejected(() =>
      validateProductAction({
        type: "range.add",
        range: { ...range(), kind: "page" },
      }),
    );
    rejected(() =>
      validateProductAction({
        type: "range.add",
        range: { ...range(), surah: 2 },
      }),
    );
    rejected(() =>
      validateProductAction({
        type: "range.add",
        range: { ...range(), id: "constructor" },
      }),
    );
  });
  it("validates blocked learning command shapes so service can reject them with CONTENT_UNAVAILABLE", () => {
    for (const type of [
      "session.pause",
      "session.repeat",
      "attempt.hint",
      "attempt.reveal",
    ])
      expect(() => validateProductAction({ type })).not.toThrow();
    expect(() =>
      validateProductAction({
        type: "session.start",
        kind: "new",
        rangeLabel: "نطاق",
      }),
    ).not.toThrow();
    rejected(() =>
      validateProductAction({
        type: "session.start",
        kind: "new",
        rangeLabel: "نطاق",
        mastery: 100,
      }),
    );
    rejected(() =>
      validateProductAction({
        type: "attempt.finish",
        termination: "invented",
      }),
    );
    rejected(() =>
      validateProductAction({
        type: "attempt.assess",
        input: {
          completion: "complete",
          errorObservation: "none",
          effort: "easy",
          effectiveRating: 4,
        },
      }),
    );
  });
});

describe("C01–C14 query runtime schemas", () => {
  const valid: Array<[ContractId, unknown]> = [
    ["C01", { operation: "read" }],
    ["C01", { operation: "resolve", range: range() }],
    ["C02", { operation: "read" }],
    [
      "C02",
      {
        operation: "save",
        config: config(),
        command: { commandId: "command-1", expectedRevision: 0 },
      },
    ],
    ["C03", { operation: "diagnostic", outsideReview: "unknown" }],
    ["C03", { operation: "gap" }],
    ["C03", { operation: "backlog" }],
    ["C04", { operation: "read", scenario: "normal", localDate: "2026-11-05" }],
    ["C04", { operation: "replan" }],
    ["C05", { operation: "read" }],
    ["C06", { operation: "read" }],
    ["C07", { operation: "read", attemptId: "attempt-1" }],
    ["C08", { operation: "read" }],
    ["C08", { operation: "read", attemptId: "attempt-1" }],
    ["C09", { operation: "read", range: range() }],
    ["C10", { operation: "forecast" }],
    ["C10", { operation: "preview", minutes: 0 }],
    ["C11", { operation: "read" }],
    ["C12", { operation: "inspect", serialized: "{}" }],
    ["C13", { operation: "read" }],
    ["C14", { operation: "read" }],
  ];
  it.each(valid)("accepts the declared %s operation %j", (id, input) =>
    expect(() => validateViewQuery(id, input)).not.toThrow(),
  );
  it.each(
    Array.from(
      { length: 14 },
      (_, i) => ("C" + String(i + 1).padStart(2, "0")) as ContractId,
    ),
  )("rejects unknown operations and unknown keys for %s", (id) => {
    rejected(() => validateViewQuery(id, { operation: "invented" }));
    rejected(() =>
      validateViewQuery(id, { operation: "read", injected: true }),
    );
    rejected(() => validateViewQuery(id, null));
  });
  it("rejects prototype fixture injection and nonfinite forecast inputs", () => {
    for (const scenario of ["capacity", "empty", "offline"])
      rejected(() => validateViewQuery("C04", { operation: "read", scenario }));
    rejected(() =>
      validateViewQuery("C04", { operation: "read", localDate: "2026-02-30" }),
    );
    for (const minutes of [NaN, Infinity, -1, 1441, 1.5, "60"])
      rejected(() =>
        validateViewQuery("C10", { operation: "preview", minutes }),
      );
  });
  it("requires identifiers and serialized text for the matching contracts", () => {
    rejected(() => validateViewQuery("C07", { operation: "read" }));
    rejected(() =>
      validateViewQuery("C07", { operation: "read", attemptId: "__proto__" }),
    );
    rejected(() =>
      validateViewQuery("C12", {
        operation: "inspect",
        serialized: { events: [] },
      }),
    );
    rejected(() =>
      validateViewQuery("C99" as ContractId, { operation: "read" }),
    );
    rejected(() =>
      validateViewQuery(
        "C09",
        Object.assign(Object.create({ range: range() }), { operation: "read" }),
      ),
    );
  });
});
