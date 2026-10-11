// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type ConversationUIPatch, type ConversationUIState, type RuntimeEvent } from "@core";
import { ConversationWorkbench } from "../apps/extension/src/ui/ConversationWorkbench";
import { request, subscribe } from "../apps/extension/src/bridge";
import { exportWorkspace } from "../apps/extension/src/ui/hooks";
import type { CompanionRuntime, CompanionSnapshot, RuntimeMessage } from "../apps/extension/src/runtime/types";

vi.mock("../apps/extension/src/bridge", () => ({ request: vi.fn(), subscribe: vi.fn() }));
vi.mock("../apps/extension/src/ui/hooks", () => ({ useSettings: () => ({ settings: DEFAULT_SETTINGS }), exportWorkspace: vi.fn() }));
vi.mock("../apps/extension/src/ui/ToolOverlay", () => ({ ToolOverlay: ({ section, openSections, onClose }: { section: string | null; openSections?: string[]; onClose: (section: string) => void }) =>
  (openSections || (section ? [section] : [])).map((tool) => createElement("section", { key: tool, "data-tool": tool, "data-active": section === tool }, createElement("button", { "aria-label": "Close tool", onClick: () => onClose(tool) }))) }));
let root: Root, container: HTMLDivElement, snapshot: CompanionSnapshot, runtime: CompanionRuntime;
let notify: () => void, openIncoming: () => Promise<{ id: string; messages: RuntimeMessage[] }>;
let stored: Map<string, RuntimeMessage[]>;
let uiStates: Map<string, ConversationUIState>;
let bridgeListeners: Set<(event: RuntimeEvent) => void>;
const emit = (event: RuntimeEvent) => { for (const listener of bridgeListeners) listener(event); };
const saved = (id: string, text: string): RuntimeMessage => ({ id, role: "assistant", text, at: 1 });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("chrome", { tabs: {} });
  history.replaceState(null, "", "/");
  stored = new Map([["old-chat", [saved("old-saved", "Previous tab conversation")]], ["project-chat", [saved("project-saved", "Saved project context")]]]);
  uiStates = new Map();
  bridgeListeners = new Set();
  vi.mocked(subscribe).mockImplementation((listener) => { bridgeListeners.add(listener); return () => { bridgeListeners.delete(listener); }; });
  snapshot = { conversationId: "old-chat", phase: "idle", status: "Ready", messages: [...stored.get("old-chat")!], confirmation: null, task: null, video: null,
    learning: { enabled: false, hintLevel: 0, plan: [], teaching: null, autoHint: null }, sketch: { type: "sketch", title: "Previous board", lines: ["old work"] },
    settings: DEFAULT_SETTINGS, reducedMotion: true, screenshotAttached: false };
  openIncoming = async () => ({ id: "project-chat", messages: [...stored.get("project-chat")!] });
  vi.mocked(request).mockReset().mockImplementation(async (message) => {
    if (message.type === "conversation.resolve") return { id: "old-chat", messages: [...stored.get("old-chat")!] };
    if (message.type === "conversation.open") return message.conversationId === "project-chat" ? openIncoming() : { id: message.conversationId, messages: [...stored.get(String(message.conversationId)) || []] };
    if (message.type === "conversation.select") { stored.set(String(message.conversationId), []); return { id: message.conversationId, messages: [] }; }
    if (message.type === "conversation.append") { const messages = stored.get(String(message.conversationId)) || []; const value = message.message as RuntimeMessage; if (!messages.some((entry) => entry.id === value.id)) messages.push(value); stored.set(String(message.conversationId), messages); return {}; }
    if (message.type === "workbench.ui.get") return structuredClone(uiStates.get(String(message.conversationId)) ?? null);
    if (message.type === "workbench.ui.patch") {
      const id = String(message.conversationId), patch = message.patch as ConversationUIPatch;
      const current = uiStates.get(id) ?? { open: false, tools: [], active: null, geometry: {} };
      const next: ConversationUIState = { ...current, ...patch, geometry: { ...current.geometry } };
      for (const [window, geometry] of Object.entries(patch.geometry || {})) {
        if (geometry === null) delete next.geometry[window as keyof typeof next.geometry];
        else next.geometry[window as keyof typeof next.geometry] = geometry;
      }
      uiStates.set(id, structuredClone(next)); return next;
    }
    return {};
  });
  runtime = { getSnapshot: () => snapshot, subscribe: (listener: () => void) => { notify = listener; return () => {}; }, stop: vi.fn(),
    setConversationId: vi.fn((id: string) => { snapshot = { ...snapshot, conversationId: id, messages: [], sketch: null }; notify(); }),
    setSelectedContent: vi.fn(), setToolHandler: vi.fn(), send: vi.fn(), confirm: vi.fn(), setSettings: vi.fn(), attachImage: vi.fn(),
  } as unknown as CompanionRuntime;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});

