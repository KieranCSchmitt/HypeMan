// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type ConversationUIPatch, type ConversationUIState } from "@core";
import { ConversationWorkbench } from "../apps/extension/src/ui/ConversationWorkbench";
import { request } from "../apps/extension/src/bridge";
import type { CompanionRuntime, CompanionSnapshot, RuntimeMessage } from "../apps/extension/src/runtime/types";

vi.mock("../apps/extension/src/bridge", () => ({ request: vi.fn(), subscribe: () => () => {} }));
vi.mock("../apps/extension/src/ui/hooks", () => ({ useSettings: () => ({ settings: DEFAULT_SETTINGS }) }));
vi.mock("../apps/extension/src/ui/ToolOverlay", () => ({ ToolOverlay: ({ section, openSections, onClose }: { section: string | null; openSections?: string[]; onClose: (section: string) => void }) =>
  (openSections || (section ? [section] : [])).map((tool) => createElement("section", { key: tool, "data-tool": tool, "data-active": section === tool }, createElement("button", { "aria-label": "Close tool", onClick: () => onClose(tool) }))) }));
let root: Root, container: HTMLDivElement, snapshot: CompanionSnapshot, runtime: CompanionRuntime;
let notify: () => void, openIncoming: () => Promise<{ id: string; messages: RuntimeMessage[] }>;
let stored: Map<string, RuntimeMessage[]>;
let uiStates: Map<string, ConversationUIState>;
const saved = (id: string, text: string): RuntimeMessage => ({ id, role: "assistant", text, at: 1 });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("chrome", { tabs: {} });
  history.replaceState(null, "", "/");
  stored = new Map([["old-chat", [saved("old-saved", "Previous tab conversation")]], ["project-chat", [saved("project-saved", "Saved project context")]]]);
  uiStates = new Map();
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
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = () => act(async () => root.render(createElement(ConversationWorkbench, { runtime, initialTool: "board" })));
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
