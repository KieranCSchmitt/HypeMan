// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type AgentReply, type AgentRequest, type RuntimeEvent, type SessionHandoff, type ToolAction } from "@core";
import { createCompanion } from "./index";
import type { CompanionRuntime, RuntimeApi } from "./types";

const runtimes: CompanionRuntime[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
});
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose(); vi.useRealTimers(); });

async function setup(decide: (input: AgentRequest) => AgentReply, handoff?: SessionHandoff) {
  const request = vi.fn(async (message: { type: string; [key: string]: unknown }) => {
    if (message.type === "settings.get") return { ...DEFAULT_SETTINGS, reducedMotion: "on", proactiveEnabled: false };
    if (message.type === "session.get") return { handoff };
    if (message.type === "workspace.get") return { tasks: [], notes: [], activeTaskId: null };
    if (message.type === "agent.decide") return decide(message.input as AgentRequest);
    return { ok: true };
  });
  const host = document.createElement("div"); document.body.append(host);
  let emit!: (event: RuntimeEvent) => void;
  const runtime = createCompanion(host.attachShadow({ mode: "open" }), { request, subscribe: (listener) => { emit = listener; return () => {}; } } as RuntimeApi);
  runtimes.push(runtime);
  const starting = runtime.start();
  await vi.advanceTimersByTimeAsync(250); await starting;
  return { runtime, request, emit, decisions: () => request.mock.calls.filter(([message]) => message.type === "agent.decide").map(([message]) => message.input as AgentRequest) };
}