describe("shared browser work in its originating conversation", () => {
  const active = { runId: "research-run", tabId: 5, phase: "thinking", status: "Comparing the options", site: "www.ikea.com", title: "Desk lamps" };
  const activity = (value: unknown = active, id = "old-chat") => emit({ type: "conversation.activity", conversationId: id, activity: value });
  it("keeps Stop and the working source visible after local execution becomes idle", async () => {
    await render();
    await act(async () => activity());
    expect(container.querySelector('[aria-label="Stop"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Send message"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("www.ikea.com · Comparing the options");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Show working tab"]')!.click());
    expect(request).toHaveBeenCalledWith({ type: "conversation.activity.open", conversationId: "old-chat", runId: "research-run" });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Stop"]')!.click());
    expect(request).toHaveBeenCalledWith({ type: "conversation.cancel-pending", conversationId: "old-chat" });
    await act(async () => activity(null));
    expect(container.querySelector('[aria-label="Stop"]')).toBeNull();
  });
  it("refreshes destination replies once without reopening or switching the original chat", async () => {
    await render();
    vi.mocked(runtime.setConversationId!).mockClear();
    stored.get("old-chat")!.push({ ...saved("destination-reply", "Both lamps meet your budget."), at: 3 });
    await act(async () => { activity(); emit({ type: "conversation.changed", conversationId: "old-chat" }); });
    await act(async () => emit({ type: "conversation.changed", conversationId: "old-chat" }));
    expect([...container.querySelectorAll(".chat-message")].filter((message) => message.textContent === "Both lamps meet your budget.")).toHaveLength(1);
    expect(stored.get("old-chat")!.filter((message) => message.id === "destination-reply")).toHaveLength(1);
    expect(runtime.setConversationId).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ type: "conversation.select" }));
  });
  it("labels remote confirmation and offers the recorded working tab for review", async () => {
    await render();
    await act(async () => activity({ ...active, phase: "confirming", status: "Thinking…" }));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("www.ikea.com · Waiting for confirmation");
    expect(container.querySelector('[aria-label="Review in working tab"]')?.textContent).toBe("Review");
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });
  it("ignores work and messages from unrelated chats", async () => {
    await render();
    await act(async () => { activity(active, "another-chat"); emit({ type: "conversation.changed", conversationId: "another-chat" }); });
    expect(container.querySelector('[aria-label="Stop"]')).toBeNull();
    expect(request).not.toHaveBeenCalledWith({ type: "conversation.open", conversationId: "another-chat" });
  });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = () => act(async () => root.render(createElement(ConversationWorkbench, { runtime, initialTool: "board" })));
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
};
const submitMessage = async (text: string) => {
  await act(async () => {
    const field = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => container.querySelector("form.conversation-composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
};
const adoptProjectChat = () => act(async () => {
  snapshot = { ...snapshot, conversationId: "project-chat", phase: "idle", messages: [], sketch: null };
  notify();
});

describe("deferred conversation replies and cancellation", () => {
  const stoppedText = "Stopped. Completed work is saved.";
  const holdResponses = () => {
    const assist = deferred<Record<string, never>>();
    const cancellation = deferred<{ stopped: boolean }>();
    const original = vi.mocked(request).getMockImplementation()!;
    let assistSignal: AbortSignal | undefined;
    vi.mocked(request).mockImplementation((message, signal) => {
      if (message.type === "conversation.assist") { assistSignal = signal; return assist.promise; }
      if (message.type === "conversation.cancel-pending") return cancellation.promise;
      return original(message, signal);
    });
    return { assist, cancellation, get signal() { return assistSignal; } };
  };
  const notices = () => stored.get("old-chat")!.filter((message) => message.role === "status");

  it("does not put a late cancellation notice into a newly adopted chat", async () => {
    await render(); const held = holdResponses();
    await submitMessage("compare these two lamps please");
    expect(held.signal?.aborted).toBe(false);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Stop"]')!.click());
    expect(held.signal?.aborted).toBe(true);
    expect(request).toHaveBeenCalledWith({ type: "conversation.cancel-pending", conversationId: "old-chat" });
    await adoptProjectChat();
    await act(async () => { held.cancellation.resolve({ stopped: false }); held.assist.resolve({}); });
    expect(container.textContent).toContain("Saved project context");
    expect(container.textContent).not.toContain(stoppedText);
    expect(stored.get("project-chat")!.map((message) => message.text)).toEqual(["Saved project context"]);
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ type: "conversation.append", conversationId: "project-chat", message: expect.objectContaining({ role: "status" }) }));
    expect(runtime.send).not.toHaveBeenCalled();
  });

  it("does not dispatch an old prompt into another chat after awaiting cancellation", async () => {
    await render(); const held = holdResponses();
    await act(async () => emit({ type: "conversation.activity", conversationId: "old-chat", activity: { runId: "research-run", tabId: 5, phase: "thinking", status: "Comparing options", site: "www.ikea.com", title: "Desk lamps" } }));
    const prompt = "actually compare the smaller lamps instead";
    await submitMessage(prompt);
    expect(request).toHaveBeenCalledWith({ type: "conversation.cancel-pending", conversationId: "old-chat" });
    expect([...stored.values()].flat().some((message) => message.text === prompt)).toBe(false);
    await adoptProjectChat();
    await act(async () => held.cancellation.resolve({ stopped: true }));
    expect([...stored.values()].flat().some((message) => message.text === prompt)).toBe(false);
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ type: "conversation.assist" }), expect.anything());
    expect(runtime.send).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Saved project context");
  });

  it("preserves a destination reply when an older incoming-chat hydration finishes later", async () => {
    await render();
    const hydration = deferred<{ id: string; messages: RuntimeMessage[] }>();
    const refresh = deferred<{ id: string; messages: RuntimeMessage[] }>();
    openIncoming = vi.fn().mockReturnValueOnce(hydration.promise).mockReturnValueOnce(refresh.promise);
    await adoptProjectChat();
    expect(container.querySelector("textarea")!.disabled).toBe(true);
    const context = [...stored.get("project-chat")!];
    const reply = { ...saved("remote-only-reply", "The smaller lamp is in stock."), at: 3 };
    stored.get("project-chat")!.push(reply);
    await act(async () => emit({ type: "conversation.changed", conversationId: "project-chat" }));
    expect(openIncoming).toHaveBeenCalledTimes(2);
    await act(async () => refresh.resolve({ id: "project-chat", messages: [...context, reply] }));
    expect(container.textContent).toContain(reply.text);
    expect(snapshot.messages).toEqual([]);
    await act(async () => hydration.resolve({ id: "project-chat", messages: context }));
    expect(container.querySelector("textarea")!.disabled).toBe(false);
    expect([...container.querySelectorAll(".chat-message")].filter((message) => message.textContent === reply.text)).toHaveLength(1);
    expect([...container.querySelectorAll(".chat-message")].filter((message) => message.textContent === "Saved project context")).toHaveLength(1);
    expect(stored.get("project-chat")!.filter((message) => message.id === reply.id)).toHaveLength(1);
  });

  it("uses the background's saved stop notice without adding a tool cancellation duplicate", async () => {
    await render(); const held = holdResponses();
    await submitMessage("compare these two lamps please");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Stop"]')!.click());
    expect(runtime.stop).toHaveBeenCalledWith(true, false);
    expect(request).toHaveBeenCalledWith({ type: "conversation.cancel-pending", conversationId: "old-chat" });
    await act(async () => {
      stored.get("old-chat")!.push({ id: "background-stop", role: "status", text: stoppedText, at: Date.now() });
      emit({ type: "conversation.changed", conversationId: "old-chat" });
      held.cancellation.resolve({ stopped: true }); held.assist.resolve({});
    });
    expect(notices().map((message) => message.text)).toEqual([stoppedText]);
    expect([...container.querySelectorAll(".chat-message.status")].map((message) => message.textContent)).toEqual([stoppedText]);
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ type: "conversation.append", message: expect.objectContaining({ role: "status" }) }));
  });

  it("still records one local stop notice when the background had no pending work", async () => {
    await render(); const held = holdResponses();
    await submitMessage("compare these two lamps please");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Stop"]')!.click());
    await act(async () => { held.cancellation.resolve({ stopped: false }); held.assist.resolve({}); });
    expect(runtime.stop).toHaveBeenCalledWith(true, false);
    expect(notices().map((message) => message.text)).toEqual([stoppedText]);
    expect([...container.querySelectorAll(".chat-message.status")].map((message) => message.textContent)).toEqual([stoppedText]);
  });

  it("assigns a busy local runtime's stop notice to one owner", async () => {
    await render(); const held = holdResponses();
    await submitMessage("compare these two lamps please");
    await act(async () => { snapshot = { ...snapshot, phase: "acting" }; notify(); });
    vi.mocked(runtime.stop).mockImplementation((_pauseProject, announce) => {
      if (!announce) return;
      snapshot = { ...snapshot, phase: "idle", messages: [...snapshot.messages, { id: "runtime-stop", role: "status", text: "Stopped this request.", at: Date.now() }] };
      notify();
    });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Stop"]')!.click());
    expect(runtime.stop).toHaveBeenCalledWith(true, true);
    expect(request).toHaveBeenCalledWith({ type: "conversation.cancel-pending", conversationId: "old-chat", markerAlreadyWritten: true });
    await act(async () => { held.cancellation.resolve({ stopped: true }); held.assist.resolve({}); });
    expect(notices().map((message) => message.text)).toEqual(["Stopped this request."]);
    expect([...container.querySelectorAll(".chat-message.status")].map((message) => message.textContent)).toEqual(["Stopped this request."]);
  });
});

