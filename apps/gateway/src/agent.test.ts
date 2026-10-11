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
    comparison.history = [{
      action: { type: "plan", goal: comparison.goal, steps: ["Compare workshops", "Prepare registration"] },
      result: { ok: true, changed: false, message: "Project planned" }, at: Date.now(),
    }];
    comparison.page.elements = [target("pottery", "Choose Pottery Basics")];
    const note = demoDecision(comparison).action;
    expect(note).toMatchObject({ type: "note", excerpt: comparison.page.text });
    comparison.history = [
      { action: note, result: { ok: true, changed: true, message: "Saved" }, at: Date.now() },
    ];
    expect(demoDecision(comparison).action).toEqual({ type: "click", target: "pottery" });
    const registration = input("register.html");
    registration.history = comparison.history;
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
  it("waits at meaningful project milestones before preparing or submitting", () => {
    const comparison = input("compare.html");
    comparison.task = {
      id: "workshop-project", goal: comparison.goal, status: "running",
      steps: [
        { id: "step-1", title: "Compare two beginner workshops under $75", status: "doing" },
        { id: "step-2", title: "Prepare registration for the chosen workshop", status: "todo" },
        { id: "step-3", title: "Review and confirm the registration", status: "todo" },
      ],
      lastPage: null, nextStep: "Compare two beginner workshops under $75", tabId: 1, createdAt: 1, updatedAt: 1,
    };
    comparison.history = [{ action: { type: "note", text: "Workshop comparison: fixture" },
      result: { ok: true, changed: true, message: "Saved" }, at: 1 }];
    expect(demoDecision(comparison).action.type).toBe("ask");
    const registration = input("register.html");
    registration.task = structuredClone(comparison.task);
    registration.task.steps[0].status = "done";
    registration.task.steps[1].status = "doing";
    registration.page.elements = [target("name", "Full name", "Alex Morgan"), target("email", "Email", "alex@example.com"), target("submit", "Submit registration")];
    expect(demoDecision(registration).action.type).toBe("ask");
    registration.task.steps[1].status = "done";
    registration.task.steps[2].status = "doing";
    expect(demoDecision(registration).action).toEqual({ type: "click", target: "submit" });
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
describe("project planning boundary", () => {
  it("plans real workshop outcomes once before browsing", () => {
    const request = input();
    const first = demoDecision(request);
    expect(first.action).toEqual({ type: "plan", goal: request.goal, steps: [
      "Compare two beginner workshops under $75",
      "Prepare registration for the chosen workshop",
      "Review and confirm the registration",
    ] });
    request.history = [{ action: first.action, result: { ok: true, changed: false, message: "Planned" }, at: 1 }];
    expect(demoDecision(request).action).toEqual({ type: "click", target: "compare" });
  });
  it("handles explicit non-learning projects even with learning preference enabled", () => {
    const request = input("", "Research source material then draft the report on Google Docs");
    request.mode = "learn";
    expect(demoDecision(request).action).toEqual({ type: "plan", goal: request.goal, steps: [
      "Research source material", "draft the report on Google Docs",
    ] });
  });
  it("leaves questions, explanations, single controls, and learning hints without projects", () => {
    for (const message of ["summarize this page", "where is Compare workshops", "click Compare workshops", "What is pottery?"]) {
      expect(demoDecision(input("", message)).action.type).not.toBe("plan");
    }
    const request = input("", "Learning support rung 1 of 4: give a hint");
    request.mode = "learn";
    expect(demoDecision(request).action.type).toBe("say");
  });
  it("does not turn repeated goals or internal browser work into milestone plans", async () => {
    const providers = { provider: "openai", json: vi.fn(async () => ({
      action: "plan", goal: "Open a page", steps: ["Understand the page", "Open the page", "Verify the result"], done: false,
    })) } as unknown as Providers;
    const reply = await decide(input("", "Open a page"), providers, false, new AbortController().signal);
    expect(reply.action.type).toBe("say");
    expect(providers.json).toHaveBeenCalledTimes(1);
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
