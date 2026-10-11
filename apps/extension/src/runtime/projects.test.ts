// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  WorkspaceHost,
  type AgentReply,
  type AgentRequest,
  type BrowserTask,
  type PageSnapshot,
  type RuntimeEvent,
  type Settings,
  type TaskProgress,
} from "@core";
import { createCompanion } from "./index";
import type { CompanionRuntime, RuntimeApi } from "./types";

type Message = { type: string; [key: string]: unknown };
const milestones = ["Read the preparation guide", "Prepare the final checklist"];
const runtimes: CompanionRuntime[] = [];
const visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({
    matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) });
  document.body.innerHTML = '<h1>Preparation guide</h1><p id="progress">Read the preparation guide before writing a checklist.</p>';
});
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (visibility) Object.defineProperty(document, "visibilityState", visibility);
  else Reflect.deleteProperty(document, "visibilityState");
});

async function setup(options: {
  project?: boolean;
  settings?: Partial<Settings>;
  decide?: (input: AgentRequest, signal?: AbortSignal) => Promise<AgentReply>;
  assess?: (message: Message, signal?: AbortSignal) => Promise<unknown>;
} = {}) {
  let persisted: unknown;
  const workspace = new WorkspaceHost({
    load: async () => persisted,
    save: async (value) => { persisted = structuredClone(value); },
  });
  const settings = { ...DEFAULT_SETTINGS, reducedMotion: "on" as const, proactiveEnabled: false, ...options.settings };
  if (options.project) await workspace.start("Prepare a workshop project", 1,
    { url: location.href, title: document.title }, milestones);
  const active = async () => {
    const state = await workspace.snapshot();
    return state.tasks.find((task) => task.id === state.activeTaskId) ?? null;
  };
  let listener: ((event: RuntimeEvent) => void) | null = null;
  const request = vi.fn(async (message: Message, signal?: AbortSignal): Promise<unknown> => {
    if (message.type === "settings.get") return settings;
    if (message.type === "session.get") return { task: await active() };
    if (message.type === "workspace.get") return workspace.snapshot();
    if (message.type === "agent.decide") return options.decide?.(message.input as AgentRequest, signal) ?? {
      action: { type: "say", text: "Here is a short explanation of the visible guide." }, done: true, provider: "demo",
    };
    if (message.type === "task.start") return workspace.start(message.goal as string, 1,
      { url: location.href, title: document.title }, message.steps as string[]);
    if (message.type === "task.progress") {
      await workspace.progress(message as unknown as TaskProgress, 1);
      return { ok: true };
    }
    if (message.type === "task.intent") {
      await workspace.intent(message.taskId as string, 1, message.nextStep as string);
      return { ok: true };
    }
    if (message.type === "task.step.confirm") return workspace.completeStep({
      eventId: crypto.randomUUID(), taskId: message.taskId as string, stepId: message.stepId as string,
      source: "user", evidence: "The user confirmed completion.", url: location.href, title: document.title,
    }, 1);
    if (message.type === "task.assess") {
      if (options.assess) return options.assess(message, signal);
      const task = await active();
      return { task, assessment: { stepId: task?.steps.find((step) => step.status === "doing")?.id,
        completed: false, evidence: "" } };
    }
    if (message.type === "task.step.verify") return { task: await workspace.completeStep({
      eventId: message.assessmentId as string, taskId: message.taskId as string, stepId: message.stepId as string,
      source: "page", evidence: "Preparation guide completed.",
      url: (message.page as PageSnapshot).url, title: (message.page as PageSnapshot).title,
    }, 1) };
    return { ok: true };
  });
  const api: RuntimeApi = {
    request: request as RuntimeApi["request"],
    subscribe: (next) => { listener = next; return () => { listener = null; }; },
  };
  const host = document.createElement("div"); document.body.append(host);
  const runtime = createCompanion(host.attachShadow({ mode: "open" }), api);
  runtimes.push(runtime);
  await runtime.start();
  const calls = (type: string) => request.mock.calls.filter(([message]) => message.type === type);
  return { runtime, request, workspace, settings, active, calls, emit: (event: RuntimeEvent) => listener?.(event) };
}

