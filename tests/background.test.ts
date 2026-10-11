import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  DEFAULT_MESSAGING_SETTINGS,
  SETTINGS_KEY,
  WORKSPACE_KEY,
  type BrowserTask,
  type CompanionSnapshot,
  type SessionHandoff,
  type PageSnapshot,
  type AgentRequest,
  type ConversationUIState,
  type WindowGeometrySnapshot,
} from "@core";

interface Reply {
  ok: boolean;
  data?: unknown;
  error?: string;
}
type Receive = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (value: Reply) => void,
) => boolean | undefined;
let receive: Receive;
let local: Record<string, unknown>, session: Record<string, unknown>;
let tabs: Map<number, chrome.tabs.Tab>, nextTab: number;
let beforeSessionSave: ((values: Record<string, unknown>) => Promise<void>) | undefined;
let beforeTabUpdate: ((id: number, properties: chrome.tabs.UpdateProperties) => void) | undefined;
const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const tab = (id: number, url = `https://example.com/page-${id}`): chrome.tabs.Tab => ({
  id,
  url,
  title: `Page ${id}`,
  windowId: 1,
  index: id,
  active: id === 1,
  highlighted: id === 1,
  pinned: false,
  incognito: false,
  selected: id === 1,
  frozen: false,
  discarded: false,
  autoDiscardable: true,
  groupId: -1,
  lastAccessed: Date.now(),
});
const sender = (id: number): chrome.runtime.MessageSender => ({
  id: extensionId,
  url: tabs.get(id)?.url,
  tab: tabs.get(id),
});
const extensionSender = (): chrome.runtime.MessageSender => ({
  id: extensionId,
  url: `chrome-extension://${extensionId}/control.html`,
});
const event = () => ({ addListener: vi.fn() });
function storageArea(values: Record<string, unknown>, kind: "local" | "session") {
  return {
    get: vi.fn(async (keys: string | string[] | null) => {
      const selected =
        keys === null ? Object.keys(values) : typeof keys === "string" ? [keys] : keys;
      return structuredClone(
        Object.fromEntries(
          selected.filter((key) => key in values).map((key) => [key, values[key]]),
        ),
      );
    }),
    set: vi.fn(async (patch: Record<string, unknown>) => {
      if (kind === "session") await beforeSessionSave?.(patch);
      Object.assign(values, structuredClone(patch));
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of typeof keys === "string" ? [keys] : keys) delete values[key];
    }),
  };
}
function rpc(
  message: Record<string, unknown>,
  from: chrome.runtime.MessageSender = sender(1),
): Promise<Reply> {
  return new Promise((resolve) => {
    const handled = receive({ requestId: crypto.randomUUID(), ...message }, from, resolve);
    if (handled !== true) resolve({ ok: false, error: "Ignored envelope" });
  });
}
async function ok<T = unknown>(
  message: Record<string, unknown>,
  from?: chrome.runtime.MessageSender,
): Promise<T> {
  const result = await rpc(message, from);
  expect(result.ok, result.error).toBe(true);
  return result.data as T;
}
const snapshot = () => ok<CompanionSnapshot>({ type: "workspace.get" });
const handoff = (task: BrowserTask): SessionHandoff => ({
  taskId: task.id,
  goal: task.goal,
  fromUrl: "https://example.com/page-1",
  step: 4,
  at: Date.now(),
  history: [
    {
      action: { type: "note", text: "Read the source" },
      result: { ok: true, changed: true, message: "Saved a source note" },
      at: Date.now(),
    },
  ],
});

