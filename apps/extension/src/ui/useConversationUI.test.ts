// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationUIPatch, ConversationUIState, WindowGeometrySnapshot } from "@core";
import { request } from "../bridge";
import { useConversationUI } from "./useConversationUI";

vi.mock("../bridge", () => ({ request: vi.fn() }));

const empty = (): ConversationUIState => ({ open: false, tools: [], active: null, geometry: {} });
const geometry = (x: number): WindowGeometrySnapshot => ({
  rect: { x, y: 80, width: 420, height: 300 }, minimized: false, maximized: false,
  restoreRect: null, userResized: true,
});
const copy = <T,>(value: T): T => structuredClone(value);
function merge(current: ConversationUIState, patch: ConversationUIPatch): ConversationUIState {
  const next = { ...current, ...patch, geometry: { ...current.geometry } };
  for (const [id, value] of Object.entries(patch.geometry || {})) {
    if (value === null) delete next.geometry[id as keyof typeof next.geometry];
    else next.geometry[id as keyof typeof next.geometry] = value;
  }
  return next;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

let root: Root, container: HTMLDivElement, initial: ConversationUIState;
let current: ReturnType<typeof useConversationUI>;
let saved: Map<string, ConversationUIState>;
const onRestore = vi.fn((state: ConversationUIState) => state);
function Probe({ conversationId }: { conversationId: string }) {
  current = useConversationUI(conversationId, initial, onRestore);
  return createElement("output", { "data-ready": current.ready }, JSON.stringify(current.geometry));
}
const render = (conversationId = "chat-one") => act(async () => root.render(createElement(Probe, { conversationId })));
const patchRequests = () => vi.mocked(request).mock.calls.map(([message]) => message).filter((message) => message.type === "workbench.ui.patch");
async function respond(message: Parameters<typeof request>[0]): Promise<unknown> {
  const id = String(message.conversationId);
  if (message.type === "workbench.ui.get") return copy(saved.get(id) ?? null);
  if (message.type === "workbench.ui.patch") {
    const value = merge(saved.get(id) ?? empty(), message.patch as ConversationUIPatch);
    saved.set(id, copy(value)); return copy(value);
  }
  throw new Error(`Unexpected request: ${message.type}`);
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  saved = new Map(); initial = empty(); onRestore.mockClear(); onRestore.mockImplementation((state) => state);
  vi.mocked(request).mockReset().mockImplementation(respond);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("conversation window persistence", () => {
  it("restores open windows and their latest geometry after a document remount", async () => {
    const original: ConversationUIState = { open: true, tools: ["board", "notes"], active: "notes", geometry: { board: geometry(40) } };
    saved.set("chat-one", copy(original));
    await render();
    expect(current.ready).toBe(true); expect(onRestore).toHaveBeenLastCalledWith(original);
    expect(current.geometry).toEqual(original.geometry);
    expect(patchRequests()).toHaveLength(0);
    await act(async () => { current.patch({ tools: ["board"], active: "board", geometry: { board: geometry(160) } }); await current.flush(); });
    await act(async () => root.unmount()); root = createRoot(container); onRestore.mockClear();
    await render();
    const restored: ConversationUIState = { ...original, tools: ["board"], active: "board", geometry: { board: geometry(160) } };
    expect(current.ready).toBe(true); expect(onRestore).toHaveBeenCalledExactlyOnceWith(restored);
    expect(current.geometry).toEqual(restored.geometry);
  });

  it("ignores a late restore from the conversation that the tab has left", async () => {
    const old = deferred<ConversationUIState | null>();
    const incoming: ConversationUIState = { open: true, tools: ["video"], active: "video", geometry: { video: geometry(220) } };
    saved.set("chat-two", incoming);
    vi.mocked(request).mockImplementation((message) => message.type === "workbench.ui.get" && message.conversationId === "chat-one" ? old.promise : respond(message));
    await render("chat-one"); expect(current.ready).toBe(false);
    await render("chat-two");
    expect(current.ready).toBe(true); expect(onRestore).toHaveBeenCalledExactlyOnceWith(incoming);
    await act(async () => old.resolve({ open: true, tools: ["board"], active: "board", geometry: { board: geometry(10) } }));
    expect(onRestore).toHaveBeenCalledTimes(1); expect(current.geometry).toEqual(incoming.geometry);
    await act(async () => current.flush());
    expect(patchRequests().every((message) => message.conversationId === "chat-two")).toBe(true);
  });

  it("keeps old geometry cleanup callbacks scoped to their original conversation", async () => {
    saved.set("chat-one", { open: true, tools: ["board"], active: "board", geometry: { board: geometry(40) } });
    const incoming: ConversationUIState = { open: true, tools: ["notes"], active: "notes", geometry: { notes: geometry(260) } };
    saved.set("chat-two", copy(incoming));
    await render("chat-one");
    const previousPatch = current.patch, previousFlush = current.flush;
    await render("chat-two");
    const incomingPatch = current.patch;
    expect(incomingPatch).not.toBe(previousPatch);
    await act(async () => {
      previousPatch({ geometry: { board: geometry(180) } });
      await previousFlush();
    });
    expect(patchRequests()).toEqual([{ type: "workbench.ui.patch", conversationId: "chat-one", patch: { geometry: { board: geometry(180) } } }]);
    expect(saved.get("chat-one")?.geometry.board).toEqual(geometry(180));
    expect(saved.get("chat-two")).toEqual(incoming);
    expect(current.ready).toBe(true); expect(current.geometry).toEqual(incoming.geometry);
    expect(current.patch).toBe(incomingPatch);
  });

  it("keeps edits made before the initial conversation has been resolved", async () => {
    const stored: ConversationUIState = { open: false, tools: ["notes"], active: "notes", geometry: { notes: geometry(70) } };
    saved.set("chat-one", stored);
    await render("");
    await act(async () => current.patch({ open: true, tools: ["board"], active: "board" }));
    expect(request).not.toHaveBeenCalled();
    await render("chat-one"); await act(async () => current.flush());
    expect(saved.get("chat-one")).toEqual({ ...stored, open: true, tools: ["board"], active: "board" });
  });

  it("keeps explicit local edits made while saved window state is still loading", async () => {
    const loading = deferred<ConversationUIState | null>();
    const stored: ConversationUIState = { open: true, tools: ["board"], active: "board", geometry: { board: geometry(50), chat: geometry(90) } };
    saved.set("chat-one", stored);
    vi.mocked(request).mockImplementation((message) => message.type === "workbench.ui.get" ? loading.promise : respond(message));
    await render(); expect(current.ready).toBe(false);
    await act(async () => {
      current.patch({ tools: ["notes"], active: "notes" });
      current.patch({ open: false });
      current.patch({ geometry: { chat: geometry(250) } });
    });
    expect(patchRequests()).toHaveLength(0);
    await act(async () => loading.resolve(stored));
    await act(async () => current.flush());
    const expected: ConversationUIState = { open: false, tools: ["notes"], active: "notes", geometry: { board: geometry(50), chat: geometry(250) } };
    expect(current.ready).toBe(true); expect(current.geometry).toEqual(expected.geometry);
    expect(saved.get("chat-one")).toEqual(expected);
  });

  it("preserves other windows when geometry patches arrive during an in-flight save", async () => {
    saved.set("chat-one", { open: true, tools: ["board", "notes"], active: "notes", geometry: { chat: geometry(20), board: geometry(60), notes: geometry(100) } });
    await render();
    const saving = deferred<void>(); let first = true;
    vi.mocked(request).mockImplementation(async (message) => {
      if (message.type === "workbench.ui.patch" && first) { first = false; await saving.promise; }
      return respond(message);
    });
    let flushed = false, firstFlush!: Promise<void>;
    await act(async () => { current.patch({ geometry: { board: geometry(180) } }); firstFlush = current.flush().then(() => { flushed = true; }); });
    await vi.waitFor(() => expect(patchRequests().length).toBeGreaterThan(0));
    await act(async () => { current.patch({ geometry: { notes: geometry(260) } }); });
    expect(patchRequests()).toHaveLength(2); // Dispatch before pagehide can destroy a document with an older save still in flight.
    expect(flushed).toBe(false);
    await act(async () => { saving.resolve(); await firstFlush; await current.flush(); });
    expect(saved.get("chat-one")?.geometry).toEqual({ chat: geometry(20), board: geometry(180), notes: geometry(260) });
    expect(current.geometry).toEqual(saved.get("chat-one")?.geometry);
    await act(async () => { current.patch({ geometry: { board: null } }); await current.flush(); });
    expect(saved.get("chat-one")?.geometry).toEqual({ chat: geometry(20), notes: geometry(260) });
  });

  it("persists visibility adjustments returned by the restore callback", async () => {
    const stored: ConversationUIState = { open: false, tools: ["board"], active: "board", geometry: { board: geometry(70) } };
    saved.set("chat-one", stored); onRestore.mockImplementation((state) => ({ ...state, open: true }));
    await render(); await act(async () => current.flush());
    expect(onRestore).toHaveBeenCalledExactlyOnceWith(stored);
    expect(saved.get("chat-one")).toEqual({ ...stored, open: true });
  });
});