describe("reliable bounded browser and tool outcomes", () => {
  it("feeds structured tool observations into the next decision and preserves the user's goal", async () => {
    const { runtime, decisions } = await setup((input) => input.history.length === 0
      ? { action: { type: "tool", tool: "notes", operation: "find", args: { query: "workshop" } }, done: false, provider: "demo" }
      : input.history.length === 1
        ? { action: { type: "tool", tool: "board", operation: "add", args: {} }, done: false, provider: "demo" }
        : { action: { type: "say", text: "Your comparison is sketched." }, done: true, provider: "demo" });
    const tool = vi.fn(async (action: ToolAction) => ({ message: `${action.tool} ready`, changed: action.tool === "board", data: { noteId: "source-42", price: 60 } }));
    runtime.setToolHandler?.(tool);
    await runtime.send("Find my workshop notes, then sketch the comparison.");
    expect(tool).toHaveBeenCalledTimes(2);
    expect(decisions()).toHaveLength(3);
    expect(decisions()[1].history[0].result.message).toContain('"noteId":"source-42"');
    expect(decisions().every((input) => input.goal === "Find my workshop notes, then sketch the comparison.")).toBe(true);
    expect(runtime.getSnapshot().messages.filter((message) => message.role === "assistant")).toHaveLength(1);
  });

  it("preserves a full 6k source for a chained save-and-send decision", async () => {
    const text = `${"Source passage. ".repeat(399)}The final sentence must survive.`;
    const { runtime, decisions } = await setup((input) => input.history.length
      ? { action: { type: "say", text: "The source is ready to send." }, done: true, provider: "demo" }
      : { action: { type: "tool", tool: "notes", operation: "find", args: { id: "note-full" } }, done: false, provider: "demo" });
    runtime.setToolHandler?.(async () => ({ message: "Note found.", changed: false, data: { notes: [{ id: "note-full", text, url: "https://example.com/source" }] } }));
    await runtime.send("Find my saved source and prepare to send its full text.");
    expect(decisions()[1].history[0].result.message).toContain("The final sentence must survive.");
    expect(decisions()[1].history[0].result.message).not.toContain('"truncated":true');
  });

  it("stops a tool chain at a user handoff and reports the actual failure", async () => {
    const { runtime, decisions } = await setup(() => ({ action: { type: "tool", tool: "documents", operation: "open", args: {} }, done: false, provider: "demo" }));
    runtime.setToolHandler?.(async () => ({ ok: false, message: "Choose a PDF to continue.", continue: false }));
    await runtime.send("Summarize a PDF, then save the key points.");
    expect(decisions()).toHaveLength(1);
    expect(runtime.getSnapshot().messages.at(-1)?.text).toBe("Choose a PDF to continue.");
  });

  it("honors an explicit completed response even when a tool permits continuation", async () => {
    const { runtime, decisions } = await setup(() => ({ action: { type: "tool", tool: "board", operation: "add", args: {} }, done: true, provider: "demo" }));
    const tool = vi.fn(async () => ({ message: "Sketch saved.", changed: true, continue: true, data: { artifactId: "board-1", revision: 2 } }));
    runtime.setToolHandler?.(tool);
    await runtime.send("Sketch a route through the workshops.");
    expect(tool).toHaveBeenCalledTimes(1);
    expect(decisions()).toHaveLength(1);
  });

  it("waits for the sketch persistence receipt instead of reporting an optimistic save", async () => {
    const { runtime } = await setup(() => ({ action: { type: "sketch", title: "Workshop route", lines: ["Compare", "Choose"] }, done: true, provider: "demo" }));
    let persist!: (value: { message: string; changed: boolean; data: { artifactId: string; revision: number } }) => void;
    const tool = vi.fn(() => new Promise<{ message: string; changed: boolean; data: { artifactId: string; revision: number } }>((resolve) => { persist = resolve; }));
    runtime.setToolHandler?.(tool);
    const sending = runtime.send("Sketch the route."); await vi.advanceTimersByTimeAsync(1);
    expect(tool).toHaveBeenCalledWith(expect.objectContaining({ tool: "board", operation: "add", args: { sketch: { type: "sketch", title: "Workshop route", lines: ["Compare", "Choose"] } } }));
    expect(runtime.getSnapshot().sketch).toBeNull();
    expect(runtime.getSnapshot().messages.some((message) => message.text === "Sketch saved.")).toBe(false);
    persist({ message: "Sketch saved.", changed: true, data: { artifactId: "board-1", revision: 2 } }); await sending;
    expect(runtime.getSnapshot().messages.at(-1)?.text).toBe("Sketch saved.");
  });

  it("retries a failed later step with earlier successful tool receipts intact", async () => {
    let failed = false;
    const { runtime, decisions } = await setup((input) => {
      if (!input.history.length) return { action: { type: "tool", tool: "notes", operation: "save", args: { text: "Workshop source" } }, done: false, provider: "demo" };
      if (!failed) { failed = true; throw new Error("Connection temporarily unavailable."); }
      return { action: { type: "tool", tool: "board", operation: "add", args: {} }, done: true, provider: "demo" };
    });
    const tool = vi.fn(async (action: ToolAction) => ({ message: `${action.tool} saved.`, changed: true, data: { id: `${action.tool}-1` } }));
    runtime.setToolHandler?.(tool);
    await runtime.send("Save the workshop source, then sketch its route.");
    expect(runtime.getSnapshot().phase).toBe("error");
    await runtime.retry?.();
    expect(tool.mock.calls.map(([action]) => action.tool)).toEqual(["notes", "board"]);
    expect(decisions().at(-1)?.history[0].action).toMatchObject({ tool: "notes", operation: "save" });
    expect(decisions().at(-1)?.message).toBe("Save the workshop source, then sketch its route.");
  });

  it("rejects an old Saved notice plus an unrelated changed click as registration success", async () => {
    document.body.innerHTML = '<button type="button">Expand details</button><p id="detail">Details hidden</p><p role="status">Saved successfully</p>';
    document.querySelector("button")!.onclick = () => { document.getElementById("detail")!.textContent = "Workshop details visible"; };
    let turn = 0;
    const { runtime } = await setup((input) => turn++ === 0
      ? { action: { type: "click", target: input.page.elements[0].id }, done: false, provider: "demo" }
      : { action: { type: "finish", summary: "Registration confirmed." }, done: true, provider: "demo" });
    const sending = runtime.send("Register for this workshop");
    await vi.advanceTimersByTimeAsync(2000); await sending;
    expect(runtime.getSnapshot().completionId).toBeUndefined();
    expect(runtime.getSnapshot().messages.at(-1)?.text).toContain("no verified completion");
  });

  it("keeps approval available after a minute and waits for a delayed matching confirmation", async () => {
    document.body.innerHTML = '<button>Submit registration</button><div id="result" role="status"></div>';
    document.querySelector("button")!.onclick = () => {
      document.getElementById("result")!.setAttribute("aria-busy", "true");
      setTimeout(() => { document.getElementById("result")!.textContent = "Registration confirmed"; document.getElementById("result")!.removeAttribute("aria-busy"); }, 650);
    };
    let turn = 0;
    const { runtime, decisions } = await setup((input) => turn++ === 0
      ? { action: { type: "click", target: input.page.elements[0].id }, done: false, provider: "demo" }
      : { action: { type: "finish", summary: "Registration confirmed." }, done: true, provider: "demo" });
    const sending = runtime.send("Register for this workshop");
    await vi.advanceTimersByTimeAsync(61_000);
    expect(runtime.getSnapshot().confirmation).not.toBeNull();
    expect(runtime.getSnapshot().confirmation?.label).toBe("Register");
    expect(document.getElementById("result")!.textContent).toBe("");
    runtime.confirm(true);
    await vi.advanceTimersByTimeAsync(2000); await sending;
    expect(decisions()[1].history[0].result.completion?.evidence).toBe("Registration confirmed");
    expect(runtime.getSnapshot().completionId).toBeTruthy();
  });

  it("does not finish the requested workshop when a fresh confirmation names a different workshop", async () => {
    document.body.innerHTML = '<h1>Pottery Basics</h1><button>Register now</button><div role="status"></div>';
    document.querySelector("button")!.onclick = () => { document.querySelector('[role="status"]')!.textContent = "Registration confirmed for Photography Workshop"; };
    let turn = 0;
    const { runtime, decisions } = await setup((input) => turn++ === 0
      ? { action: { type: "click", target: input.page.elements[0].id }, done: false, provider: "demo" }
      : { action: { type: "finish", summary: "Pottery Basics registration confirmed." }, done: true, provider: "demo" });
    const sending = runtime.send("Register for Pottery Basics");
    await vi.advanceTimersByTimeAsync(250); runtime.confirm(true);
    await vi.advanceTimersByTimeAsync(2000); await sending;
    expect(decisions()[1].history[0].result.completion).toBeUndefined();
    expect(runtime.getSnapshot().completionId).toBeUndefined();
    expect(runtime.getSnapshot().messages.at(-1)?.text).toContain("no verified completion");
  });

  it("does not substitute another outcome's fresh notice for the requested registration", async () => {
    document.body.innerHTML = '<button>Register now</button><div role="status"></div>';
    document.querySelector("button")!.onclick = () => { document.querySelector('[role="status"]')!.textContent = "Changes saved successfully"; };
    let turn = 0;
    const { runtime } = await setup((input) => turn++ === 0
      ? { action: { type: "click", target: input.page.elements[0].id }, done: false, provider: "demo" }
      : { action: { type: "finish", summary: "Registration confirmed." }, provider: "demo" });
    const sending = runtime.send("Register for this workshop"); await vi.advanceTimersByTimeAsync(1);
    runtime.confirm(true); await vi.advanceTimersByTimeAsync(2000); await sending;
    expect(runtime.getSnapshot().completionId).toBeUndefined();
  });

  it("resumes a slow destination with the user's latest choice intact", async () => {
    const { runtime, decisions } = await setup(() => ({ action: { type: "say", text: "Preparing Model B." }, done: true, provider: "demo" }), {
      goal: "Compare laptops and configure the chosen one", message: "Choose Model B with 16 GB", history: [], step: 4, at: Date.now() - 120_000,
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(decisions()).toHaveLength(1);
    expect(decisions()[0]).toMatchObject({ message: "Choose Model B with 16 GB", goal: "Compare laptops and configure the chosen one" });
    expect(runtime.getSnapshot().messages.at(-1)?.text).toBe("Preparing Model B.");
  });

  it("checkpoints repeated ineffective clicks and resumes only on explicit Continue", async () => {
    document.body.innerHTML = '<button type="button">Load results</button>';
    const clicked = vi.fn(); document.querySelector("button")!.onclick = clicked;
    let resume = false;
    const { runtime, request, decisions } = await setup((input) => resume
      ? { action: { type: "say", text: "The site is ready to retry." }, done: true, provider: "demo" }
      : { action: { type: "click", target: input.page.elements[0].id }, done: false, provider: "demo" });
    const sending = runtime.send("Load the workshop results"); await vi.advanceTimersByTimeAsync(4000); await sending;
    expect(clicked).toHaveBeenCalledTimes(2);
    const saved = request.mock.calls.find(([message]) => message.type === "session.set" && (message.handoff as SessionHandoff)?.checkpoint)?.[0].handoff as SessionHandoff;
    expect(saved).toMatchObject({ checkpoint: true, message: "Load the workshop results", step: 0 });
    expect(runtime.getSnapshot().status).toContain("Progress saved");
    resume = true; await runtime.send("Continue");
    expect(decisions().at(-1)?.message).toBe("Load the workshop results");
    expect(clicked).toHaveBeenCalledTimes(2);
  });

  it("retains a bounded action budget as an explicit resumable checkpoint", async () => {
    document.body.innerHTML = '<p id="result">Loading page 0</p>';
    let resume = false;
    let page = 0;
    const { runtime, decisions } = await setup(() => {
      if (resume) return { action: { type: "say", text: "Continuing the saved research." }, done: true, provider: "demo" };
      document.getElementById("result")!.textContent = `Loading page ${++page}`;
      return { action: { type: "observe" }, done: false, provider: "demo" };
    });
    await runtime.send("Research the workshop schedule");
    expect(decisions()).toHaveLength(36);
    expect(runtime.getSnapshot().status).toContain("Progress saved");
    resume = true; await runtime.send("Continue");
    expect(decisions().at(-1)?.goal).toBe("Research the workshop schedule");
  });

  it("checks the result and completes the shortlist after a filter action incorrectly says done", async () => {
    document.body.innerHTML = '<button type="button">Last 7 days</button><p id="results">All dates</p>';
    document.querySelector("button")!.onclick = () => { document.getElementById("results")!.textContent = "Last 7 days: Engineer A, posted 2 days ago; Engineer B, posted 4 days ago"; };
    const { runtime, decisions } = await setup((input) => !input.history.length
      ? { action: { type: "click", target: input.page.elements[0].id }, say: "The date filter is set.", done: true, provider: "demo" }
      : { action: { type: "say", text: "Engineer A was posted 2 days ago; Engineer B was posted 4 days ago." }, done: true, provider: "demo" });
    const sending = runtime.send("Keep last 7 days and give me two engineering jobs.");
    await vi.advanceTimersByTimeAsync(2000); await sending;
    expect(decisions()).toHaveLength(2);
    expect(decisions()[1].page.text).toContain("Engineer B");
    expect(decisions()[1].history[0].result).toMatchObject({ ok: true, changed: true });
    expect(runtime.getSnapshot().messages.at(-1)?.text).toContain("Engineer B");
  });

  it.each(["scroll", "wait"] as const)("inspects the resulting requirements after %s incorrectly says done", async (type) => {
    document.body.innerHTML = '<h1>Job requirements</h1><p id="requirements">Loading requirements</p>';
    const reveal = () => { document.getElementById("requirements")!.textContent = "Requires 1 year of experience. Full-time, remote."; };
    const scroll = vi.spyOn(window, "scrollBy").mockImplementation(reveal);
    try {
      const { runtime, decisions } = await setup((input) => !input.history.length
        ? { action: type === "wait" ? { type: "wait", ms: 400 } : { type: "scroll", amount: 600 }, say: "Checking the requirements.", done: true, provider: "demo" }
        : { action: { type: "say", text: input.page.text.includes("1 year") ? "Requires 1 year; full-time and remote." : "Requirements are not visible." }, done: true, provider: "demo" });
      if (type === "wait") setTimeout(reveal, 200);
      const sending = runtime.send(type === "wait" ? "Wait for the requirements, then summarize them." : "Scroll to the requirements, then summarize them.");
      await vi.advanceTimersByTimeAsync(1000); await sending;
      expect(decisions()).toHaveLength(2);
      expect(runtime.getSnapshot().messages.at(-1)?.text).toBe("Requires 1 year; full-time and remote.");
    } finally { scroll.mockRestore(); }
  });

  it("reopens review for edited form values and never submits the stale approval", async () => {
    document.body.innerHTML = '<form><input aria-label="Answer" value="7"><button>Submit answer</button></form><p role="status"></p>';
    const submitted: string[] = [];
    document.querySelector("form")!.onsubmit = (event) => { event.preventDefault(); submitted.push(document.querySelector("input")!.value); };
    const { runtime, decisions } = await setup((input) => input.history.some(({ result }) => result.ok)
      ? { action: { type: "say", text: "The updated answer was submitted." }, done: true, provider: "demo" }
      : { action: { type: "click", target: input.page.elements.find((item) => item.role === "button")!.id }, done: false, provider: "demo" });
    const sending = runtime.send("Submit my answer.");
    await vi.advanceTimersByTimeAsync(1);
    expect(runtime.getSnapshot().confirmation?.message).toContain("7");
    document.querySelector("input")!.value = "6";
    runtime.confirm(true); await vi.advanceTimersByTimeAsync(300);
    expect(submitted).toEqual([]);
    expect(runtime.getSnapshot().phase).toBe("confirming");
    expect(runtime.getSnapshot().confirmation?.message).toContain("6");
    expect(decisions()[1].history[0].result.message).toContain("form changed");
    runtime.confirm(true); await vi.advanceTimersByTimeAsync(2000); await sending;
    expect(submitted).toEqual(["6"]);
    expect(runtime.getSnapshot().phase).toBe("idle");
  });

  it("recovers an invalid source excerpt without saving the fabricated quote or abandoning research", async () => {
    document.body.innerHTML = '<h1>Workshop</h1><p>Materials included. $60 total.</p>';
    const { runtime, request, decisions } = await setup((input) => !input.history.length
      ? { action: { type: "note", text: "Workshop price", excerpt: "Free unlimited materials" }, done: false, provider: "demo" }
      : input.history.length === 1
        ? { action: { type: "note", text: "The workshop costs $60.", excerpt: "Materials included. $60 total." }, done: false, provider: "demo" }
        : { action: { type: "say", text: "The workshop costs $60 including materials." }, done: true, provider: "demo" });
    await runtime.send("Check the workshop cost and save its source.");
    expect(decisions()).toHaveLength(3);
    const saves = request.mock.calls.filter(([message]) => message.type === "note.save");
    expect(saves).toHaveLength(1);
    expect(saves[0][0].note).toMatchObject({ excerpt: "Materials included. $60 total." });
    expect(runtime.getSnapshot().phase).toBe("idle");
  });

  it("resumes an ordinary existing-tab handoff with completed work and latest steering intact", async () => {
    const { runtime, request, emit, decisions } = await setup(() => ({ action: { type: "say", text: "Continuing the second option." }, done: true, provider: "demo" }));
    runtime.setConversationId?.("previous-chat");
    emit({ type: "assistant.run", goal: "Compare two flights", handoff: {
      conversationId: "flight-chat", goal: "Compare two flights", message: "Keep nonstop and carry-on included", step: 9, at: Date.now(),
      history: [{ action: { type: "navigate", url: "https://example.com/flight-b" }, result: { ok: true, changed: false, navigation: true, message: "Navigation dispatched" }, at: Date.now() }],
    } });
    await vi.advanceTimersByTimeAsync(300);
    expect(decisions()).toHaveLength(1);
    expect(decisions()[0]).toMatchObject({ goal: "Compare two flights", message: "Keep nonstop and carry-on included", conversationId: "flight-chat" });
    expect(decisions()[0].history[0]).toMatchObject({ action: { type: "navigate" }, result: { ok: true, changed: true, message: "Destination document observed and verified" } });
    expect(request.mock.calls.some(([message]) => message.type === "task.pause")).toBe(false);
  });

  it("consumes a handoff once when hydration and mounted-tab delivery race", async () => {
    const handoff: SessionHandoff = { conversationId: "same-flight-chat", goal: "Compare flights", message: "Keep nonstop", history: [], step: 5, at: Date.now() };
    const { runtime, emit, decisions } = await setup(() => ({ action: { type: "say", text: "The destination is ready." }, done: true, provider: "demo" }), handoff);
    expect(handoff.history).toEqual([]);
    emit({ type: "assistant.run", goal: handoff.goal, handoff });
    emit({ type: "assistant.run", goal: handoff.goal, handoff });
    await vi.advanceTimersByTimeAsync(300);
    expect(handoff.history).toEqual([]);
    expect(decisions()).toHaveLength(1);
    runtime.setConversationId?.("new-user-chat");
    emit({ type: "assistant.run", goal: handoff.goal, handoff });
    await vi.advanceTimersByTimeAsync(300);
    expect(runtime.getSnapshot().conversationId).toBe("new-user-chat");
    expect(decisions()).toHaveLength(1);
  });
});