beforeEach(async () => {
  vi.resetModules();
  local = {
    [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, serverToken: "local-test-token", onboarded: true },
  };
  session = {};
  tabs = new Map([
    [1, tab(1)],
    [2, tab(2, "https://destination.example/workshop?private=query#anchor")],
  ]);
  nextTab = 100;
  beforeSessionSave = undefined;
  beforeTabUpdate = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        }),
    ),
  );
  vi.stubGlobal("chrome", {
    storage: {
      local: storageArea(local, "local"),
      session: storageArea(session, "session"),
      onChanged: event(),
    },
    runtime: {
      id: extensionId,
      onMessage: {
        addListener: (listener: Receive) => {
          receive = listener;
        },
      },
      onInstalled: event(),
      getURL: (path: string) => `chrome-extension://${extensionId}/${path}`,
      sendMessage: vi.fn(async () => ({ ok: true })),
    },
    tabs: {
      query: vi.fn(async (query: chrome.tabs.QueryInfo) =>
        [...tabs.values()].filter((t) =>
          query.active ? t.active : query.url ? !!t.url?.match(/^https?:/) : true,
        ),
      ),
      get: vi.fn(async (id: number) => {
        const found = tabs.get(id);
        if (!found) throw new Error("Missing tab");
        return structuredClone(found);
      }),
      create: vi.fn(async (properties: chrome.tabs.CreateProperties) => {
        const created = tab(nextTab++, properties.url);
        tabs.set(created.id!, created);
        return structuredClone(created);
      }),
      update: vi.fn(async (id: number, properties: chrome.tabs.UpdateProperties) => {
        beforeTabUpdate?.(id, properties);
        const updated = { ...tabs.get(id)!, ...properties };
        tabs.set(id, updated);
        return structuredClone(updated);
      }),
      sendMessage: vi.fn(async () => ({ ok: true })),
      goBack: vi.fn(async () => {}),
      captureVisibleTab: vi.fn(async () => "data:image/jpeg;base64,YQ=="),
      onActivated: event(),
      onRemoved: event(),
      onUpdated: event(),
      remove: vi.fn(async (id: number) => {
        tabs.delete(id);
      }),
    },
    windows: { update: vi.fn(async () => {}) },
    scripting: { executeScript: vi.fn(async () => []) },
    permissions: { contains: vi.fn(async () => true) },
    debugger: {
      attach: vi.fn(async () => {}),
      sendCommand: vi.fn(async () => {}),
      detach: vi.fn(async () => {}),
    },
    contextMenus: { onClicked: event(), removeAll: vi.fn(), create: vi.fn() },
    commands: { onCommand: event() },
  });
  await import("../apps/extension/src/background/index");
  await snapshot(); // Finish restart recovery before testing an explicit user action.
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("background ownership and handoff integration", () => {
  it("tells only the activated browser tab to restore its latest chat", async () => {
    vi.mocked(chrome.tabs.sendMessage).mockClear();
    vi.mocked(chrome.runtime.sendMessage).mockClear();
    const activate = vi.mocked(chrome.tabs.onActivated.addListener).mock.calls[0]![0];
    activate({ tabId: 2, windowId: 1 });
    await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledExactlyOnceWith(2, { type: "hypeman.tab.activated" }));
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
  it("persists continuation and transfers task ownership before a new tab navigates", async () => {
    const task = await ok<BrowserTask>({
      type: "task.start",
      goal: "Compare workshops",
      steps: ["Read both workshop sources", "Prepare the selected registration"],
      dispatch: false,
    });
    const continuation = handoff(task),
      conversation = [{ role: "user", text: "Compare two options" }];
    await ok({ type: "session.set", conversation });
    let blocked!: () => void, release!: () => void;
    const saving = new Promise<void>((resolve) => {
        blocked = resolve;
      }),
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
    beforeSessionSave = async (patch) => {
      if ("hypeman.tab.100" in patch) {
        blocked();
        await hold;
      }
    };
    beforeTabUpdate = (id, properties) => {
      if (properties.url) {
        expect(id).toBe(100);
        expect(session["hypeman.tab.100"]).toMatchObject({ handoff: continuation, conversation });
        expect(
          (local[WORKSPACE_KEY] as CompanionSnapshot).tasks.find((t) => t.id === task.id)?.tabId,
        ).toBe(id);
      }
    };
    const navigating = rpc({
      type: "nav.navigate",
      url: "https://destination.example/register",
      newTab: true,
      handoff: continuation,
    });
    await saving;
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "about:blank", active: true });
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    release();
    expect((await navigating).ok).toBe(true);
    expect((await snapshot()).tasks.find((t) => t.id === task.id)).toMatchObject({
      status: "running",
      tabId: 100,
    });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
      type: "hypeman.task.stopped",
      taskId: task.id,
    });
  });
  it("transfers history and conversation to an existing tab and rejects old-owner evidence", async () => {
    const task = await ok<BrowserTask>({
      type: "task.start",
      goal: "Read both options",
      steps: ["Read the first option", "Read the second option"],
      dispatch: false,
    });
    const continuation = handoff(task),
      conversation = [{ role: "assistant", text: "The first source is saved." }];
    await ok({ type: "session.set", conversation });
    expect(await rpc({ type: "nav.switch", tabId: 2, handoff: continuation })).toMatchObject({
      ok: false,
      error: "Enable other tab context before switching tabs with HypeMan.",
    });
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    await ok({ type: "settings.patch", patch: { tabContextEnabled: true } }, extensionSender());
    beforeTabUpdate = (id) => {
      expect(id).toBe(2);
      expect(session["hypeman.tab.2"]).toMatchObject({ handoff: continuation, conversation });
      expect(
        (local[WORKSPACE_KEY] as CompanionSnapshot).tasks.find((t) => t.id === task.id)?.tabId,
      ).toBe(2);
    };
    await ok({ type: "nav.switch", tabId: 2, handoff: continuation });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(2, {
      type: "hypeman.task.run",
      taskId: task.id,
      goal: task.goal,
      handoff: continuation,
    });
    expect(chrome.windows.update).toHaveBeenCalledWith(1, { focused: true });
    const evidence = {
      type: "task.progress",
      taskId: task.id,
      eventId: "next-tab-evidence",
      action: "observe",
      summary: "Read the second source",
      ok: true,
      changed: true,
      url: tabs.get(2)!.url,
      title: "Second option",
    };
    expect(await rpc(evidence, sender(1))).toMatchObject({
      ok: false,
      error: "This tab does not own the task.",
    });
    await ok(evidence, sender(2));
    expect((await snapshot()).events).toMatchObject([{ id: "next-tab-evidence", taskId: task.id }]);
  });
});

