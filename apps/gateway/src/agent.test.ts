import { describe, expect, it, vi } from "vitest";
import type { AgentRequest, PageTarget } from "@core";
import { decide, demoDecision } from "./agent";
import type { Providers } from "./providers";
const target = (id: string, name: string, value?: string): PageTarget => ({
  id,
  name,
  value,
  role: value === undefined ? "button" : "textbox",
  tag: value === undefined ? "button" : "input",
  disabled: false,
  sensitive: false,
  rect: { x: 10, y: 10, width: 100, height: 30 },
});
const input = (
  path = "",
  message = "find a beginner workshop under $75, compare two options, prepare registration",
): AgentRequest => ({
  requestId: "test",
  goal: message,
  message,
  history: [],
  mode: "browse",
  page: {
    url: `http://127.0.0.1:8787/demo/workshops/${path}`,
    title: "Workshops",
    text: "Pottery Basics $60. Printmaking $70. Both beginner workshops.",
    elements: [target("compare", "Compare workshops")],
    headings: [],
    errors: [],
    successes: [],
    selection: "",
    frames: { count: 0, inaccessible: 0 },
    capturedAt: Date.now(),
    revision: 1,
  },
});
describe("explicit demonstration intent", () => {
  it("keeps summarize and point requests read-only even with an active registration goal", () => {
    const summary = input("register.html");
    summary.message = "summarize this page";
    expect(demoDecision(summary).action.type).toBe("say");
    const point = input();
    point.message = "where is Compare workshops";
    expect(demoDecision(point).action).toEqual({ type: "point", target: "compare" });
  });
  it("compares from the source before choosing, saves notes, then prepares known sample fields", () => {
    const comparison = input("compare.html");
    comparison.page.elements = [target("pottery", "Choose Pottery Basics")];
    const note = demoDecision(comparison).action;
    expect(note).toMatchObject({ type: "note", excerpt: comparison.page.text });
    comparison.history = [
      { action: note, result: { ok: true, changed: true, message: "Saved" }, at: Date.now() },
    ];
    expect(demoDecision(comparison).action).toEqual({ type: "click", target: "pottery" });
    const registration = input("register.html");
    registration.page.elements = [
      target("name", "Full name", ""),
      target("email", "Email", ""),
      target("submit", "Submit registration"),
    ];
    expect(demoDecision(registration).action).toEqual({
      type: "type",
      target: "name",
      text: "Alex Morgan",
    });
    registration.page.elements[0].value = "Alex Morgan";
    registration.page.elements[1].value = "alex@example.com";
    expect(demoDecision(registration).action).toEqual({ type: "click", target: "submit" });
  });
  it("does not turn a comparison-only task into registration", () => {
    const comparison = input("compare.html", "compare beginner workshops under $75");
    comparison.history = [
      {
        action: { type: "note", text: "Workshop comparison: sources" },
        result: { ok: true, changed: true, message: "Saved" },
        at: Date.now(),
      },
    ];
    expect(demoDecision(comparison).action.type).toBe("finish");
  });
  it("increases learning support across requested hint rungs without solving the user's problem", () => {
    const request = input();
    request.mode = "learn";
    request.goal = "Solve 3x + 7 = 22";
    request.page.text = "Solve 3x + 7 = 22";
    const hints = [1, 2, 3, 4].map((rung) => {
      request.message = `Learning support rung ${rung} of 4: give the next hint`;
      const action = demoDecision(request).action;
      expect(action.type).toBe("say");
      return action.type === "say" ? action.text : "";
    });
    expect(new Set(hints).size).toBe(4);
    expect(hints[2]).toContain("2y + 4 = 10");
    expect(hints.join(" ")).not.toContain("x = 5");
  });
});
it("rejects malformed or stale provider actions before a browser can execute them", async () => {
  const providers = {
    provider: "openai",
    json: vi.fn(async () => ({ action: { type: "click", target: "missing" } })),
  } as unknown as Providers;
  await expect(
    decide(input(), providers, false, new AbortController().signal),
  ).rejects.toMatchObject({ code: "stale_target" });
  (providers.json as ReturnType<typeof vi.fn>).mockResolvedValue({
    action: {
      type: "sketch",
      title: "oops",
      lines: [],
      shapes: [{ type: "circle", x: "bad", y: 0 }],
    },
  });
  await expect(
    decide(input(), providers, false, new AbortController().signal),
  ).rejects.toMatchObject({ code: "invalid_provider_output" });
});
it("adapts flat provider decisions and keeps explicit screenshots outside textual history", async () => {
  const providers = {
    provider: "openai",
    json: vi.fn(async () => ({
      action: "click",
      target: "compare",
      say: "Opening the comparison.",
      done: false,
    })),
  } as unknown as Providers;
  const request = { ...input(), screenshot: "data:image/png;base64,YQ==" };
  const signal = new AbortController().signal;
  await expect(decide(request, providers, false, signal)).resolves.toEqual({
    action: { type: "click", target: "compare" },
    say: "Opening the comparison.",
    done: false,
    provider: "openai",
  });
  const [, context, usedSignal, image] = (providers.json as ReturnType<typeof vi.fn>).mock.calls[0];
  expect(context).not.toHaveProperty("screenshot");
  expect(usedSignal).toBe(signal);
  expect(image).toBe(request.screenshot);
});
