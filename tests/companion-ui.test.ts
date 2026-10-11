// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type ConversationUIPatch, type ConversationUIState, type RuntimeEvent } from "@core";
import { request, subscribe } from "../apps/extension/src/bridge";
import { Companion } from "../apps/extension/src/ui/Companion";
import type { CompanionRuntime, CompanionSnapshot, RuntimeMessage } from "../apps/extension/src/runtime/types";

vi.mock("../apps/extension/src/bridge", () => ({ request: vi.fn(), subscribe: vi.fn() }));
vi.mock("../apps/extension/src/ui/hooks", () => ({ useSettings: () => ({ settings: DEFAULT_SETTINGS }) }));
vi.mock("../apps/extension/src/ui/Pet", () => ({ Pet: () => createElement("span", { "aria-label": "HypeMan pet" }) }));
vi.mock("../apps/extension/src/ui/ToolOverlay", () => ({
  ToolOverlay: ({ openSections = [] }: { openSections?: string[] }) => openSections.map((tool) => createElement("section", { key: tool, "data-tool": tool })),
}));

let root: Root, container: HTMLDivElement, runtime: CompanionRuntime, snapshot: CompanionSnapshot;
let uiStates: Map<string, ConversationUIState>;
let runtimeListeners: Set<() => void>, eventListeners: Set<(event: RuntimeEvent) => void>;
const state = (open: boolean): ConversationUIState => ({ open, tools: ["notes"], active: "notes", geometry: {} });
const message = (id: string): RuntimeMessage => ({ id: `${id}-saved`, role: "assistant", text: `Saved ${id} context`, at: 1 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function notify() { for (const listener of runtimeListeners) listener(); }
async function respond(input: Parameters<typeof request>[0]): Promise<unknown> {
  const id = String(input.conversationId || snapshot.conversationId);
  if (input.type === "conversation.resolve" || input.type === "conversation.open") return { id, messages: [message(id)] };
  if (input.type === "conversation.append") return {};
  if (input.type === "workbench.ui.get") return structuredClone(uiStates.get(id) ?? null);
  if (input.type === "workbench.ui.patch") {
    const patch = input.patch as ConversationUIPatch;
    const current = uiStates.get(id) ?? { open: false, tools: [], active: null, geometry: {} };
    const next: ConversationUIState = { ...current, ...patch, geometry: { ...current.geometry } };
    for (const [window, geometry] of Object.entries(patch.geometry || {})) {
      if (geometry === null) delete next.geometry[window as keyof typeof next.geometry];
      else next.geometry[window as keyof typeof next.geometry] = geometry;
    }
    uiStates.set(id, structuredClone(next)); return next;
  }
  throw new Error(`Unexpected request: ${input.type}`);
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("chrome", { tabs: {} });
  history.replaceState(null, "", "/");
  uiStates = new Map(); runtimeListeners = new Set(); eventListeners = new Set();
  snapshot = {
    conversationId: "chat-one", phase: "idle", status: "Ready", messages: [], confirmation: null,
    task: { id: "task-one", goal: "Read this source", status: "running", steps: [], lastPage: null, nextStep: "Read", createdAt: 1, updatedAt: 1, tabId: 1 },
    video: null, sketch: null, learning: { enabled: false, hintLevel: 0, plan: [], teaching: null, autoHint: null },
    settings: DEFAULT_SETTINGS, reducedMotion: true, screenshotAttached: false,
  };
  runtime = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { runtimeListeners.add(listener); return () => runtimeListeners.delete(listener); },
    setConversationId: vi.fn((id: string) => { if (snapshot.conversationId !== id) { snapshot = { ...snapshot, conversationId: id }; notify(); } }),
    stop: vi.fn(), setSelectedContent: vi.fn(), setToolHandler: vi.fn(), send: vi.fn(), confirm: vi.fn(), setSettings: vi.fn(), attachImage: vi.fn(),
  } as unknown as CompanionRuntime;
  vi.mocked(request).mockReset().mockImplementation(respond);
  vi.mocked(subscribe).mockReset().mockImplementation((listener) => { eventListeners.add(listener); return () => { eventListeners.delete(listener); }; });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = () => act(async () => root.render(createElement(Companion, { runtime })));
const host = () => container.querySelector<HTMLDivElement>(".companion-workbench-host")!;
const avatar = () => container.querySelector<HTMLButtonElement>(".pet-handle")!;
const toggle = () => act(async () => avatar().click());

describe("companion window visibility", () => {
  it("restores an open conversation without an avatar click", async () => {
    uiStates.set("chat-one", state(true));
    await render();
    expect(host().hidden).toBe(false); expect(avatar().getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector<HTMLElement>(".conversation-pane")!.hidden).toBe(false);
    expect(host().textContent).toContain("Saved chat-one context");
    expect(host().querySelector('[data-tool="notes"]')).not.toBeNull();
    expect(runtime.stop).not.toHaveBeenCalled();
  });

  it("keeps a saved closed conversation behind the avatar", async () => {
    uiStates.set("chat-one", state(false));
    await render();
    expect(host().hidden).toBe(true); expect(avatar().getAttribute("aria-expanded")).toBe("false");
    expect(uiStates.get("chat-one")?.open).toBe(false);
    expect(runtime.stop).not.toHaveBeenCalled();
  });

  it("keeps a user open action when the delayed saved state says closed", async () => {
    const stored = state(false), loading = deferred<ConversationUIState | null>();
    uiStates.set("chat-one", stored);
    vi.mocked(request).mockImplementation((input) => input.type === "workbench.ui.get" ? loading.promise : respond(input));
    await render(); expect(host().hidden).toBe(true);
    await toggle(); expect(host().hidden).toBe(false);
    await act(async () => loading.resolve(stored));
    expect(host().hidden).toBe(false); expect(avatar().getAttribute("aria-expanded")).toBe("true");
    await vi.waitFor(() => expect(uiStates.get("chat-one")?.open).toBe(true));
    expect(runtime.stop).not.toHaveBeenCalled();
  });

  it("keeps a user close action when the delayed saved state says open", async () => {
    const stored = state(true), loading = deferred<ConversationUIState | null>();
    uiStates.set("chat-one", stored);
    vi.mocked(request).mockImplementation((input) => input.type === "workbench.ui.get" ? loading.promise : respond(input));
    await render();
    await toggle(); expect(host().hidden).toBe(false);
    await toggle(); expect(host().hidden).toBe(true);
    await act(async () => loading.resolve(stored));
    expect(host().hidden).toBe(true); expect(avatar().getAttribute("aria-expanded")).toBe("false");
    await vi.waitFor(() => expect(uiStates.get("chat-one")?.open).toBe(false));
  });

  it.each([true, false])("adopts the incoming conversation's saved visibility (%s) without stopping its task", async (incomingOpen) => {
    uiStates.set("chat-one", state(!incomingOpen)); uiStates.set("chat-two", state(incomingOpen));
    await render(); expect(host().hidden).toBe(incomingOpen);
    vi.mocked(runtime.stop).mockClear();
    await act(async () => {
      snapshot = { ...snapshot, conversationId: "chat-two", phase: "acting", messages: [message("chat-two")] };
      notify();
    });
    expect(host().hidden).toBe(!incomingOpen);
    expect(avatar().getAttribute("aria-expanded")).toBe(String(incomingOpen));
    expect(host().textContent).toContain("Saved chat-two context");
    expect(host().textContent).not.toContain("Saved chat-one context");
    expect(uiStates.get("chat-one")?.open).toBe(!incomingOpen);
    expect(uiStates.get("chat-two")?.open).toBe(incomingOpen);
    expect(runtime.stop).not.toHaveBeenCalled();
  });
});