describe("existing-tab conversation handoff", () => {
  it("restores chat size and open tools after a document remount without stopping its task", async () => {
    const chatGeometry = { rect: { x: 120, y: 100, width: 480, height: 260 }, minimized: false, maximized: false, restoreRect: null, userResized: true };
    uiStates.set("old-chat", { open: true, tools: ["board", "notes"], active: "notes", geometry: { chat: chatGeometry } });
    snapshot = { ...snapshot, sketch: null };
    const restoreOpen = vi.fn((open: boolean) => open);
    const mount = () => act(async () => root.render(createElement(ConversationWorkbench, { runtime, onRestoreChatOpen: restoreOpen })));
    await mount();
    expect(restoreOpen).toHaveBeenLastCalledWith(true, "old-chat");
    expect(container.querySelector<HTMLElement>(".conversation-pane")!.hidden).toBe(false);
    expect(container.querySelector<HTMLElement>(".conversation-pane")!.style.width).toBe("480px");
    expect([...container.querySelectorAll<HTMLElement>("[data-tool]")].map((tool) => tool.dataset.tool)).toEqual(["board", "notes"]);
    await act(async () => {
      container.querySelector(".conversation-pane .pixel-window-resize")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      container.querySelector<HTMLButtonElement>('[data-tool="notes"] button')!.click();
    });
    await vi.waitFor(() => {
      expect(uiStates.get("old-chat")?.geometry.chat?.rect.width).toBe(490);
      expect(uiStates.get("old-chat")?.tools).toEqual(["board"]);
    });
    await act(async () => root.unmount()); root = createRoot(container); restoreOpen.mockClear();
    await mount();
    expect(restoreOpen).toHaveBeenLastCalledWith(true, "old-chat");
    expect(container.querySelector<HTMLElement>(".conversation-pane")!.style.width).toBe("490px");
    expect(container.querySelector<HTMLElement>(".conversation-pane")!.style.height).toBe("260px");
    expect([...container.querySelectorAll<HTMLElement>("[data-tool]")].map((tool) => tool.dataset.tool)).toEqual(["board"]);
    expect(container.textContent).toContain("Previous tab conversation");
    expect(runtime.stop).not.toHaveBeenCalled();
  });

  it("restores the incoming conversation's tool windows without stopping the newly owned task", async () => {
    uiStates.set("old-chat", { open: true, tools: ["board"], active: "board", geometry: {} });
    uiStates.set("project-chat", { open: true, tools: ["notes", "documents"], active: "documents", geometry: {} });
    await render(); vi.mocked(runtime.stop).mockClear();
    await act(async () => { snapshot = { ...snapshot, conversationId: "project-chat", phase: "acting", messages: [], sketch: null }; notify(); });
    expect([...container.querySelectorAll<HTMLElement>("[data-tool]")].map((tool) => tool.dataset.tool)).toEqual(["notes", "documents"]);
    expect(container.querySelector('[data-tool="documents"]')?.getAttribute("data-active")).toBe("true");
    expect(container.textContent).toContain("Saved project context");
    expect(container.textContent).not.toContain("Previous tab conversation");
    expect(uiStates.get("old-chat")?.tools).toEqual(["board"]);
    expect(runtime.stop).not.toHaveBeenCalled();
  });

  it("closes a tool without stopping the active project", async () => {
    await render(); vi.mocked(runtime.stop).mockClear();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close tool"]')!.click());
    expect(container.querySelector("[data-tool]")).toBeNull();
    expect(runtime.stop).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(container.querySelector("textarea"));
  });
  it("adopts the background-selected chat without stopping its task and mirrors new messages only after hydration", async () => {
    await render();
    await act(async () => container.querySelector<HTMLElement>(".chat-message")!.click());
    expect(container.querySelector(".chat-message.is-selected")).not.toBeNull(); expect(container.querySelector(".conversation-context")).toBeNull(); expect(container.querySelector('[data-tool="board"]')).not.toBeNull();
    let finish!: (value: { id: string; messages: RuntimeMessage[] }) => void;
    openIncoming = () => new Promise((resolve) => { finish = resolve; });
    runtime.stop = vi.fn(); vi.mocked(runtime.setConversationId!).mockClear();
    await act(async () => { snapshot = { ...snapshot, conversationId: "project-chat", phase: "acting", messages: [saved("project-live-1", "Project continued in this tab")], sketch: null }; notify(); });
    expect(request).toHaveBeenCalledWith({ type: "conversation.open", conversationId: "project-chat" });
    expect(container.textContent).not.toContain("Previous tab conversation"); expect(container.querySelector("[data-tool]")).toBeNull(); expect(container.querySelector(".chat-message.is-selected")).toBeNull();
    expect(container.querySelector("textarea")!.disabled).toBe(true);
    expect(stored.get("old-chat")!.map((message) => message.text)).toEqual(["Previous tab conversation"]);
    await act(async () => { snapshot = { ...snapshot, messages: [...snapshot.messages, saved("project-live-2", "Latest project update")] }; notify(); });
    await act(async () => finish({ id: "project-chat", messages: [...stored.get("project-chat")!] }));
    expect(container.textContent).toContain("Saved project context"); expect(container.textContent).toContain("Latest project update");
    expect(stored.get("project-chat")!.map((message) => message.id)).toEqual(["project-saved", "project-live-1", "project-live-2"]);
    expect(stored.get("old-chat")!).toHaveLength(1);
    expect(runtime.stop).not.toHaveBeenCalled(); expect(runtime.setConversationId).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ type: "conversation.select" }));
  });
  it("still stops the previous task when the user explicitly starts a new conversation", async () => {
    await render(); vi.mocked(runtime.stop).mockClear();
    await act(async () => { const field = container.querySelector("textarea")!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "new chat"); field.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(runtime.stop).toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: "conversation.select" }));
    expect(runtime.setConversationId).toHaveBeenCalledWith(expect.any(String));
  });
});


