// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, focusAgentContext, type AgentReply, type AgentRequest, type HistoryEntry, type RuntimeEvent, type SessionHandoff } from "@core";
import { createCompanion } from "./index";
import type { RuntimeApi } from "./types";

const controllers: ReturnType<typeof createCompanion>[] = [];
beforeEach(() => {
  document.body.innerHTML = "<h1>Workshop registration</h1>";
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) });
});
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); });

async function setup(decide: (input: AgentRequest, signal?: AbortSignal) => Promise<AgentReply>,
  extra?: (message: { type: string; [key: string]: unknown }) => unknown) {
  let listener: ((event: RuntimeEvent) => void) | null = null;
  const request = vi.fn(async (message: { type: string; [key: string]: unknown }, signal?: AbortSignal): Promise<unknown> => {
    const custom = extra?.(message);
    if (custom !== undefined) return custom;
    if (message.type === "settings.get") return { ...DEFAULT_SETTINGS, proactiveEnabled: false, reducedMotion: "on" };
    if (message.type === "session.get") return {};
    if (message.type === "agent.decide") return decide(message.input as AgentRequest, signal);
    return { ok: true };
  });
  const api: RuntimeApi = { request: request as RuntimeApi["request"], subscribe: (next) => {
    listener = next; return () => { listener = null; };
  } };
  const host = document.createElement("div"); document.body.append(host);
  const controller = createCompanion(host.attachShadow({ mode: "open" }), api);
  controllers.push(controller);
  controller.setConversationId?.("qa-chat");
  await controller.start();
  return { controller, request, emit: (event: RuntimeEvent) => listener?.(event) };
}
const decisions = (request: Awaited<ReturnType<typeof setup>>["request"]) =>
  request.mock.calls.filter(([message]) => message.type === "agent.decide");
const stoppedMessages = (controller: ReturnType<typeof createCompanion>) =>
  controller.getSnapshot().messages.filter(({ role, text }) => role === "status" && text === "Stopped this request.");