describe("conversation window session state", () => {
  const conversationId = "window-conversation";
  const geometry = (x = 20): WindowGeometrySnapshot => ({
    rect: { x, y: 30, width: 640, height: 480 }, minimized: false, maximized: false,
    restoreRect: null, userResized: true,
  });
  const ui = (): ConversationUIState => ({ open: true, tools: ["notes", "board"], active: "board", geometry: { chat: geometry(), board: geometry(80) } });
  const get = (id = conversationId, from = sender(1)) => ok<ConversationUIState | null>({ type: "workbench.ui.get", conversationId: id }, from);

  it("keeps window state in session storage without selecting conversations or replaying work", async () => {
    const workspaceBefore = await snapshot(), localBefore = structuredClone(local);
    expect(await get()).toBeNull();
    expect(await ok({ type: "workbench.ui.patch", conversationId, patch: ui() })).toEqual(ui());
    expect(await get(conversationId, sender(2))).toEqual(ui());
    expect(await get("another-conversation")).toBeNull();
    expect(session["hypeman.workbench.ui.window-conversation"]).toEqual(ui());
    expect(session["hypeman.tab.1"]).toBeUndefined();
    expect(local).toEqual(localBefore);
    expect(await snapshot()).toEqual(workspaceBefore);
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    vi.resetModules();
    await import("../apps/extension/src/background/index");
    expect(await get()).toEqual(ui());
  });

  it("serializes partial patches and merges geometry from independent windows", async () => {
    await ok({ type: "workbench.ui.patch", conversationId, patch: ui() });
    let blocked!: () => void, release!: () => void;
    const saving = new Promise<void>((resolve) => { blocked = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    let writes = 0;
    beforeSessionSave = async (patch) => {
      if (!("hypeman.workbench.ui.window-conversation" in patch)) return;
      writes++;
      if (writes === 1) { blocked(); await hold; }
    };
    const moving = ok({ type: "workbench.ui.patch", conversationId, patch: { geometry: { notes: geometry(120) } } });
    await saving;
    const closing = ok({ type: "workbench.ui.patch", conversationId, patch: { open: false, tools: ["notes"] } }, sender(2));
    const maximizing = ok({ type: "workbench.ui.patch", conversationId, patch: { geometry: { board: { ...geometry(40), maximized: true, restoreRect: geometry(80).rect } } } });
    release();
    await Promise.all([moving, closing, maximizing]);
    expect(await get()).toEqual({ open: false, tools: ["notes"], active: null,
      geometry: { chat: geometry(), notes: geometry(120), board: { ...geometry(40), maximized: true, restoreRect: geometry(80).rect } } });
    await ok({ type: "workbench.ui.patch", conversationId, patch: { geometry: { notes: null } } });
    expect((await get())!.geometry).toEqual({ chat: geometry(), board: { ...geometry(40), maximized: true, restoreRect: geometry(80).rect } });
  });

  it.each([false, true])("follows a conversation through navigation (new tab: %s)", async (newTab) => {
    session["hypeman.tab.1"] = { conversationId };
    await ok({ type: "workbench.ui.patch", conversationId, patch: ui() });
    const task = await ok<BrowserTask>({ type: "task.start", goal: "Read the source", steps: ["Read the source page", "Summarize the findings"], dispatch: false });
    await ok({ type: "nav.navigate", url: "https://source.example/read", newTab, handoff: { ...handoff(task), conversationId } });
    const targetId = newTab ? 100 : 1;
    const targetSession = await ok<{ conversationId: string }>({ type: "session.get" }, sender(targetId));
    expect(targetSession.conversationId).toBe(conversationId);
    const workspaceBefore = await snapshot();
    vi.mocked(chrome.tabs.sendMessage).mockClear();
    expect(await get(targetSession.conversationId, sender(targetId))).toEqual(ui());
    expect(await snapshot()).toEqual(workspaceBefore);
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("restores the shared state in an existing destination tab without changing its task", async () => {
    session["hypeman.tab.1"] = { conversationId };
    session["hypeman.tab.2"] = { conversationId: "old-destination-conversation" };
    await ok({ type: "workbench.ui.patch", conversationId, patch: ui() });
    await ok({ type: "workbench.ui.patch", conversationId: "old-destination-conversation", patch: { open: false, tools: ["video"] } }, sender(2));
    await ok({ type: "settings.patch", patch: { tabContextEnabled: true } }, extensionSender());
    const task = await ok<BrowserTask>({ type: "task.start", goal: "Read another source", steps: ["Read the other source", "Summarize the findings"], dispatch: false });
    await ok({ type: "nav.switch", tabId: 2, handoff: { ...handoff(task), conversationId } });
    const targetSession = await ok<{ conversationId: string }>({ type: "session.get" }, sender(2));
    expect(targetSession.conversationId).toBe(conversationId);
    const workspaceBefore = await snapshot();
    vi.mocked(chrome.tabs.sendMessage).mockClear();
    expect(await get(targetSession.conversationId, sender(2))).toEqual(ui());
    expect(await snapshot()).toEqual(workspaceBefore);
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(await get("old-destination-conversation", sender(2))).toMatchObject({ open: false, tools: ["video"] });
  });

  it("rejects untrusted state and geometry atomically and preserves the existing bridge caller check", async () => {
    await ok({ type: "workbench.ui.patch", conversationId, patch: ui() });
    for (const patch of [
      null, [], { open: "true" }, { tools: ["chat"] }, { tools: ["board", "board"] }, { active: "video" },
      { taskId: "replay" }, { geometry: { unknown: geometry() } }, { geometry: { board: { ...geometry(), minimized: "yes" } } },
      ...[NaN, Infinity, -Infinity, 100001].map((x) => ({ geometry: { board: { ...geometry(), rect: { ...geometry().rect, x } } } })),
      { geometry: { board: { ...geometry(), rect: { ...geometry().rect, width: 0 } } } },
      { geometry: { board: { ...geometry(), restoreRect: { ...geometry().rect, height: -1 } } } },
    ]) {
      expect(await rpc({ type: "workbench.ui.patch", conversationId, patch })).toMatchObject({ ok: false });
      expect(await get()).toEqual(ui());
    }
    expect(await rpc({ type: "workbench.ui.get", conversationId: "../invalid" })).toMatchObject({ ok: false });
    expect(await rpc({ type: "workbench.ui.patch", conversationId, patch: { open: false } }, { ...sender(1), id: "untrusted" })).toEqual({ ok: false, error: "Unknown caller" });
    expect(await get()).toEqual(ui());
    session["hypeman.workbench.ui.corrupt"] = { ...ui(), geometry: { board: { ...geometry(), rect: { ...geometry().rect, height: Infinity } } } };
    expect(await get("corrupt")).toBeNull();
    expect(await ok({ type: "workbench.ui.patch", conversationId: "corrupt", patch: { open: true } })).toEqual({ open: true, tools: [], active: null, geometry: {} });
  });
});

describe("conversation and project boundary", () => {
  const steps = ["Read the preparation guide", "Verify the completed preparation"];
  const project = () => ok<BrowserTask>({ type: "task.start", goal: "Prepare the workshop", steps, dispatch: false });
  const page = (text = "Preparation guide completed. You are ready for the next step."): PageSnapshot => ({
    url: tabs.get(1)!.url!, title: "Preparation guide", headings: ["Preparation guide"],
    text, elements: [], errors: [], successes: [], selection: "",
    frames: { count: 0, inaccessible: 0 }, capturedAt: Date.now(), revision: 1,
  });
  const assess = (task: BrowserTask, context = page(), requestId = crypto.randomUUID()) =>
    ok<{ task: BrowserTask; assessment: { stepId: string; completed: boolean; evidence: string }; assessmentId?: string }>({
      type: "task.assess", taskId: task.id, page: context, requestId,
    });
  const answer = (task: BrowserTask, completed = true, evidence = "Preparation guide completed.") => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      stepId: task.steps.find((step) => step.status !== "done")!.id, completed, evidence: completed ? evidence : "",
    }), { headers: { "content-type": "application/json" } }));
  };
  const verify = (task: BrowserTask, assessmentId: string, context = page(), from = sender(1)) =>
    rpc({ type: "task.step.verify", taskId: task.id, stepId: task.steps[0]!.id, assessmentId, page: context }, from);
  const explanation = (): AgentRequest => ({
    requestId: "selected-text-explanation", goal: "Explain the selected text in its page context.",
    message: "Explain the highlighted phrase using its surrounding page text.",
    mode: "browse", task: null, history: [],
    page: { ...page("A source excerpt describes neuroplasticity as the brain's ability to adapt."), selection: "neuroplasticity" },
  });
  const explainReply = { action: { type: "say", text: "Neuroplasticity is the brain's ability to adapt and form new connections." }, done: true, provider: "demo" };

  it("keeps a selected-text explanation independent of a running project in its owner tab", async () => {
    const task = await project(), before = await snapshot();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(explainReply), { headers: { "content-type": "application/json" } }));
    const input = explanation();
    // The worker strips stale project context even if a caller accidentally includes it.
    input.task = task;
    input.sources = [{ id: "project-source", taskId: task.id, text: "Project-only source", excerpt: "Project-only quote",
      url: tabs.get(1)!.url!, title: "Project source", createdAt: 1, updatedAt: 1 }];
    input.screenshot = "data:image/png;base64,YQ==";
    input.history = [{ action: { type: "note", text: "Project research" }, result: { ok: true, changed: true, message: "Saved" }, at: 1 }];
    input.page.elements = [{ id: "submit", name: "Submit", role: "button", tag: "button", disabled: false, sensitive: false, rect: { x: 0, y: 0, width: 100, height: 30 } }];
    expect(await ok({ type: "agent.decide", input, readOnly: true })).toEqual(explainReply);
    const sent = JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
    expect(sent).toMatchObject({ task: null, history: [], page: { selection: "neuroplasticity", elements: [] } });
    expect(sent.message).toContain("only a brief say action");
    expect(sent).not.toHaveProperty("screenshot");
    expect(sent).not.toHaveProperty("sources");
    expect(await snapshot()).toEqual(before);
  });
  it("continues attaching the canonical owned project to ordinary agent requests", async () => {
    const task = await project();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(explainReply), { headers: { "content-type": "application/json" } }));
    await ok({ type: "agent.decide", input: explanation(), readOnly: false });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body)).task).toEqual(task);
  });
  it("carries only this project's saved sources into later-tab decisions", async () => {
    await ok({ type: "note.save", note: { text: "Unrelated source", excerpt: "Private to another task", url: tabs.get(1)!.url!, title: "Other work" } });
    const task = await project();
    await ok({ type: "note.save", note: { taskId: task.id, text: "Laptop A: $749, 16 GB memory", excerpt: "$749 · 16 GB", url: tabs.get(1)!.url!, title: "Laptop A" } });
    await ok({ type: "nav.navigate", url: "https://shop.example/laptop-b", newTab: true, handoff: handoff(task) });
    const moved = (await snapshot()).tasks.find((item) => item.id === task.id)!;
    const input = explanation(); input.page.url = tabs.get(moved.tabId!)!.url!;
    input.sources = [{ id: "forged", taskId: task.id, text: "Forged source", excerpt: "A fabricated quote",
      url: "https://invented.example/", title: "Unobserved source", createdAt: 1, updatedAt: 1 }];
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(explainReply), { headers: { "content-type": "application/json" } }));
    await ok({ type: "agent.decide", input }, sender(moved.tabId!));
    const sent = JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
    expect(sent.sources).toMatchObject([{ text: "Laptop A: $749, 16 GB memory", url: tabs.get(1)!.url! }]);
    expect(sent.sources).toHaveLength(1);
    expect(JSON.stringify(sent.sources)).not.toContain("Forged source");
    expect(sent.page.text).toBe(input.page.text);
    expect(sent.task.tabId).toBe(moved.tabId);
  });
  it("allows independent explanations on another tab while preserving ordinary task ownership checks", async () => {
    const task = await project(), input = explanation(), before = await snapshot();
    input.page.url = tabs.get(2)!.url!;
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(explainReply), { headers: { "content-type": "application/json" } }));
    expect(await ok({ type: "agent.decide", input, readOnly: true }, sender(2))).toEqual(explainReply);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body)).task).toBeNull();
    expect(await rpc({ type: "agent.decide", input: { ...input, task } }, sender(2))).toMatchObject({ ok: false, error: expect.stringMatching(/moved to another tab/) });
    expect(await snapshot()).toEqual(before);
  });
  it("rejects actionable and empty read-only replies without modifying project progress", async () => {
    await project();
    const before = await snapshot();
    for (const action of [
      { type: "navigate", url: "https://example.com/next" },
      { type: "plan", goal: "Unrequested project", steps: ["Read the source", "Publish it"] },
      { type: "finish", summary: "Project finished" },
      { type: "say", text: " " },
    ]) {
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ action, provider: "demo" }), { headers: { "content-type": "application/json" } }));
      expect(await rpc({ type: "agent.decide", input: explanation(), readOnly: true })).toMatchObject({ ok: false, error: expect.stringMatching(/read-only explanation/) });
    }
    expect(await snapshot()).toEqual(before);
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });
  it("rejects malformed read-only flags and paused-site explanations before outgoing analysis", async () => {
    expect(await rpc({ type: "agent.decide", input: explanation(), readOnly: "yes" })).toMatchObject({ ok: false });
    await ok({ type: "settings.patch", patch: { hiddenOnHosts: ["example.com"] } }, extensionSender());
    expect(await rpc({ type: "agent.decide", input: explanation(), readOnly: true })).toMatchObject({ ok: false, error: expect.stringMatching(/paused/) });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects malformed saved source context before inference", async () => {
    const source = { id: "source", text: "A finding", excerpt: "A source quote", url: "https://example.com/source",
      title: "Source", createdAt: 1, updatedAt: 1 };
    for (const sources of [[{ ...source, url: "javascript:alert(1)" }], [{ ...source, createdAt: "yesterday" }], Array(13).fill(source)])
      expect(await rpc({ type: "agent.decide", input: { ...explanation(), sources } })).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("routes an ordinary rooftop request to the active page without storing a project", async () => {
    await ok({ type: "assistant.run", goal: "Explain this page" }, extensionSender());
    expect((await snapshot()).tasks).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
      type: "hypeman.assistant.run", goal: "Explain this page",
      handoff: expect.objectContaining({ goal: "Explain this page", history: [], step: 0 }),
    });
    expect((session["hypeman.tab.1"] as { handoff: SessionHandoff }).handoff.taskId).toBeUndefined();
  });
  it("persists a conversation handoff before opening a supplied URL", async () => {
    beforeTabUpdate = (id, properties) => {
      if (properties.url) expect(session[`hypeman.tab.${id}`]).toMatchObject({
        handoff: { goal: "Read this source", history: [], step: 0 },
      });
    };
    await ok({ type: "assistant.run", goal: "Read this source", url: "https://source.example/guide" }, extensionSender());
    expect(chrome.tabs.update).toHaveBeenCalledWith(100, { url: "https://source.example/guide" });
    expect((await snapshot()).tasks).toEqual([]);
  });
  it("uses real web search when no website is open, including workshop requests", async () => {
    tabs.clear();
    tabs.set(1, tab(1, `chrome-extension://${extensionId}/newtab.html`));
    await ok({ type: "assistant.run", goal: "Find a beginner workshop" }, extensionSender());
    expect(chrome.tabs.update).toHaveBeenCalledWith(100, {
      url: "https://www.google.com/search?q=Find%20a%20beginner%20workshop",
    });
    expect((await snapshot()).tasks).toEqual([]);
  });
  it("preserves an explicit starting link and conversation before navigation", async () => {
    await ok({ type: "assistant.run", goal: "Compare two options then prepare registration. Start at https://source.example/workshops/.", conversationId: "conversation-1" }, extensionSender());
    expect(chrome.tabs.update).toHaveBeenCalledWith(100, { url: "https://source.example/workshops/" });
    expect(session["hypeman.tab.100"]).toMatchObject({ conversationId: "conversation-1", handoff: { conversationId: "conversation-1" } });
  });
  it("rejects missing, single, and duplicate milestone plans without stopping the current project", async () => {
    const task = await project();
    vi.mocked(chrome.tabs.sendMessage).mockClear();
    for (const proposed of [undefined, ["One step"], ["Same step", "same step"]]) {
      expect(await rpc({ type: "task.start", goal: "An ordinary question", steps: proposed, dispatch: false }))
        .toMatchObject({ ok: false, error: "A project needs 2–20 distinct, specific steps." });
    }
    expect((await snapshot()).activeTaskId).toBe(task.id);
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
  it("restores the running project in its owner after ordinary manual navigation", async () => {
    const task = await project();
    tabs.set(1, tab(1, "https://example.com/next-chapter"));
    const restored = await ok<{ task: BrowserTask; handoff?: SessionHandoff }>({ type: "session.get" });
    expect(restored.task.id).toBe(task.id);
    expect(restored.handoff).toBeUndefined();
    expect(await ok({ type: "session.get" }, sender(2))).toMatchObject({ task: null });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("can transfer a project to the current tab for observation without running browser actions", async () => {
    const task = await project();
    vi.mocked(chrome.tabs.sendMessage).mockClear();
    const followed = await ok<BrowserTask>({ type: "task.follow", id: task.id }, sender(2));
    expect(followed).toMatchObject({ id: task.id, tabId: 2, status: "running" });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(2, { type: "hypeman.task.follow", taskId: task.id });
    expect(vi.mocked(chrome.tabs.sendMessage).mock.calls.some(([, event]) =>
      !!event && typeof event === "object" && "type" in event && event.type === "hypeman.task.run",
    )).toBe(false);
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps uncertain assessment separate from milestone completion", async () => {
    const task = await project(); answer(task, false);
    expect(await assess(task)).toMatchObject({ task: { id: task.id }, assessment: { completed: false, evidence: "" } });
    expect((await snapshot()).tasks[0]!.steps[0]!.status).toBe("doing");
    expect((await snapshot()).events).toEqual([]);
  });
  it("requires a fresh second observation before committing a quote-backed milestone", async () => {
    const task = await project(); answer(task);
    const result = await assess(task);
    expect(result.assessmentId).toBeTruthy();
    expect((await snapshot()).tasks[0]!.steps[0]!.status).toBe("doing");
    expect((await verify(task, result.assessmentId!)).ok).toBe(true);
    const saved = await snapshot();
    expect(saved.tasks[0]!.steps.map((step) => step.status)).toEqual(["done", "doing"]);
    expect(saved.events).toMatchObject([{ action: "milestone", stepId: task.steps[0]!.id }]);
    expect(saved.tasks[0]!.status).toBe("running");
  });
  it("rejects invented completion quotes and keeps all milestones unchanged", async () => {
    const task = await project(); answer(task, true, "A completion that is not on the page.");
    expect(await rpc({ type: "task.assess", taskId: task.id, page: page() })).toMatchObject({ ok: false });
    expect((await snapshot()).events).toEqual([]);
  });
  it("discards a prepared completion when the current page text changes", async () => {
    const task = await project(); answer(task);
    const result = await assess(task);
    expect(await verify(task, result.assessmentId!, page("A different question is visible now."))).toMatchObject({ ok: false });
    expect(await verify(task, result.assessmentId!)).toMatchObject({ ok: false });
    expect((await snapshot()).tasks[0]!.steps[0]!.status).toBe("doing");
  });
  it("expires prepared evidence after thirty seconds", async () => {
    const task = await project(); answer(task);
    const result = await assess(task);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
    try { expect(await verify(task, result.assessmentId!)).toMatchObject({ ok: false }); }
    finally { clock.mockRestore(); }
    expect((await snapshot()).events).toEqual([]);
  });
  it("cancels prepared evidence using the original assessment request ID", async () => {
    const task = await project(); answer(task);
    const result = await assess(task);
    expect(await ok({ type: "request.cancel", requestId: result.assessmentId })).toEqual({ cancelled: true });
    expect(await verify(task, result.assessmentId!)).toMatchObject({ ok: false });
    expect((await snapshot()).events).toEqual([]);
  });
  it("rejects other-tab and paused-site assessment before any outgoing page request", async () => {
    const task = await project();
    expect(await rpc({ type: "task.assess", taskId: task.id, page: page() }, sender(2))).toMatchObject({ ok: false });
    await ok({ type: "settings.patch", patch: { hiddenOnHosts: ["example.com"] } }, extensionSender());
    expect(await rpc({ type: "task.assess", taskId: task.id, page: page() })).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("accepts user confirmation only for the current milestone in the owner tab", async () => {
    const task = await project();
    expect(await rpc({ type: "task.step.confirm", taskId: task.id, stepId: task.steps[1]!.id })).toMatchObject({ ok: false });
    expect(await rpc({ type: "task.step.confirm", taskId: task.id, stepId: task.steps[0]!.id }, sender(2))).toMatchObject({ ok: false });
    await ok({ type: "task.step.confirm", taskId: task.id, stepId: task.steps[0]!.id });
    const updated = await ok<BrowserTask>({ type: "task.step.confirm", taskId: task.id, stepId: task.steps[1]!.id });
    expect(updated.status).toBe("completed");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("background privacy and validation boundary", () => {
  it("opens requested collections inside the active website companion without creating a dashboard tab", async () => {
    await ok({ type: "control.open", section: "notes" }, extensionSender());
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
      type: "hypeman.command", name: "open-tools", section: "notes",
    });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("opens the rooftop collection without contacting a paused website", async () => {
    await ok({ type: "settings.patch", patch: { hiddenOnHosts: ["example.com"] } }, extensionSender());
    vi.mocked(chrome.tabs.sendMessage).mockClear();
    await ok({ type: "control.open", section: "settings" }, extensionSender());
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: `chrome-extension://${extensionId}/newtab.html#settings`,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([["board.open", "board"], ["tablet.open", "board"]])("%s opens a tool over the current webpage", async (type, section) => {
    await ok({ type }, extensionSender());
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, { type: "hypeman.command", name: "open-tools", section });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reuses an active rooftop tab for inline tools on protected extension pages", async () => {
    tabs.set(1, tab(1, `chrome-extension://${extensionId}/newtab.html`));
    await ok({ type: "control.open", section: "activity" }, extensionSender());
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.tabs.update).toHaveBeenCalledWith(1, {
      url: `chrome-extension://${extensionId}/newtab.html#activity`,
    });
  });
  it("rejects paused-site page work before fetching and excludes paused tabs from optional context", async () => {
    await ok(
      {
        type: "settings.patch",
        patch: { hiddenOnHosts: ["example.com"], tabContextEnabled: true },
      },
      extensionSender(),
    );
    for (const message of [
      { type: "agent.decide", input: {} },
      { type: "api", path: "/api/video", body: {} },
      { type: "screenshot" },
    ])
      expect(await rpc(message, sender(1))).toMatchObject({
        ok: false,
        error: "HypeMan is paused on this site.",
      });
    const contexts = await ok<{ id: number; url: string }[]>(
      { type: "tabs.list" },
      extensionSender(),
    );
    expect(contexts).toEqual([
      { id: 2, title: "Page 2", url: "https://destination.example/workshop" },
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects malformed extension messages without executing actions or forwarding requests", async () => {
    const respond = vi.fn();
    expect(receive({ type: 7 }, sender(1), respond)).toBeUndefined();
    expect(respond).not.toHaveBeenCalled();
    expect(await rpc({ type: "nav.navigate", url: "javascript:alert(1)" })).toMatchObject({
      ok: false,
    });
    expect(await rpc({ type: "nav.switch", tabId: "2" })).toMatchObject({ ok: false });
    expect(await rpc({ type: "agent.decide", input: { requestId: "broken" } })).toMatchObject({
      ok: false,
      error: "Invalid page context.",
    });
    expect(await rpc({ type: "api", path: "/api/arbitrary", body: {} })).toMatchObject({
      ok: false,
      error: "Unknown capability.",
    });
    expect(
      await rpc({ type: "session.set", handoff: { goal: "continue", history: "invalid" } }),
    ).toMatchObject({ ok: false, error: "Invalid continuation." });
    expect(await rpc({ type: "workspace.get" }, { id: "another-extension" })).toMatchObject({
      ok: false,
      error: "Unknown caller",
    });
    expect(await rpc({ type: "workspace.get", payload: "x".repeat(8_000_001) })).toMatchObject({
      ok: false,
      error: "Request too large",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

describe("ChatGPT sign-in extension boundary", () => {
  const status = {
    connected: true,
    sharing: true,
    activeProfileId: "personal",
    pending: false,
    profiles: [
      {
        id: "personal",
        label: "Personal",
        email: "hypeman@example.com",
        connected: true,
        sharing: true,
      },
    ],
    models: [{ slug: "gpt-test", displayName: "Test model" }],
    model: "gpt-test",
  };
  it("rejects account requests from content scripts and through the generic API transport", async () => {
    for (const type of ["status", "login", "cancel", "logout", "select", "model"])
      expect(
        await rpc({ type: `chatgpt.${type}`, profileId: "personal", model: "gpt-test" }),
      ).toMatchObject({
        ok: false,
        error: "Manage ChatGPT sign-in from HypeMan’s Connection page or Settings.",
      });
    expect(
      await rpc({ type: "api", path: "/api/chatgpt/status", body: {} }, extensionSender()),
    ).toMatchObject({
      ok: false,
      error: "Unknown capability.",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });
  it("uses the paired local transport and exposes only account status fields", async () => {
    const stored = structuredClone(local);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...status,
          accessToken: "secret-access-token",
          refreshToken: "secret-refresh-token",
          profiles: [{ ...status.profiles[0], tokens: { access: "secret-profile-token" } }],
          models: [{ ...status.models[0], extra: "internal" }],
        }),
      ),
    );
    expect(await ok({ type: "chatgpt.status" }, extensionSender())).toEqual(status);
    expect(fetch).toHaveBeenCalledWith(
      `${DEFAULT_SETTINGS.serverUrl}/api/chatgpt/status`,
      expect.objectContaining({
        method: "POST",
        body: "{}",
        headers: expect.objectContaining({ authorization: "Bearer local-test-token" }),
      }),
    );
    expect(local).toEqual(stored);
    expect(JSON.stringify(session)).not.toContain("secret-");
  });
  it("opens the trusted ChatGPT authorization page without returning its URL or saving tokens", async () => {
    const url =
      "https://auth.openai.com/api/accounts/authorize?state=test-state&code_challenge=test-challenge";
    const stored = structuredClone(local);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ url, token: "must-stay-local" })),
    );
    expect(await ok({ type: "chatgpt.login", newProfile: true }, extensionSender())).toEqual({
      pending: true,
    });
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url, active: true });
    expect(fetch).toHaveBeenCalledWith(
      `${DEFAULT_SETTINGS.serverUrl}/api/chatgpt/login`,
      expect.objectContaining({
        body: JSON.stringify({ newProfile: true }),
      }),
    );
    expect(local).toEqual(stored);
    expect(JSON.stringify(session)).not.toContain("must-stay-local");
  });
  it("rejects unexpected sign-in URLs and cancels their local pending flow", async () => {
    for (const url of [
      "https://auth.openai.com.attacker.example/api/accounts/authorize",
      "https://attacker.example/api/accounts/authorize",
      "http://auth.openai.com/api/accounts/authorize",
      "https://user:password@auth.openai.com/api/accounts/authorize",
      "https://auth.openai.com/api/accounts/authorize#secret",
      "https://auth.openai.com/unexpected",
      "javascript:alert(1)",
    ]) {
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ url })));
      const result = await rpc({ type: "chatgpt.login" }, extensionSender());
      expect(result.ok).toBe(false);
      expect(fetch).toHaveBeenLastCalledWith(
        `${DEFAULT_SETTINGS.serverUrl}/api/chatgpt/cancel`,
        expect.objectContaining({ body: "{}" }),
      );
    }
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });
  it("validates account and model choices and sends only the intended mutation body", async () => {
    for (const action of [
      { type: "chatgpt.select", profileId: "" },
      { type: "chatgpt.model", model: 7 },
      { type: "chatgpt.login", profileId: "personal", newProfile: true },
      { type: "chatgpt.login", newProfile: "yes" },
    ])
      expect((await rpc(action, extensionSender())).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    await ok(
      { type: "chatgpt.select", profileId: "personal", accessToken: "ignored" },
      extensionSender(),
    );
    expect(fetch).toHaveBeenLastCalledWith(
      `${DEFAULT_SETTINGS.serverUrl}/api/chatgpt/select`,
      expect.objectContaining({ body: JSON.stringify({ profileId: "personal" }) }),
    );
    await ok({ type: "chatgpt.model", model: "gpt-test" }, extensionSender());
    expect(fetch).toHaveBeenLastCalledWith(
      `${DEFAULT_SETTINGS.serverUrl}/api/chatgpt/model`,
      expect.objectContaining({ body: JSON.stringify({ model: "gpt-test" }) }),
    );
    await ok({ type: "chatgpt.cancel" }, extensionSender());
    expect(fetch).toHaveBeenLastCalledWith(
      `${DEFAULT_SETTINGS.serverUrl}/api/chatgpt/cancel`,
      expect.objectContaining({ body: "{}" }),
    );
    await ok({ type: "chatgpt.logout" }, extensionSender());
    expect(fetch).toHaveBeenLastCalledWith(
      `${DEFAULT_SETTINGS.serverUrl}/api/chatgpt/logout`,
      expect.objectContaining({ body: "{}" }),
    );
  });
});

describe("phone companion extension boundary", () => {
  const capture = { id: "phone-goal", kind: "goal", text: "Compare the pottery workshops", url: "https://workshops.example/", createdAt: 1 };
  const phoneStatus = () => ({
    configured: true, connected: true, paired: true, ownerPhone: "+12125551234", lastSyncedAt: Date.now(),
    settings: { ...DEFAULT_MESSAGING_SETTINGS }, captures: [capture], reminders: [], commitments: [], deliveries: [],
  });
  const reply = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });

  it("requires extension UI for phone management and keeps it outside generic API access", async () => {
    for (const type of ["status", "inbox", "pair", "unpair", "settings", "reminders", "continue", "dismiss"])
      expect(await rpc({ type: `messaging.${type}`, phone: "+12125551234", id: capture.id })).toMatchObject({
        ok: false, error: "Manage your phone companion from HypeMan’s Settings.",
      });
    expect(await rpc({ type: "api", path: "/api/messaging/send", body: { text: "Unexpected" } }, extensionSender())).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });
  it("allows a saved-note text from the overlay to the paired owner and strips recipients", async () => {
    const receipt = { id: "manual:receipt", text: "A saved finding", status: "sent", at: Date.now() };
    vi.mocked(fetch).mockResolvedValueOnce(reply({ ...phoneStatus(), deliveries: [{ ...receipt, phone: "+12125551234", providerId: "private-provider-id" }], token: "private" }));
    const result = await ok<{ ownerPhone: string; deliveries: unknown[] }>({ type: "messaging.send", text: " A saved finding ", recipient: "+19999999999" });
    expect(result).toMatchObject({ ownerPhone: "+12125551234", deliveries: [receipt] });
    expect(result.deliveries[0]).toEqual(receipt);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(fetch).toHaveBeenLastCalledWith(`${DEFAULT_SETTINGS.serverUrl}/api/messaging/send`, expect.objectContaining({
      body: JSON.stringify({ text: "A saved finding" }),
      headers: expect.objectContaining({ authorization: "Bearer local-test-token" }),
    }));
  });
  it("rejects malformed phone management input before contacting the gateway", async () => {
    for (const message of [
      { type: "messaging.pair", phone: "not-a-number" },
      { type: "messaging.send", text: " " },
      { type: "messaging.send", text: "x".repeat(6001) },
      { type: "messaging.settings", patch: { timezone: "Nowhere/Unknown" } },
      { type: "messaging.settings", patch: { morningTime: "27:00" } },
      { type: "messaging.settings", patch: { token: "private" } },
      { type: "messaging.reminders", operation: "snooze", id: "reminder", minutes: 0 },
      { type: "messaging.reminders", operation: "send", id: "reminder" },
      { type: "messaging.inbox", refresh: "false" },
    ]) expect(await rpc(message, extensionSender())).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("returns phone pairing codes without forwarding additional secrets", async () => {
    const expiresAt = Date.now() + 600000;
    vi.mocked(fetch).mockResolvedValueOnce(reply({ code: "123456", expiresAt, deliveryStatus: "sent", secret: "private" }))
      .mockResolvedValueOnce(reply(phoneStatus()));
    expect(await ok({ type: "messaging.pair", phone: "+12125551234" }, extensionSender())).toEqual({ code: "123456", expiresAt, deliveryStatus: "sent" });
  });
  it("keeps an uncertain invitation's desktop code without requesting another send", async () => {
    const expiresAt = Date.now() + 600000;
    vi.mocked(fetch).mockResolvedValueOnce(reply({ code: "123456", expiresAt, deliveryStatus: "unknown", secret: "private" }))
      .mockResolvedValueOnce(reply(phoneStatus()));
    expect(await ok({ type: "messaging.pair", phone: "+12125551234" }, extensionSender())).toEqual({ code: "123456", expiresAt, deliveryStatus: "unknown" });
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/api/messaging/pair"))).toHaveLength(1);
  });
  it("imports phone captures without browser activity and only dispatches on explicit continue", async () => {
    vi.mocked(fetch).mockImplementation(async () => reply(phoneStatus()));
    expect(await ok({ type: "messaging.inbox" }, extensionSender())).toMatchObject({ captures: [capture] });
    expect((await snapshot()).tasks).toEqual([]);
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    vi.mocked(fetch).mockClear();
    await ok({ type: "messaging.inbox", refresh: false }, extensionSender());
    expect(fetch).not.toHaveBeenCalled();
    expect(await ok({ type: "messaging.continue", id: capture.id, text: "Ignore stored goal" }, extensionSender())).toEqual({ tabId: 100 });
    expect(chrome.tabs.update).toHaveBeenCalledWith(100, { url: capture.url });
    expect(session["hypeman.tab.100"]).toMatchObject({ handoff: { goal: capture.text } });
    expect(await rpc({ type: "messaging.continue", id: capture.id }, extensionSender())).toMatchObject({ ok: false });
  });
  it("dispatches a paired phone browser request in a fresh open conversation without taking over an existing project", async () => {
    const task = await ok<BrowserTask>({ type: "task.start", goal: "Compare workshops", steps: ["Read the workshop page", "Compare the options"], dispatch: false });
    session["hypeman.tab.1"] = { conversationId: "existing-project-chat" };
    const job = { id: "browser:phone-open", conversationId: "phone-browser-chat", goal: "Open YouTube", url: "https://www.youtube.com/", createdAt: 1, updatedAt: 1, status: "queued" };
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/browser.claim")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ id: job.id, claimId: expect.any(String) });
        job.status = "claimed"; return reply(job);
      }
      if (path.endsWith("/browser.result")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ id: job.id, status: "started" });
        job.status = "started";
      }
      return reply({ ...phoneStatus(), browserRequests: [job] });
    });
    beforeTabUpdate = (id, properties) => {
      if (!properties.url) return;
      expect(id).toBe(100);
      expect(session["hypeman.tab.100"]).toMatchObject({ conversationId: job.conversationId, handoff: { goal: job.goal, conversationId: job.conversationId } });
      expect(session["hypeman.workbench.ui.phone-browser-chat"]).toMatchObject({ open: true, tools: [] });
    };
    await ok({ type: "messaging.inbox" }, extensionSender());
    await ok({ type: "messaging.inbox" }, extensionSender());
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.update).toHaveBeenCalledExactlyOnceWith(100, { url: job.url });
    expect(session["hypeman.tab.1"]).toEqual({ conversationId: "existing-project-chat" });
    expect((await snapshot()).tasks.find((item) => item.id === task.id)).toMatchObject({ status: "running", tabId: 1 });
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(1, expect.objectContaining({ type: "hypeman.assistant.run" }));
    expect(await rpc({ type: "messaging.browser.claim", id: job.id })).toMatchObject({ ok: false, error: "Manage your phone companion from HypeMan’s Settings." });
  });
  it("uses durable local inbox contents when the gateway is unavailable", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply(phoneStatus()));
    await ok({ type: "messaging.inbox" }, extensionSender());
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("offline"));
    expect(await ok({ type: "messaging.inbox" }, extensionSender())).toMatchObject({ captures: [capture], status: null, error: "Start HypeMan’s local server, then retry." });
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });
  it("syncs on worker startup and minute alarms without dispatching browser actions", async () => {
    vi.mocked(fetch).mockImplementation(async () => reply(phoneStatus()));
    const onAlarm = event(), onStartup = event();
    Object.assign(chrome, { alarms: { create: vi.fn(async () => {}), onAlarm } });
    Object.assign(chrome.runtime, { onStartup });
    vi.resetModules();
    await import("../apps/extension/src/background/index");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(chrome.alarms.create).toHaveBeenCalledWith("hypeman.messaging.sync", { periodInMinutes: 0.5 });
    await vi.waitFor(() => expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "hypeman.messaging.changed" })));
    const alarm = onAlarm.addListener.mock.calls[0]![0] as (value: chrome.alarms.Alarm) => void;
    alarm({ name: "hypeman.messaging.sync", scheduledTime: Date.now(), persistAcrossSessions: true });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });
});