describe("local recovery on a webpage", () => {
  it("shows a runtime failure once with its recovery controls", async () => {
    const error = "The model proposed an invalid browser action; nothing was executed.";
    vi.mocked(runtime.send).mockImplementationOnce(async () => {
      snapshot = { ...snapshot, phase: "error", messages: [...snapshot.messages, { id: "runtime-error", role: "status", text: error, at: 2 }] };
      notify();
    });
    await render();
    await act(async () => { const field = container.querySelector("textarea")!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "pull up a video to show me how to do this"); field.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => container.querySelector("form.conversation-composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(container.querySelectorAll(".chat-message.status")).toHaveLength(0);
    expect(container.querySelectorAll(".notice.error")).toHaveLength(1);
    expect(container.querySelector(".notice.error")?.textContent).toContain(error);
    expect([...container.querySelectorAll("button")].some(button => button.textContent === "Retry")).toBe(true);
    expect(stored.get("old-chat")!.some(message => message.id === "runtime-error")).toBe(true);
  });
  it("retries a failed backup without resuming an unrelated runtime task", async () => {
    runtime.retry = vi.fn();
    vi.mocked(exportWorkspace).mockRejectedValueOnce(new Error("Backup temporarily unavailable")).mockResolvedValueOnce(undefined);
    await render();
    await act(async () => { const field = container.querySelector("textarea")!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "export workspace"); field.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => container.querySelector("form.conversation-composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(container.textContent).toContain("Backup temporarily unavailable");
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Retry")!.click());
    expect(exportWorkspace).toHaveBeenCalledTimes(2);
    expect(runtime.retry).not.toHaveBeenCalled(); expect(runtime.send).not.toHaveBeenCalled();
  });
});

describe("confirmation review", () => {
  const showConfirmation = async () => act(async () => {
    snapshot = { ...snapshot, phase: "confirming", status: "Thinking…", confirmation: { message: "Search · www.expedia.com\nNew York → Chicago\nNovember 6–10, 2026\n1 adult, Economy", label: "Submit" } };
    notify();
  });
  it("shows the exact review and a waiting state instead of processing", async () => {
    await render(); await showConfirmation();
    const dialog = container.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(dialog.getAttribute("aria-describedby")).toBe("browser-action-review");
    expect(dialog.querySelector(".confirmation-review")?.textContent).toBe(snapshot.confirmation!.message);
    expect(dialog.querySelector('[role="status"]')?.textContent).toBe("Waiting for your confirmation");
    expect(container.querySelector(".conversation-working")).toBeNull();
    expect(document.activeElement?.textContent).toBe("Cancel");
    await act(async () => dialog.querySelector<HTMLButtonElement>(".primary")!.click());
    expect(runtime.confirm).toHaveBeenCalledWith(true);
  });
  it("replaces the thinking indicator while the request is still awaiting approval", async () => {
    const activity = vi.fn(); let finish!: () => void;
    vi.mocked(runtime.send).mockImplementationOnce(async () => {
      snapshot = { ...snapshot, phase: "confirming", status: "Thinking…", confirmation: { message: "Go · weather.gov\nNew York, NY", label: "Submit" } };
      notify(); await new Promise<void>(resolve => { finish = resolve; });
    });
    vi.mocked(runtime.confirm).mockImplementationOnce(() => {
      snapshot = { ...snapshot, phase: "idle", confirmation: null }; notify(); finish();
    });
    await act(async () => root.render(createElement(ConversationWorkbench, { runtime, onActivity: activity })));
    await act(async () => { const field = container.querySelector("textarea")!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "look up flights from new york"); field.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => container.querySelector("form.conversation-composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(container.querySelector('[aria-label="Stop"]')).not.toBeNull();
    expect(container.querySelector(".conversation-working")).toBeNull();
    expect(container.querySelector('.confirmation [role="status"]')?.textContent).toBe("Waiting for your confirmation");
    expect(activity).toHaveBeenLastCalledWith(false);
    await act(async () => container.querySelector<HTMLButtonElement>(".confirmation button:last-child")!.click());
    expect(container.querySelector('[aria-label="Stop"]')).toBeNull();
  });
  it("includes the scrollable review in the keyboard focus loop", async () => {
    await render(); await showConfirmation();
    const dialog = container.querySelector<HTMLElement>('[role="alertdialog"]')!;
    const review = dialog.querySelector<HTMLElement>(".confirmation-review")!;
    const cancel = dialog.querySelector<HTMLButtonElement>("button:last-child")!;
    await act(async () => cancel.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(review);
    await act(async () => review.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(cancel);
  });
  it("cancels a pending browser review on Escape without stopping unrelated work", async () => {
    await render(); await showConfirmation(); vi.mocked(runtime.stop).mockClear();
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(runtime.confirm).toHaveBeenCalledWith(false);
    expect(runtime.stop).not.toHaveBeenCalled();
  });
  it("restores a user-sized compact chat after confirmation", async () => {
    const compact = { rect: { x: 120, y: 300, width: 340, height: 120 }, minimized: false, maximized: false, restoreRect: null, userResized: true };
    uiStates.set("old-chat", { open: true, tools: [], active: null, geometry: { chat: compact } });
    await render(); const pane = container.querySelector<HTMLElement>(".conversation-pane")!;
    expect(pane.style.height).toBe("120px");
    await showConfirmation(); expect(pane.style.height).toBe("320px");
    await act(async () => { snapshot = { ...snapshot, phase: "idle", confirmation: null }; notify(); });
    expect(pane.style.height).toBe("120px"); expect(pane.style.top).toBe("300px");
    expect(document.activeElement).toBe(container.querySelector("textarea"));
  });
});
