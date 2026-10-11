import { describe, expect, it } from "vitest";
import type { Action, PageSnapshot } from "@core";
import { adaptDecision } from "./decision";

const page: PageSnapshot = {
  url: "https://example.com",
  title: "Example",
  headings: [],
  text: "An ordinary page",
  selection: "",
  errors: [],
  successes: [],
  frames: { count: 0, inaccessible: 0 },
  capturedAt: 1,
  revision: 2,
  elements: ["e17", "e18"].map((id) => ({
    id,
    name: id,
    tag: "button",
    role: "button",
    disabled: false,
    sensitive: false,
    rect: { x: 0, y: 0, width: 20, height: 20 },
  })),
};
const flat = (fields: Record<string, unknown>) => adaptDecision(fields, page);

const actions: Action[] = [
  { type: "say", text: "A sourced answer" },
  { type: "point", target: "e17", quote: "Exact source words" },
  { type: "click", target: "e17", trusted: true },
  { type: "type", target: "e17", text: "An ordinary name" },
  { type: "select", target: "e17", value: "morning" },
  { type: "navigate", url: "https://example.com/next", newTab: true },
  { type: "key", key: "Escape", target: "e17" },
  { type: "scroll", target: "e17", amount: -200 },
  { type: "observe", target: "e17" },
  { type: "back" },
  { type: "switchTab", tabId: 15 },
  { type: "pointer", command: "drag", target: "e17", toTarget: "e18" },
  { type: "video", command: "seek", value: 35 },
  { type: "sketch", title: "An example", lines: ["2x = 6"],
    shapes: [{ type: "circle", x: 10, y: 20, radius: 5 }] },
  { type: "plan", goal: "Learn fractions", steps: ["Compare equal parts"] },
  { type: "ask", question: "Which date?" },
  { type: "note", text: "Workshop: $60", excerpt: "Pottery $60" },
  { type: "wait", ms: 250 },
  { type: "finish", summary: "Confirmed on the page" },
];

describe("provider decision boundary", () => {
  it.each(actions.map((action) => [action.type, action] as const))(
    "accepts canonical %s actions in flat and injected envelopes",
    (_type, action) => {
      const { type, ...fields } = action;
      expect(flat({ action: type, ...fields, say: "A short update.", done: false })).toEqual({
        action, say: "A short update.", done: false,
      });
      expect(adaptDecision({ action, say: null, done: true }, page)).toEqual({ action, done: true });
    },
  );
  it("allows unused nullable fields without mutating the provider output or supplying required fields", () => {
    const value = {
      action: "point", target: "e17", quote: null, text: null, say: null, done: false,
      reason: "A source-backed next step",
    };
    const before = structuredClone(value);
    expect(adaptDecision(value, page)).toEqual({ action: { type: "point", target: "e17" }, done: false });
    expect(value).toEqual(before);
    expect(() => flat({ action: "say", text: null, say: "An accompanying sentence" })).toThrow();
    expect(() => flat({ action: "ask", text: "Which date?" })).toThrow();
    expect(() => flat({ action: "sketch", text: "First line\nSecond line" })).toThrow();
  });
  it("validates envelope metadata and limits accompanying speech", () => {
    expect(flat({ action: "say", text: "Hello" }).done).toBe(false);
    expect(flat({ action: "say", text: "Hello", say: "a".repeat(1200) }).say).toHaveLength(1000);
    for (const fields of [{ say: 1 }, { done: "true" }, { done: null }]) {
      expect(() => flat({ action: "say", text: "Hello", ...fields })).toThrow();
    }
  });
  it.each(["x", "y", "toX", "toY"])(
    "rejects %s coordinates even alongside a valid observed target",
    (coordinate) => {
      expect(() => flat({ action: "click", target: "e17", [coordinate]: 1 })).toThrow();
      expect(() => adaptDecision({ action: { type: "click", target: "e17", [coordinate]: 1 } }, page)).toThrow();
      expect(() => adaptDecision({ action: { type: "click", target: "e17" }, [coordinate]: 1 }, page)).toThrow();
    },
  );
  it("checks both ends of a drag against the current observation", () => {
    for (const action of [
      { type: "click", target: "old" },
      { type: "pointer", command: "drag", target: "old", toTarget: "e18" },
      { type: "pointer", command: "drag", target: "e17", toTarget: "old" },
    ]) {
      const { type, ...fields } = action;
      expect(() => flat({ action: type, ...fields })).toThrow(/stale target/);
      expect(() => adaptDecision({ action }, page)).toThrow(/stale target/);
    }
    expect(() => flat({ action: "pointer", command: "drag", target: "e17" })).toThrow();
  });
  it("requires numeric seek positions and supported playback speeds in both envelopes", () => {
    for (const action of [
      { type: "video", command: "seek" },
      { type: "video", command: "seek", value: "6:40" },
      { type: "video", command: "seek", value: -10 },
      { type: "video", command: "speed" },
      { type: "video", command: "speed", value: 0.1 },
      { type: "video", command: "speed", value: 20 },
    ]) {
      const { type, ...fields } = action;
      expect(() => flat({ action: type, ...fields })).toThrow();
      expect(() => adaptDecision({ action }, page)).toThrow();
    }
    for (const value of [0.25, 4])
      expect(flat({ action: "video", command: "speed", value }).action).toEqual({ type: "video", command: "speed", value });
    expect(flat({ action: "video", command: "pause" }).action).toEqual({ type: "video", command: "pause" });
  });
  it("rejects malformed actions and unsupported target values before execution", () => {
    for (const value of [
      null,
      [],
      {},
      { action: "launch", target: "e17" },
      { action: "click", target: 17 },
      { action: "click", target: "e17", trusted: "yes" },
      { action: "wait", ms: 9000 },
      { action: "navigate", url: "javascript:alert(1)" },
      { action: "pointer", command: "tap", target: "e17" },
      { action: "sketch", title: "oops", lines: [], shapes: [{ type: "circle", x: "bad", y: 0 }] },
    ]) {
      expect(() => adaptDecision(value, page)).toThrow();
    }
  });
});
