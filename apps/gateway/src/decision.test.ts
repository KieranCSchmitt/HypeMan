import { describe, expect, it } from "vitest";
import type { PageSnapshot } from "@core";
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
  elements: ["e17", "e18", "7"].map((id) => ({
    id,
    name: id,
    tag: "button",
    role: "button",
    disabled: false,
    sensitive: false,
    rect: { x: 0, y: 0, width: 20, height: 20 },
  })),
  video: { id: "video", title: "Lesson", time: 40, duration: 600, paused: true, rate: 1 },
};
const original = {
  say: null,
  elementId: null,
  text: null,
  url: null,
  direction: null,
  amount: null,
  value: null,
  quote: null,
  line: null,
  tabId: null,
  x: null,
  y: null,
  toElementId: null,
  toX: null,
  toY: null,
  trusted: null,
  pendingAction: null,
  taskType: null,
  reason: "A verified next step",
  done: false,
};
const flat = (raw: Record<string, unknown>) => adaptDecision({ ...original, ...raw }, page);

describe("flat provider decision boundary", () => {
  it("normalizes the nullable original envelope without leaking model fields internally", () => {
    expect(flat({ action: "click", elementId: 7, trusted: true, say: "Opening it." })).toEqual({
      action: { type: "click", target: "7", trusted: true },
      say: "Opening it.",
      done: false,
    });
    expect(
      flat({ action: "point_to", elementId: "e17", quote: "exact source words" }).action,
    ).toEqual({ type: "point", target: "e17", quote: "exact source words" });
    expect(flat({ action: "type", elementId: "e17", text: "An ordinary name" }).action).toEqual({
      type: "type",
      target: "e17",
      text: "An ordinary name",
    });
    expect(flat({ action: "clear", elementId: "e17" }).action).toEqual({
      type: "type",
      target: "e17",
      text: "",
    });
    expect(flat({ action: "select", elementId: "e17", value: "morning" }).action).toEqual({
      type: "select",
      target: "e17",
      value: "morning",
    });
  });
  it("supports flat typed names for every action family", () => {
    const cases: [Record<string, unknown>, Record<string, unknown>][] = [
      [
        { action: "say", text: "A sourced answer" },
        { type: "say", text: "A sourced answer" },
      ],
      [
        { action: "navigate", url: "https://example.com/next", newTab: true },
        { type: "navigate", url: "https://example.com/next", newTab: true },
      ],
      [
        { action: "key", key: "Escape", target: "e17" },
        { type: "key", key: "Escape", target: "e17" },
      ],
      [
        { action: "scroll", target: "e17", amount: -200 },
        { type: "scroll", target: "e17", amount: -200 },
      ],
      [
        { action: "observe", target: "e17" },
        { type: "observe", target: "e17" },
      ],
      [{ action: "back" }, { type: "back" }],
      [
        { action: "switchTab", tabId: 15 },
        { type: "switchTab", tabId: 15 },
      ],
      [
        { action: "pointer", command: "drag", target: "e17", toTarget: "e18" },
        { type: "pointer", command: "drag", target: "e17", toTarget: "e18" },
      ],
      [
        { action: "video", command: "seek", value: 35 },
        { type: "video", command: "seek", value: 35 },
      ],
      [
        { action: "sketch", title: "An example", lines: ["2x = 6"] },
        { type: "sketch", title: "An example", lines: ["2x = 6"] },
      ],
      [
        { action: "plan", goal: "Learn fractions", steps: ["Compare equal parts"] },
        { type: "plan", goal: "Learn fractions", steps: ["Compare equal parts"] },
      ],
      [
        { action: "ask", question: "Which date?" },
        { type: "ask", question: "Which date?" },
      ],
      [
        { action: "note", text: "Workshop: $60", excerpt: "Pottery $60" },
        { type: "note", text: "Workshop: $60", excerpt: "Pottery $60" },
      ],
      [
        { action: "wait", ms: 250 },
        { type: "wait", ms: 250 },
      ],
      [
        { action: "finish", summary: "Confirmed on the page" },
        { type: "finish", summary: "Confirmed on the page" },
      ],
    ];
    for (const [input, output] of cases) expect(flat(input).action).toEqual(output);
  });
  it("maps legacy navigation, pointer and keyboard names explicitly", () => {
    expect(flat({ action: "open_tab", url: "https://example.com/next" }).action).toEqual({
      type: "navigate",
      url: "https://example.com/next",
      newTab: true,
    });
    expect(flat({ action: "go_back" }).action).toEqual({ type: "back" });
    expect(flat({ action: "press_enter", elementId: "e17" }).action).toEqual({
      type: "key",
      key: "Enter",
      target: "e17",
    });
    expect(flat({ action: "press_key", text: "Control+a", elementId: "e17" }).action).toEqual({
      type: "key",
      key: "Control+a",
      target: "e17",
    });
    expect(flat({ action: "scroll", direction: "up", amount: 200 }).action).toEqual({
      type: "scroll",
      amount: -200,
    });
    expect(flat({ action: "scroll", direction: "up" }).action).toEqual({
      type: "scroll",
      amount: -500,
    });
    expect(flat({ action: "drag", elementId: "e17", toElementId: "e18" }).action).toEqual({
      type: "pointer",
      command: "drag",
      target: "e17",
      toTarget: "e18",
    });
    expect(flat({ action: "look_up", text: "beginner pottery & workshops" }).action).toEqual({
      type: "navigate",
      url: "https://www.google.com/search?q=beginner%20pottery%20%26%20workshops",
      newTab: true,
    });
  });
  it("converts legacy video timecodes and relative seeks using observed video time", () => {
    expect(flat({ action: "video", value: "seek", text: "6:40" }).action).toEqual({
      type: "video",
      command: "seek",
      value: 400,
    });
    expect(flat({ action: "video", value: "seek", text: "+10" }).action).toEqual({
      type: "video",
      command: "seek",
      value: 50,
    });
    expect(flat({ action: "video", value: "speed", text: "0.75" }).action).toEqual({
      type: "video",
      command: "speed",
      value: 0.75,
    });
    expect(() => flat({ action: "video", value: "seek", text: "1:90" })).toThrow();
    expect(() => flat({ action: "video", command: "speed", value: 20 })).toThrow();
  });
  it("keeps legacy confirmation questions inert and accepts canonical injected adapters", () => {
    expect(
      flat({
        action: "ask_confirmation",
        text: "Submit this registration?",
        pendingAction: { action: "click", elementId: "e17" },
      }).action,
    ).toEqual({ type: "ask", question: "Submit this registration?" });
    expect(
      adaptDecision(
        { action: { type: "ask", question: "Which workshop?" }, done: true, say: "Your choice." },
        page,
      ),
    ).toEqual({
      action: { type: "ask", question: "Which workshop?" },
      done: true,
      say: "Your choice.",
    });
    expect(flat({ action: "sketch", text: "First line\nSecond line" }).action).toEqual({
      type: "sketch",
      title: "HypeMan sketch",
      lines: ["First line", "Second line"],
    });
  });
  it("rejects unknown, malformed, coordinate and stale outputs before execution", () => {
    for (const input of [
      null,
      [],
      { action: "focus", elementId: "e17" },
      { action: "click", elementId: "e17", trusted: "yes" },
      { action: "click", x: 1, y: 2 },
      { action: "wait", amount: 9000 },
      { action: "navigate", url: "javascript:alert(1)" },
      { action: "sketch", text: "erase all", value: "erase" },
      { action: "say", text: "Hello", done: "true" },
    ]) {
      expect(() => adaptDecision(input, page)).toThrow();
    }
    expect(() => flat({ action: "click", elementId: 17 })).toThrow(/stale target/);
    expect(() => flat({ action: "drag", elementId: "e17", toElementId: "old" })).toThrow(
      /stale target/,
    );
    expect(() =>
      adaptDecision(
        { action: { type: "pointer", command: "drag", target: "e17", toTarget: "old" } },
        page,
      ),
    ).toThrow(/stale target/);
  });
});