describe("explicit cancellation receipts", () => {
  it("adds one visible Stop marker and ignores a late model reply", async () => {
    let resolve!: (reply: AgentReply) => void;
    let providerSignal: AbortSignal | undefined;
    const { controller, request } = await setup(async (_input, signal) => {
      providerSignal = signal;
      return new Promise((done) => { resolve = done; });
    });
    const pending = controller.send("Find a workshop");
    await vi.waitFor(() => expect(resolve).toBeDefined());
    controller.stop();
    expect(providerSignal?.aborted).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ phase: "idle", status: "Stopped. Ready when you are." });
    expect(stoppedMessages(controller)).toHaveLength(1);
    expect(request.mock.calls.some(([message]) => message.type === "conversation.cancel-pending" && message.markerAlreadyWritten === true)).toBe(true);
    controller.stop();
    expect(stoppedMessages(controller)).toHaveLength(1);
    expect(request.mock.calls.filter(([message]) => message.type === "conversation.cancel-pending")).toHaveLength(1);
    resolve({ action: { type: "say", text: "Still working on it" }, provider: "demo" });
    await pending;
    expect(controller.getSnapshot().messages.at(-1)?.text).toBe("Stopped this request.");
  });

  it.each(["Cancel", "Stop"])("preserves a declined submission for an immediate follow-up after %s", async (cancel) => {
    document.body.innerHTML = '<form><label>Name<input value="Alex"></label><button>Register now</button></form>';
    const submitted = vi.fn((event: Event) => event.preventDefault());
    document.querySelector("form")!.addEventListener("submit", submitted);
    const { controller, request } = await setup(async (input) => input.message.includes("did you") ? ({
      action: { type: "say", text: input.history.some(({ result }) => result.error === "cancelled")
        ? "The pending registration was cancelled before execution. Your name is still filled in."
        : "I cannot tell whether registration was submitted." }, provider: "demo",
    }) : ({ action: { type: "click", target: input.page.elements.find(({ name }) => name === "Register now")!.id }, provider: "demo" }));
    const pending = controller.send("Register me for the workshop");
    await vi.waitFor(() => expect(controller.getSnapshot().confirmation).not.toBeNull());
    if (cancel === "Cancel") controller.confirm(false); else controller.stop();
    // Do not wait for the original run: this is the race that used to lose the receipt.
    await controller.send("did you submit it or just fill it in?");
    await pending;
    expect(submitted).not.toHaveBeenCalled();
    expect(document.querySelector("input")!.value).toBe("Alex");
    const followup = decisions(request).at(-1)![0].input as AgentRequest;
    expect(followup.history).toContainEqual(expect.objectContaining({
      action: expect.objectContaining({ type: "click" }),
      result: expect.objectContaining({ ok: false, changed: false, error: "cancelled", message: expect.stringContaining("before execution") }),
    }));
    expect(controller.getSnapshot().messages.at(-1)?.text).toContain("cancelled before execution");
    expect(controller.getSnapshot().messages.filter(({ text }) => text === "Action cancelled before execution.")).toHaveLength(cancel === "Cancel" ? 1 : 0);
  });

  it.each(["replacement request", "conversation switch"])("silently supersedes pending work on %s without a cancellation receipt", async (supersession) => {
    document.body.innerHTML = "<button>Register now</button>";
    const clicked = vi.fn(); document.querySelector("button")!.addEventListener("click", clicked);
    const { controller, request } = await setup(async (input) => input.message === "Read the title" ? ({
      action: { type: "say", text: "Workshop registration" }, provider: "demo",
    }) : ({ action: { type: "click", target: input.page.elements[0].id }, provider: "demo" }));
    const pending = controller.send("Register me");
    await vi.waitFor(() => expect(controller.getSnapshot().confirmation).not.toBeNull());
    let markerObserved = false;
    const unsubscribe = controller.subscribe(() => { markerObserved ||= stoppedMessages(controller).length > 0; });
    if (supersession === "conversation switch") controller.setConversationId?.("new-chat");
    await controller.send("Read the title"); await pending;
    unsubscribe();
    expect(clicked).not.toHaveBeenCalled();
    expect(markerObserved).toBe(false);
    expect(stoppedMessages(controller)).toHaveLength(0);
    expect(controller.getSnapshot().messages.some(({ text }) => text === "Action cancelled before execution.")).toBe(false);
    expect((decisions(request).at(-1)![0].input as AgentRequest).history).toEqual([]);
    expect(request.mock.calls.some(([message]) => message.type === "conversation.cancel-pending")).toBe(false);
  });

  it("does not inherit a stale cancellation after a later approved execution of that action", async () => {
    document.body.innerHTML = '<button>Register now</button><p id="result"></p>';
    document.querySelector("button")!.addEventListener("click", () => { document.getElementById("result")!.textContent = "Registration confirmed"; });
    const { controller, request } = await setup(async (input) => input.message.includes("status") || input.page.text.includes("Registration confirmed") ? ({
      action: { type: "say", text: "Registration confirmed" }, provider: "demo",
    }) : ({ action: { type: "click", target: input.page.elements[0].id }, provider: "demo" }));
    const cancelled = controller.send("Register me");
    await vi.waitFor(() => expect(controller.getSnapshot().confirmation).not.toBeNull());
    controller.confirm(false); await cancelled;
    const retried = controller.send("Try registering again");
    await vi.waitFor(() => expect(controller.getSnapshot().confirmation).not.toBeNull());
    controller.confirm(true); await retried;
    await controller.send("What is the status?");
    expect((decisions(request).at(-1)![0].input as AgentRequest).history.some(({ result }) => result.error === "cancelled")).toBe(false);
    expect(document.getElementById("result")!.textContent).toBe("Registration confirmed");
  });
});

