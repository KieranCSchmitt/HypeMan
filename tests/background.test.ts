import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  WORKSPACE_KEY,
  type BrowserTask,
  type CompanionSnapshot,
  type SessionHandoff,
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
  it("persists continuation and transfers task ownership before a new tab navigates", async () => {
    const task = await ok<BrowserTask>({
      type: "task.start",
      goal: "Compare workshops",
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
      if ("burrow.tab.100" in patch) {
        blocked();
        await hold;
      }
    };
    beforeTabUpdate = (id, properties) => {
      if (properties.url) {
        expect(id).toBe(100);
        expect(session["burrow.tab.100"]).toMatchObject({ handoff: continuation, conversation });
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
      type: "burrow.task.stopped",
      taskId: task.id,
    });
  });
  it("transfers history and conversation to an existing tab and rejects old-owner evidence", async () => {
    const task = await ok<BrowserTask>({
      type: "task.start",
      goal: "Read both options",
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
      expect(session["burrow.tab.2"]).toMatchObject({ handoff: continuation, conversation });
      expect(
        (local[WORKSPACE_KEY] as CompanionSnapshot).tasks.find((t) => t.id === task.id)?.tabId,
      ).toBe(2);
    };
    await ok({ type: "nav.switch", tabId: 2, handoff: continuation });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(2, {
      type: "burrow.task.run",
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

describe("background privacy and validation boundary", () => {
  it("opens requested collections inside the active website companion without creating a dashboard tab", async () => {
    await ok({ type: "control.open", section: "notes" }, extensionSender());
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
      type: "burrow.command", name: "open-tools", section: "notes",
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
  it.each([["board.open", "board"], ["tablet.open", "board"], ["notebook.open", "notebook"]])("%s opens a tool over the current webpage", async (type, section) => {
    await ok({ type }, extensionSender());
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, { type: "burrow.command", name: "open-tools", section });
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
        email: "rabbit@example.com",
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