describe("project orchestration through the public runtime", () => {
  it("keeps a personal reminder response out of the active project's intent and progress", async () => {
    const { runtime, calls, active } = await setup({ project: true, decide: async () => ({
      action: { type: "say", text: "I'll text you at 9 AM to open the guide." }, provider: "local", done: true, contextScope: "conversation",
    }) });
    const before = await active();
    await runtime.send("Remind me to open the guide at 9 AM");
    expect(calls("task.intent")).toHaveLength(0);
    expect(calls("task.progress")).toHaveLength(0);
    expect(await active()).toEqual(before);
    expect(runtime.getSnapshot().messages.at(-1)?.text).toContain("text you");
  });
  it("answers a one-off question without saving a project or starting passive assessment", async () => {
    const { runtime, workspace, calls } = await setup();
    await runtime.send("What does this guide mean?");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls("agent.decide")).toHaveLength(1);
    expect(calls("task.start")).toHaveLength(0);
    expect(calls("task.assess")).toHaveLength(0);
    expect((await workspace.snapshot()).tasks).toEqual([]);
    expect(runtime.getSnapshot().messages.at(-1)?.text).toContain("short explanation");
  });

  it("starts browser work immediately after saving a project, even if plan has done:true", async () => {
    const button = document.createElement("button"); button.textContent = "Read guide";
    button.onclick = () => { document.getElementById("progress")!.textContent = "Preparation guide opened."; };
    document.body.append(button);
    const { runtime, calls, workspace } = await setup({ decide: async (input) => {
      if (!input.task) return { action: { type: "plan", goal: "Prepare a workshop project", steps: milestones }, provider: "demo", done: true };
      if (!input.history.some((entry) => entry.action.type === "click"))
        return { action: { type: "click", target: input.page.elements.find((item) => item.name === "Read guide")!.id }, provider: "demo", done: true };
      return { action: { type: "say", text: "The guide is open; here is what it says." }, provider: "demo", done: true };
    } });
    const sending = runtime.send("First read the guide, then prepare a checklist for this project.");
    await vi.advanceTimersByTimeAsync(1500);
    await sending;
    expect(calls("task.start")).toHaveLength(1);
    expect(calls("task.start")[0][0]).toMatchObject({ steps: milestones, dispatch: false });
    expect(runtime.getSnapshot().task?.steps.map((step) => step.title)).toEqual(milestones);
    expect(calls("agent.decide")).toHaveLength(3);
    expect(document.getElementById("progress")!.textContent).toBe("Preparation guide opened.");
    expect(runtime.getSnapshot().messages.at(-1)?.text).toBe("The guide is open; here is what it says.");
    await runtime.send("Repeat the current step.");
    expect(calls("task.start")).toHaveLength(1);
    expect((await workspace.snapshot()).tasks).toHaveLength(1);
    expect(runtime.getSnapshot().task?.steps.map((step) => step.status)).toEqual(["doing", "todo"]);
  });

  it("honors explicit planning-only requests without browser work", async () => {
    const { runtime, calls } = await setup({ decide: async () => ({
      action: { type: "plan", goal: "A rewritten goal without the wait instruction", steps: milestones }, provider: "demo", done: false,
    }) });
    const goal = "First read the guide, then prepare a checklist. Just make a plan and wait for me.";
    await runtime.send(goal);
    expect(calls("agent.decide")).toHaveLength(1);
    expect(runtime.getSnapshot().task?.goal).toBe(goal);
    expect(runtime.getSnapshot().messages.at(-1)?.text).toBe(`Next: ${milestones[0]}`);
  });

  it("starts the next milestone when the user confirms the current one", async () => {
    const { runtime, calls } = await setup({ project: true, decide: async (input) => ({
      action: { type: "say", text: `Working on ${input.task!.steps.find((step) => step.status === "doing")!.title}.` },
      provider: "demo", done: true,
    }) });
    await runtime.send("done step 1");
    expect(calls("agent.decide")).toHaveLength(1);
    expect((calls("agent.decide")[0][0].input as AgentRequest).task!.steps.map((step) => step.status)).toEqual(["done", "doing"]);
    expect(runtime.getSnapshot().messages.at(-1)?.text).toBe(`Working on ${milestones[1]}.`);
  });

  it("uses browse mode for a laptop comparison and configuration project with Learning enabled", async () => {
    const { runtime, calls } = await setup({ settings: { learningEnabled: true } });
    await runtime.send("Compare three laptops under $900, then help me configure the best one.");
    expect((calls("agent.decide")[0][0].input as AgentRequest).mode).toBe("browse");
  });

  it("keeps a learning plan in learning storage instead of creating a browser project", async () => {
    const { runtime, calls, workspace } = await setup({ settings: { learningEnabled: true }, decide: async () => ({
      action: { type: "plan", goal: "Learn fractions", steps: ["Understand equivalent fractions", "Practice comparisons"] },
      provider: "demo", done: true,
    }) });
    await runtime.send("Make a learning plan for fractions.");
    expect((calls("agent.decide")[0][0].input as AgentRequest).mode).toBe("learn");
    expect(calls("learn.plan")).toHaveLength(1);
    expect(calls("task.start")).toHaveLength(0);
    expect(runtime.getSnapshot().learning.plan).toEqual(["Understand equivalent fractions", "Practice comparisons"]);
    expect((await workspace.snapshot()).tasks).toEqual([]);
  });

  it("restores an owner project from the session and observes without replaying actions", async () => {
    const { runtime, active, calls } = await setup({ project: true });
    expect(runtime.getSnapshot().task?.id).toBe((await active())!.id);
    expect(calls("agent.decide")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1100);
    expect(calls("task.assess")).toHaveLength(1);
    expect(calls("agent.decide")).toHaveLength(0);
    expect(calls("task.step.verify")).toHaveLength(0);
  });

  it("accepts an explicit current-step acknowledgement and rejects another step number", async () => {
    const { runtime, calls } = await setup({ project: true });
    const firstId = runtime.getSnapshot().task!.steps[0]!.id;
    await runtime.send("done step 2");
    expect(calls("task.step.confirm")).toHaveLength(0);
    await runtime.send("done step 1");
    expect(calls("task.step.confirm")[0][0]).toMatchObject({ stepId: firstId });
    expect(runtime.getSnapshot().task?.steps.map((step) => step.status)).toEqual(["done", "doing"]);
    await runtime.send("completed the first step");
    expect(calls("task.step.confirm")).toHaveLength(1);
    await runtime.send("done");
    expect(calls("task.step.confirm")).toHaveLength(2);
    expect(runtime.getSnapshot().task?.status).toBe("completed");
    expect(runtime.getSnapshot().messages.at(-1)?.text).toBe("✓ Project complete.");
  });

  it("assesses changed visible text while ignoring repeated style and animation mutations", async () => {
    const { calls } = await setup({ project: true });
    await vi.advanceTimersByTimeAsync(1100);
    expect(calls("task.assess")).toHaveLength(1);
    document.querySelector("h1")!.className = "animation-frame-1";
    document.querySelector("h1")!.setAttribute("style", "transform:translateX(1px)");
    await vi.advanceTimersByTimeAsync(6000);
    expect(calls("task.assess")).toHaveLength(1);
    document.getElementById("progress")!.textContent = "The guide now includes a new preparation instruction.";
    await vi.advanceTimersByTimeAsync(5200);
    expect(calls("task.assess")).toHaveLength(2);
  });

  it("commits a page milestone only after its staged proof passes a fresh observation", async () => {
    document.getElementById("progress")!.textContent = "Preparation guide completed.";
    const { runtime, calls } = await setup({ project: true, assess: async (message) => ({
      assessmentId: message.requestId,
      assessment: { stepId: runtime.getSnapshot().task!.steps[0]!.id,
        completed: true, evidence: "Preparation guide completed." },
    }) });
    await vi.advanceTimersByTimeAsync(1100);
    expect(calls("task.step.verify")).toHaveLength(1);
    expect(runtime.getSnapshot().task?.steps.map((step) => step.status)).toEqual(["done", "doing"]);
    expect(runtime.getSnapshot().messages.some((message) => message.text.includes(`Next: ${milestones[1]}`))).toBe(true);
    expect(calls("agent.decide")).toHaveLength(1);
    expect((calls("agent.decide")[0][0].input as AgentRequest).task!.steps[1].status).toBe("doing");
  });

  it("drops late completion evidence when the visible page changes during inference", async () => {
    document.getElementById("progress")!.textContent = "Preparation guide completed.";
    let finish!: (value: unknown) => void;
    const { runtime, calls } = await setup({ project: true, assess: () => new Promise((resolve) => { finish = resolve; }) });
    await vi.advanceTimersByTimeAsync(1100);
    const stepId = runtime.getSnapshot().task!.steps[0]!.id;
    document.getElementById("progress")!.textContent = "A different preparation task has replaced the old guide.";
    await vi.advanceTimersByTimeAsync(300);
    finish({ assessmentId: "stale-proof", assessment: { stepId, completed: true, evidence: "Preparation guide completed." } });
    await vi.advanceTimersByTimeAsync(1);
    expect(calls("task.step.verify")).toHaveLength(0);
    expect(runtime.getSnapshot().task?.steps[0]!.status).toBe("doing");
  });

  it.each(["hidden", "paused"])("cancels in-flight page assessment when the project becomes %s", async (condition) => {
    let finish!: (value: unknown) => void;
    let signal: AbortSignal | undefined;
    const { runtime, calls, settings } = await setup({ project: true, assess: (_message, currentSignal) => {
      signal = currentSignal;
      return new Promise((resolve) => { finish = resolve; });
    } });
    await vi.advanceTimersByTimeAsync(1100);
    const stepId = runtime.getSnapshot().task!.steps[0]!.id;
    if (condition === "hidden") {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    } else runtime.setSettings({ ...settings, hiddenOnHosts: [location.hostname] });
    expect(signal?.aborted).toBe(true);
    finish({ assessmentId: "cancelled-proof", assessment: { stepId, completed: true, evidence: "Preparation guide completed." } });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls("task.assess")).toHaveLength(1);
    expect(calls("task.step.verify")).toHaveLength(0);
    expect(runtime.getSnapshot().task?.steps[0]!.status).toBe("doing");
  });
});