describe("conversation activity ownership", () => {
  it.each(["empty", "cancelled"])("keeps destination context for a casual retry dispatched with %s history", async (prior) => {
    document.body.innerHTML = '<h1>Review labels</h1><form method="post"><label>Second review label<input></label><button>Submit label</button></form>';
    const submitted = vi.fn((event: Event) => event.preventDefault());
    document.querySelector("form")!.addEventListener("submit", submitted);
    const focused: AgentRequest[] = [];
    const prompt = "Try the second review label again and use retry-ready. Do not submit anything.";
    const history: HistoryEntry[] = prior === "empty" ? [] : [{ action: { type: "click", target: "old-submit" },
      result: { ok: false, changed: false, error: "cancelled", message: "Action cancelled before execution", url: location.href }, at: Date.now() }];
    const { controller, request, emit } = await setup(async (input) => {
      const context = focusAgentContext(input); focused.push(context);
      if (input.message === "What is inertia?") return { action: { type: "say", text: "Resistance to changes in motion." }, provider: "demo" };
      const target = context.page.elements.find(({ tag }) => tag === "input");
      if (target && document.querySelector("input")!.value !== "retry-ready")
        return { action: { type: "type", target: target.id, text: "retry-ready" }, provider: "demo" };
      return { action: { type: "say", text: target ? "The second review label is ready." : "I cannot see that field." }, provider: "demo" };
    });
    emit({ type: "assistant.run", goal: prompt, handoff: {
      conversationId: "qa-chat", runId: "retry-run", goal: prompt, message: prompt,
      history: history.map((entry) => ({ ...entry, result: { ...entry.result } })), step: 0, at: Date.now(),
    } });
    await vi.waitFor(() => expect(controller.getSnapshot().messages.at(-1)?.text).toBe("The second review label is ready."));
    expect(focused[0].contextScope).toBe("page");
    expect(focused[0].page.elements.some(({ tag }) => tag === "input")).toBe(true);
    expect(focused[0].history).toMatchObject([...history, { action: { type: "observe" }, result: {
      ok: true, changed: false, message: "Destination page observed after browser dispatch", url: location.href,
    } }]);
    expect(document.querySelector("input")!.value).toBe("retry-ready");
    expect(submitted).not.toHaveBeenCalled();
    expect(decisions(request).filter(([message]) => (message.input as AgentRequest).history.at(-1)?.action.type === "type")).toHaveLength(1);
    await controller.send("What is inertia?");
    expect(focused.at(-1)).toMatchObject({ contextScope: "conversation", history: [], page: { elements: [], text: "" } });
  });

  it.each(["click", "Enter"])("yields after an uncancelled native %s submission to the current URL", async (activation) => {
    document.body.innerHTML = '<form method="post"><input name="name" value="Alex"><button>Register now</button></form>';
    const form = document.querySelector("form")!;
    form.action = location.href;
    const button = document.querySelector("button")!;
    const submit = vi.fn(() => { form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: button })); });
    if (activation === "click") vi.spyOn(button, "click").mockImplementation(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); submit();
    });
    else vi.spyOn(form, "requestSubmit").mockImplementation(submit);
    const { controller, request } = await setup(async (input) => ({
      action: activation === "click" ? { type: "click", target: input.page.elements.find(({ name }) => name === "Register now")!.id }
        : { type: "key", target: input.page.elements.find(({ tag }) => tag === "input")!.id, key: "Enter" }, provider: "demo",
    }));
    const pending = controller.send("Submit my registration");
    await vi.waitFor(() => expect(controller.getSnapshot().confirmation).not.toBeNull());
    controller.confirm(true); await pending;
    expect(submit).toHaveBeenCalledOnce();
    expect(decisions(request)).toHaveLength(1);
    const saved = request.mock.calls.find(([message]) => message.type === "session.set" && message.handoff)![0].handoff as SessionHandoff;
    expect(saved.runId).toBe(decisions(request)[0][0].runId);
  });

  it("keeps an idle local Stop silent but sends an explicit typed Stop to remote work", async () => {
    const { controller, request } = await setup(async () => ({ action: { type: "say", text: "Unused" }, provider: "demo" }));
    controller.stop();
    expect(stoppedMessages(controller)).toHaveLength(0);
    expect(request.mock.calls.some(([message]) => message.type === "conversation.cancel-pending")).toBe(false);
    await controller.send("stop");
    expect(request.mock.calls.filter(([message]) => message.type === "conversation.cancel-pending").map(([message]) => message))
      .toEqual([{ type: "conversation.cancel-pending", conversationId: "qa-chat" }]);
    expect(decisions(request)).toHaveLength(0);
    expect(stoppedMessages(controller)).toHaveLength(0);
  });

  it("carries its active token into a navigation handoff before ending the source run", async () => {
    const { controller, request } = await setup(async () => ({
      action: { type: "navigate", url: "https://example.com/workshops", newTab: true }, provider: "demo",
    }));
    await controller.send("Open the workshop page in another tab");
    const runId = request.mock.calls.find(([message]) => message.type === "conversation.activity.start")![0].runId;
    const navigation = request.mock.calls.find(([message]) => message.type === "nav.navigate")![0];
    expect(navigation.handoff).toMatchObject({ conversationId: "qa-chat", runId, goal: "Open the workshop page in another tab" });
    expect(request.mock.calls.some(([message]) => message.type === "conversation.activity.end" && message.runId === runId)).toBe(true);
  });

  it("awaits activity ownership before deciding, reports held confirmation, and ends its token", async () => {
    document.body.innerHTML = "<button>Register now</button>";
    let start!: (result: unknown) => void;
    const { controller, request } = await setup(async (input) => ({
      action: { type: "click", target: input.page.elements[0].id }, provider: "demo",
    }), (message) => message.type === "conversation.activity.start" ? new Promise((resolve) => { start = resolve; }) : undefined);
    const pending = controller.send("Register me");
    await vi.waitFor(() => expect(start).toBeDefined());
    expect(decisions(request)).toHaveLength(0);
    const token = request.mock.calls.find(([message]) => message.type === "conversation.activity.start")![0].runId;
    start({ runId: token });
    await vi.waitFor(() => expect(controller.getSnapshot().confirmation).not.toBeNull());
    expect(decisions(request)[0][0].runId).toBe(token);
    const updates = request.mock.calls.filter(([message]) => message.type === "conversation.activity.update").map(([message]) => message);
    expect(updates).toContainEqual(expect.objectContaining({ runId: token, phase: "thinking" }));
    expect(updates).toContainEqual(expect.objectContaining({ runId: token, phase: "confirming" }));
    expect(new Set(updates.map(({ phase, status }) => `${phase}:${status}`)).size).toBe(updates.length);
    controller.confirm(false); await pending;
    expect(request.mock.calls.some(([message]) => message.type === "conversation.activity.end" && message.runId === token)).toBe(true);
  });

  it("rejects a stopped handoff token and lets the next user request start fresh", async () => {
    const { controller, request, emit } = await setup(async () => ({ action: { type: "say", text: "Fresh request" }, provider: "demo" }),
      (message) => message.type === "conversation.activity.start" && message.continuation === true ? null : undefined);
    const handoff: SessionHandoff = { conversationId: "qa-chat", runId: "stopped-run", goal: "Old errand", history: [], step: 1, at: Date.now() };
    emit({ type: "assistant.run", goal: handoff.goal, handoff });
    await vi.waitFor(() => expect(request.mock.calls.some(([message]) => message.type === "conversation.activity.end" && message.runId === "stopped-run")).toBe(true));
    expect(decisions(request)).toHaveLength(0);
    await controller.send("Read the new page");
    expect(decisions(request)).toHaveLength(1);
    const starts = request.mock.calls.filter(([message]) => message.type === "conversation.activity.start");
    expect(starts[0][0]).toMatchObject({ runId: "stopped-run", continuation: true });
    expect(starts[1][0]).toMatchObject({ continuation: false });
    expect(starts[1][0].runId).not.toBe("stopped-run");
  });

  it("resumes a paused checkpoint with a fresh activity token", async () => {
    const { controller, request, emit } = await setup(async () => ({ action: { type: "say", text: "Continued by request" }, provider: "demo" }));
    emit({ type: "assistant.run", goal: "Saved errand", handoff: {
      conversationId: "qa-chat", runId: "retired-run", goal: "Saved errand", history: [], step: 0, checkpoint: true, at: Date.now(),
    } });
    expect(decisions(request)).toHaveLength(0);
    await controller.send("Continue");
    const start = request.mock.calls.find(([message]) => message.type === "conversation.activity.start")![0];
    expect(start.continuation).toBe(false);
    expect(start.runId).not.toBe("retired-run");
    expect(decisions(request)).toHaveLength(1);
  });

  it("ignores remote Stop for an old token and cancels only its current run", async () => {
    let finish!: (reply: AgentReply) => void;
    let signal: AbortSignal | undefined;
    const { controller, request, emit } = await setup(async (_input, current) => {
      signal = current; return new Promise((resolve) => { finish = resolve; });
    });
    const pending = controller.send("Read the page");
    await vi.waitFor(() => expect(finish).toBeDefined());
    const runId = decisions(request)[0][0].runId;
    emit({ type: "assistant.stopped", conversationId: "qa-chat", runId: "old-run" });
    expect(signal?.aborted).toBe(false);
    emit({ type: "assistant.stopped", conversationId: "qa-chat", runId, markerAlreadyWritten: true });
    expect(signal?.aborted).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ phase: "idle", status: "Stopped. Ready when you are." });
    expect(stoppedMessages(controller)).toHaveLength(0);
    finish({ action: { type: "say", text: "Late answer" }, provider: "demo" }); await pending;
    expect(controller.getSnapshot().messages.some(({ text }) => text === "Late answer")).toBe(false);
    expect(request.mock.calls.some(([message]) => message.type === "conversation.cancel-pending")).toBe(false);
  });
});
