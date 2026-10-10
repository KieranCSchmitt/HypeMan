import {
  WorkspaceHost,
  WORKSPACE_KEY,
  isPaused,
  safePageUrl,
  parseAgentRequest,
  isRecord,
  type BrowserTask,
  type AgentReply,
  type SessionHandoff,
  type TaskProgress,
  type NoteInput,
  type ChatGPTStatus,
} from "@core";
import { GatewayClient } from "./client";
import {
  settings,
  patchSettings,
  saveConnection,
  graph,
  learn,
  savePlan,
  clearLearning,
  characters,
  saveCharacter,
  removeCharacter,
} from "./storage";

const workspace = new WorkspaceHost({
  async load() {
    return (await chrome.storage.local.get(WORKSPACE_KEY))[WORKSPACE_KEY];
  },
  async save(value) {
    await chrome.storage.local.set({ [WORKSPACE_KEY]: value });
  },
});
const gateway = new GatewayClient(settings, globalThis.fetch.bind(globalThis), saveConnection);
const ready = (async () => {
  const raw = await chrome.storage.session.get("burrow.session");
  if (!raw["burrow.session"]) {
    await workspace.recover();
    await chrome.storage.session.set({ "burrow.session": true });
  }
})();
const tabSessionKey = (id: number) => `burrow.tab.${id}`;
const loginReturnKey = "hypeman.chatgpt.return";
const sessionWrites = new Map<number, Promise<unknown>>();
const jsonSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "HypeMan couldn't complete that request.";

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  return (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0] ?? null;
}
async function notify(
  type: string,
  payload: Record<string, unknown> = {},
  tabId?: number | null,
): Promise<void> {
  const event = { ...payload, type: `burrow.${type}` };
  if (tabId !== undefined && tabId !== null) {
    await chrome.tabs.sendMessage(tabId, event).catch(() => {});
    return;
  }
  await chrome.runtime.sendMessage(event).catch(() => {});
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  await Promise.all(
    tabs.map((t) =>
      t.id === undefined ? undefined : chrome.tabs.sendMessage(t.id, event).catch(() => {}),
    ),
  );
}
const companionSections = new Set(["tasks", "notes", "activity", "settings", "learning", "board", "video", "customize", "notebook", "connection"]);
async function openCompanion(section: unknown = "tasks") {
  const selected = typeof section === "string" && companionSections.has(section) ? section : "tasks";
  const tab = await activeTab();
  if (tab?.id !== undefined && safePageUrl(tab.url) && !isPaused(await settings(), tab.url ?? "")) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "burrow.command", name: "open-tools", section: selected });
      return;
    } catch { /* Open the same inline tools on the rooftop if this page has no content script. */ }
  }
  const home = chrome.runtime.getURL("newtab.html");
  if (tab?.id !== undefined && (tab.url?.startsWith(home) || tab.url === "chrome://newtab/"))
    await chrome.tabs.update(tab.id, { url: `${home}#${selected}` });
  else await chrome.tabs.create({ url: `${home}#${selected}` });
}
async function session(id: number): Promise<Record<string, unknown>> {
  const raw = (await chrome.storage.session.get(tabSessionKey(id)))[tabSessionKey(id)];
  return isRecord(raw) ? raw : {};
}
async function setSession(id: number, patch: Record<string, unknown>): Promise<void> {
  const operation = (sessionWrites.get(id) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      await chrome.storage.session.set({
        [tabSessionKey(id)]: { ...(await session(id)), ...patch, updatedAt: Date.now() },
      });
    });
  sessionWrites.set(id, operation);
  try {
    await operation;
  } finally {
    if (sessionWrites.get(id) === operation) sessionWrites.delete(id);
  }
}
async function stopTask(task: BrowserTask | undefined): Promise<void> {
  if (!task) return;
  if (task.tabId !== null) {
    gateway.cancelOwner(task.tabId);
    await notify("task.stopped", { taskId: task.id }, task.tabId);
  }
}
async function dispatchTask(
  task: BrowserTask,
  source: chrome.tabs.Tab | null,
  url?: string,
): Promise<BrowserTask> {
  const targetUrl = safePageUrl(url) || task.lastPage?.url;
  if (
    source?.id !== undefined &&
    safePageUrl(source.url) &&
    (!targetUrl || targetUrl === source.url)
  ) {
    if (isPaused(await settings(), source.url!))
      throw new Error("Resume HypeMan on this site first.");
    const owned = await workspace.resume(task.id, source.id);
    try {
      await chrome.tabs.sendMessage(source.id, {
        type: "burrow.task.run",
        taskId: task.id,
        goal: task.goal,
      });
    } catch {
      await setSession(source.id, {
        handoff: { taskId: task.id, goal: task.goal, history: [], step: 0, at: Date.now() },
      });
      await chrome.scripting.executeScript({ target: { tabId: source.id }, files: ["content.js"] });
    }
    return owned;
  }
  const config = await settings();
  const destination =
    targetUrl ||
    (/workshop/i.test(task.goal)
      ? `${config.serverUrl}/demo/workshops/`
      : `https://www.google.com/search?q=${encodeURIComponent(task.goal)}`);
  if (isPaused(config, destination)) throw new Error("HypeMan is paused on the destination site.");
  // Create blank first: the resume payload exists before a content script can hydrate.
  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  if (tab.id === undefined) throw new Error("Couldn't open a browser tab.");
  const owned = await workspace.resume(task.id, tab.id);
  await setSession(tab.id, {
    handoff: { taskId: task.id, goal: task.goal, history: [], step: 0, at: Date.now() },
  });
  await chrome.tabs.update(tab.id, { url: destination });
  return owned;
}
const API_PATHS = new Set([
  "/api/learn/plan",
  "/api/learn/judge",
  "/api/learn/teachback",
  "/api/video",
  "/api/ink",
  "/api/notebook",
  "/api/character",
  "/api/lookup",
]);
const PAGE_WORK = new Set([
  "agent.decide",
  "api",
  "input",
  "screenshot",
  "nav.navigate",
  "nav.back",
  "nav.switch",
  "learn.event",
  "tabs.list",
]);
function isExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  try {
    const url = new URL(sender.url ?? "");
    return url.protocol === "chrome-extension:" && url.hostname === chrome.runtime.id;
  } catch {
    return false;
  }
}
/** Keep credentials and unexpected gateway fields outside the UI message boundary. */
function safeChatGPTStatus(value: unknown): ChatGPTStatus {
  if (
    !isRecord(value) ||
    typeof value.connected !== "boolean" ||
    typeof value.sharing !== "boolean" ||
    typeof value.pending !== "boolean" ||
    !(value.activeProfileId === null || typeof value.activeProfileId === "string") ||
    !Array.isArray(value.profiles) ||
    value.profiles.length > 100
  )
    throw new Error("Invalid ChatGPT connection status.");
  const profiles = value.profiles.map((profile) => {
    if (
      !isRecord(profile) ||
      typeof profile.id !== "string" ||
      typeof profile.label !== "string" ||
      typeof profile.connected !== "boolean" ||
      typeof profile.sharing !== "boolean"
    )
      throw new Error("Invalid ChatGPT account status.");
    return {
      id: profile.id,
      label: profile.label,
      ...(typeof profile.email === "string" ? { email: profile.email } : {}),
      connected: profile.connected,
      sharing: profile.sharing,
    };
  });
  const models = Array.isArray(value.models)
    ? value.models.map((model) => {
        if (
          !isRecord(model) ||
          typeof model.slug !== "string" ||
          typeof model.displayName !== "string"
        )
          throw new Error("Invalid ChatGPT model status.");
        return { slug: model.slug, displayName: model.displayName };
      })
    : undefined;
  return {
    connected: value.connected,
    sharing: value.sharing,
    pending: value.pending,
    activeProfileId: value.activeProfileId,
    profiles,
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    ...(typeof value.warning === "string" ? { warning: value.warning } : {}),
    ...(models ? { models } : {}),
    ...(typeof value.model === "string" ? { model: value.model } : {}),
  };
}
function chatGPTChoice(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 200 ||
    /[\u0000-\u001f]/.test(value)
  )
    throw new Error(`Choose a valid ChatGPT ${label}.`);
  return value;
}
async function handle(
  message: Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  await ready;
  const type = message.type,
    id = typeof message.requestId === "string" ? message.requestId : crypto.randomUUID();
  const tabId = sender.tab?.id ?? null;
  const config = await settings();
  if (typeof type !== "string") throw new Error("Invalid request");
  if ((type.startsWith("chatgpt.") || type === "connection.ensure") && !isExtensionPage(sender))
    throw new Error("Manage ChatGPT sign-in from HypeMan’s Connection page or Settings.");
  if (PAGE_WORK.has(type) && isPaused(config, sender.tab?.url ?? sender.url ?? ""))
    throw new Error("HypeMan is paused on this site.");
  switch (type) {
    case "workspace.get":
      return workspace.snapshot();
    case "settings.get":
      return config;
    case "settings.patch": {
      const updated = await patchSettings(message.patch);
      await notify("settings.changed", { settings: updated });
      if (updated.hiddenOnHosts.some((host) => !config.hiddenOnHosts.includes(host))) {
        for (const tab of await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }))
          if (tab.id !== undefined && isPaused(updated, tab.url ?? "")) gateway.cancelOwner(tab.id);
        const state = await workspace.snapshot(),
          current = state.tasks.find((t) => t.id === state.activeTaskId);
        if (current?.tabId !== null && current?.tabId !== undefined) {
          const tab = await chrome.tabs.get(current.tabId).catch(() => null);
          if (tab && isPaused(updated, tab.url ?? "")) {
            await stopTask(current);
            await workspace.pause(current.id);
          }
        }
      }
      return updated;
    }
    case "health":
      return gateway.post("/health", undefined, id, tabId, 4000);
    case "pair.check":
      await gateway.post("/api/cancel", { requestId: "burrow-pair-check" }, id, tabId, 4000);
      return { paired: true };
    case "connection.ensure":
      await gateway.post("/api/cancel", { requestId: "hypeman-connection-check" }, id, tabId, 4000);
      return gateway.post("/health", undefined, id, tabId, 4000);
    case "chatgpt.status":
      return safeChatGPTStatus(await gateway.post("/api/chatgpt/status", {}, id, tabId, 45000));
    case "chatgpt.login": {
      if (message.newProfile !== undefined && typeof message.newProfile !== "boolean")
        throw new Error("Choose whether to add a ChatGPT account.");
      const profileId =
        message.profileId === undefined ? undefined : chatGPTChoice(message.profileId, "account");
      if (profileId && message.newProfile === true)
        throw new Error("Choose a saved account or add a new one.");
      const result = await gateway.post<unknown>(
        "/api/chatgpt/login",
        {
          ...(profileId ? { profileId } : {}),
          ...(message.newProfile === true ? { newProfile: true } : {}),
        },
        id,
        tabId,
        10000,
      );
      try {
        if (!isRecord(result) || typeof result.url !== "string")
          throw new Error("The local server returned an invalid ChatGPT sign-in address.");
        const url = new URL(result.url);
        if (
          url.origin !== "https://auth.openai.com" ||
          url.pathname !== "/api/accounts/authorize" ||
          url.username ||
          url.password ||
          url.hash
        )
          throw new Error("The local server returned an invalid ChatGPT sign-in address.");
        const loginTab = await chrome.tabs.create({ url: url.href, active: true });
        if (tabId !== null && loginTab.id !== undefined) {
          await chrome.storage.session.set({
            [loginReturnKey]: {
              sourceTabId: tabId,
              loginTabId: loginTab.id,
              callback: url.searchParams.get("redirect_uri"),
              at: Date.now(),
            },
          });
        }
      } catch (error) {
        await gateway
          .post("/api/chatgpt/cancel", {}, crypto.randomUUID(), tabId, 4000)
          .catch(() => {});
        throw error;
      }
      return { pending: true };
    }
    case "chatgpt.cancel":
    case "chatgpt.logout":
      await chrome.storage.session.remove(loginReturnKey);
      await gateway.post(
        `/api/chatgpt/${type.slice(8)}`,
        {},
        id,
        tabId,
        type === "chatgpt.logout" ? 35000 : 10000,
      );
      return { ok: true };
    case "chatgpt.select":
      await gateway.post(
        "/api/chatgpt/select",
        { profileId: chatGPTChoice(message.profileId, "account") },
        id,
        tabId,
        10000,
      );
      return { ok: true };
    case "chatgpt.model":
      await gateway.post(
        "/api/chatgpt/model",
        { model: chatGPTChoice(message.model, "model") },
        id,
        tabId,
        35000,
      );
      return { ok: true };
    case "request.cancel":
      return { cancelled: gateway.cancel(id, tabId) };
    case "task.start": {
      if (typeof message.goal !== "string" || !message.goal.trim() || message.goal.length > 2000)
        throw new Error("Describe a task in 2,000 characters or fewer.");
      const current = await workspace.snapshot();
      await stopTask(current.tasks.find((t) => t.id === current.activeTaskId));
      const source = sender.tab ?? (await activeTab());
      const task = await workspace.start(
        message.goal,
        source?.id ?? null,
        source?.url ? { url: source.url, title: source.title ?? "" } : undefined,
      );
      if (message.dispatch === false) return task;
      try {
        return await dispatchTask(
          task,
          source,
          typeof message.url === "string" ? message.url : undefined,
        );
      } catch (error) {
        await workspace.pause(task.id);
        throw error;
      }
    }
    case "task.resume": {
      if (typeof message.id !== "string") throw new Error("Choose a task.");
      const state = await workspace.snapshot();
      await stopTask(state.tasks.find((t) => t.id === state.activeTaskId));
      const task = await workspace.resume(message.id, tabId);
      if (message.dispatch === false) return task;
      try {
        return await dispatchTask(task, sender.tab ?? (await activeTab()));
      } catch (error) {
        await workspace.pause(task.id);
        throw error;
      }
    }
    case "task.pause":
    case "task.cancel": {
      const state = await workspace.snapshot();
      const task = state.tasks.find((t) => t.id === (message.id ?? state.activeTaskId));
      await stopTask(task);
      await workspace.pause(task?.id, type === "task.cancel");
      return { ok: true };
    }
    case "task.progress": {
      if (
        typeof message.eventId !== "string" ||
        !message.eventId ||
        message.eventId.length > 160 ||
        typeof message.action !== "string" ||
        message.action.length > 80 ||
        typeof message.summary !== "string" ||
        message.summary.length > 2000 ||
        typeof message.ok !== "boolean" ||
        typeof message.url !== "string" ||
        message.url.length > 4096 ||
        typeof message.title !== "string" ||
        message.title.length > 500 ||
        (message.done !== undefined && typeof message.done !== "boolean") ||
        (message.changed !== undefined && typeof message.changed !== "boolean")
      )
        throw new Error("Invalid action evidence.");
      const state = await workspace.snapshot();
      const task = state.tasks.find((t) => t.id === (message.taskId ?? state.activeTaskId));
      if (task && task.tabId !== null && task.tabId !== tabId)
        throw new Error("This tab does not own the task.");
      await workspace.progress(message as unknown as TaskProgress, tabId);
      return { ok: true };
    }
    case "task.intent": {
      if (
        typeof message.taskId !== "string" ||
        typeof message.nextStep !== "string" ||
        !message.nextStep.trim() ||
        message.nextStep.length > 300
      )
        throw new Error("Invalid next step.");
      if (isPaused(config, sender.tab?.url ?? ""))
        throw new Error("HypeMan is paused on this site.");
      await workspace.intent(message.taskId, tabId, message.nextStep);
      return { ok: true };
    }
    case "note.save": {
      if (
        !isRecord(message.note) ||
        typeof message.note.text !== "string" ||
        typeof message.note.url !== "string" ||
        typeof message.note.title !== "string" ||
        typeof message.note.excerpt !== "string"
      )
        throw new Error("A note needs text and a source.");
      return workspace.saveNote(message.note as unknown as NoteInput);
    }
    case "note.remove":
      if (typeof message.id !== "string") throw new Error("Choose a note.");
      await workspace.removeNote(message.id);
      return { ok: true };
    case "agent.decide": {
      const input = parseAgentRequest(message.input);
      if (!input) throw new Error("Invalid page context.");
      if (isPaused(config, input.page.url)) throw new Error("HypeMan is paused on this site.");
      const state = await workspace.snapshot();
      const owned =
        state.tasks.find((t) => t.id === state.activeTaskId && t.tabId === tabId) ?? null;
      if (input.task && !owned)
        throw new Error("This task has moved to another tab. Start a new task here to continue.");
      input.task = owned;
      const result = await gateway.post<AgentReply>("/api/agent", input, id, tabId, 120000);
      return result;
    }
    case "assistant.ask": {
      if (
        typeof message.message !== "string" ||
        !message.message.trim() ||
        message.message.length > 4000
      )
        throw new Error("Ask a question in 4,000 characters or fewer.");
      const reply = await gateway.post<AgentReply>(
        "/api/agent",
        {
          requestId: id,
          goal: message.message,
          message: message.message,
          history: [],
          task: null,
          mode: "browse",
          page: {
            url: `${config.serverUrl}/demo/`,
            title: "HypeMan rooftop",
            headings: [],
            text: "The user is asking a question from the rooftop. Reply with information only; no browser actions.",
            elements: [],
            errors: [],
            successes: [],
            selection: "",
            frames: { count: 0, inaccessible: 0 },
            capturedAt: Date.now(),
            revision: "rooftop",
          },
        },
        id,
        null,
      );
      return {
        text:
          reply.say ||
          (reply.action.type === "say"
            ? reply.action.text
            : reply.action.type === "ask"
              ? reply.action.question
              : "Open a page and start a task for help with browser actions."),
        provider: reply.provider,
      };
    }
    case "api": {
      if (typeof message.path !== "string" || !API_PATHS.has(message.path))
        throw new Error("Unknown capability.");
      return gateway.post(message.path, message.body ?? {}, id, tabId, 120000);
    }
    case "session.get": {
      if (tabId === null) return {};
      const current = await session(tabId),
        handoff = current.handoff as SessionHandoff | undefined;
      if (handoff && handoff.at && Date.now() - handoff.at > 120000) {
        await setSession(tabId, { handoff: null });
        return { ...current, handoff: null };
      }
      return current;
    }
    case "session.set": {
      if (tabId === null) return { ok: true };
      if (message.handoff !== null && message.handoff !== undefined) {
        if (
          !isRecord(message.handoff) ||
          typeof message.handoff.goal !== "string" ||
          !Array.isArray(message.handoff.history) ||
          message.handoff.history.length > 40
        )
          throw new Error("Invalid continuation.");
      }
      await setSession(tabId, {
        ...(message.handoff !== undefined ? { handoff: message.handoff } : {}),
        ...(Array.isArray(message.conversation)
          ? { conversation: message.conversation.slice(-60) }
          : {}),
      });
      return { ok: true };
    }
    case "nav.navigate": {
      const url = safePageUrl(message.url);
      if (!url) throw new Error("Only ordinary website URLs are supported.");
      if (isPaused(config, url)) throw new Error("HypeMan is paused on the destination site.");
      const state = await workspace.snapshot();
      const task = state.tasks.find((t) => t.id === state.activeTaskId && t.tabId === tabId);
      if (message.newTab === true || tabId === null) {
        const target = await chrome.tabs.create({ url: "about:blank", active: true });
        if (target.id === undefined) throw new Error("Couldn't open tab.");
        if (task) await workspace.resume(task.id, target.id);
        await setSession(target.id, {
          handoff: message.handoff ?? null,
          conversation: tabId === null ? [] : ((await session(tabId)).conversation ?? []),
        });
        await chrome.tabs.update(target.id, { url });
        if (task && tabId !== null) await notify("task.stopped", { taskId: task.id }, tabId);
      } else {
        await setSession(tabId, { handoff: message.handoff ?? null });
        await chrome.tabs.update(tabId, { url });
      }
      return { ok: true };
    }
    case "nav.back":
      if (tabId === null) throw new Error("No browser tab.");
      await chrome.tabs.goBack(tabId);
      return { ok: true };
    case "nav.switch": {
      if (!config.tabContextEnabled)
        throw new Error("Enable other tab context before switching tabs with HypeMan.");
      if (!Number.isInteger(message.tabId)) throw new Error("Choose a tab.");
      const target = await chrome.tabs.get(Number(message.tabId));
      if (!safePageUrl(target.url) || isPaused(config, target.url!))
        throw new Error("That tab is unavailable.");
      const state = await workspace.snapshot(),
        task = state.tasks.find((t) => t.id === state.activeTaskId && t.tabId === tabId);
      if (task) {
        await workspace.resume(task.id, target.id!);
        if (tabId !== null) await notify("task.stopped", { taskId: task.id }, tabId);
      }
      await setSession(target.id!, {
        handoff: message.handoff ?? null,
        conversation: tabId === null ? [] : ((await session(tabId)).conversation ?? []),
      });
      await chrome.tabs.update(target.id!, { active: true });
      await chrome.windows.update(target.windowId, { focused: true });
      try {
        await chrome.tabs.sendMessage(target.id!, {
          type: "burrow.task.run",
          taskId: task?.id,
          goal: task?.goal,
          handoff: message.handoff,
        });
      } catch {
        await chrome.scripting.executeScript({
          target: { tabId: target.id! },
          files: ["content.js"],
        });
      }
      return { ok: true };
    }
    case "tabs.list":
      return config.tabContextEnabled
        ? (await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }))
            .filter((t) => !isPaused(config, t.url ?? ""))
            .slice(0, 12)
            .map((t) => ({
              id: t.id,
              title: t.title,
              url: (() => {
                const u = new URL(t.url!);
                return u.origin + u.pathname;
              })(),
            }))
        : [];
    case "input":
      return trustedInput(tabId, message.ops, config.trustedInput);
    case "screenshot": {
      if (!config.screenshotEnabled || tabId === null)
        throw new Error("Enable screenshot context in Settings first.");
      const tab = await activeTab();
      if (tab?.id !== tabId) throw new Error("Screenshot context only works in the active tab.");
      const privateFields = await chrome.scripting.executeScript({
        target: { tabId },
        func: () =>
          Array.from(document.querySelectorAll("input")).some((e) =>
            /password|credit|card|cvv|cvc|otp|one.?time|verification|security.?code/i.test(
              [e.type, e.name, e.autocomplete, e.id].join(" "),
            ),
          ),
      });
      if (privateFields.some((r) => r.result))
        throw new Error(
          "Screenshot context is unavailable while sensitive fields are on this page.",
        );
      return {
        image: await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 65 }),
      };
    }
    case "graph.get":
    case "learn.get":
      return graph();
    case "learn.event":
      return learn(message.event as never);
    case "learn.plan":
      return savePlan(message.plan);
    case "learn.clear":
      await clearLearning();
      return { ok: true };
    case "character.list":
    case "characters.get":
      return characters();
    case "character.save":
      return saveCharacter(message.character);
    case "character.remove": {
      await removeCharacter(message.id);
      await notify("settings.changed", { settings: await settings() });
      return { ok: true };
    }
    case "tablet.open":
    case "board.open":
      await openCompanion("board");
      return { ok: true };
    case "notebook.open":
      await openCompanion("notebook");
      return { ok: true };
    case "demo.open":
      await chrome.tabs.create({ url: `${config.serverUrl}/demo/workshops/` });
      return { ok: true };
    case "control.open":
      await openCompanion(message.section);
      return { ok: true };
    case "onboarding.open":
      await chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
      return { ok: true };
    default:
      throw new Error("Unknown extension request.");
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (!isRecord(message) || typeof message.type !== "string" || message.type.startsWith("burrow."))
    return;
  if (sender.id !== chrome.runtime.id) {
    respond({ ok: false, error: "Unknown caller" });
    return;
  }
  if (jsonSize(message) > 8_000_000) {
    respond({ ok: false, error: "Request too large" });
    return;
  }
  handle(message, sender)
    .then((data) => respond({ ok: true, data }))
    .catch((error) => respond({ ok: false, error: errorText(error) }));
  return true;
});
chrome.tabs.onRemoved.addListener((id) => {
  gateway.cancelOwner(id);
  void chrome.storage.session.remove(tabSessionKey(id));
  void workspace.snapshot().then((state) => {
    const task = state.tasks.find((t) => t.id === state.activeTaskId && t.tabId === id);
    if (task) return workspace.pause(task.id);
  });
});
// Return to the originating HypeMan screen after the gateway has verified the OAuth result.
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  if (change.status !== "complete" || !tab.url) return;
  void (async () => {
    const value = (await chrome.storage.session.get(loginReturnKey))[loginReturnKey];
    if (
      !isRecord(value) ||
      value.loginTabId !== id ||
      typeof value.callback !== "string" ||
      typeof value.sourceTabId !== "number" ||
      typeof value.at !== "number"
    )
      return;
    if (Date.now() - value.at > 10 * 60_000) {
      await chrome.storage.session.remove(loginReturnKey);
      return;
    }
    const current = new URL(tab.url!);
    const callback = new URL(value.callback);
    if (current.origin !== callback.origin || current.pathname !== callback.pathname) return;
    const result = safeChatGPTStatus(
      await gateway.post("/api/chatgpt/status", {}, crypto.randomUUID(), null, 45000),
    );
    if (result.pending) return;
    await chrome.storage.session.remove(loginReturnKey);
    const source = await chrome.tabs.get(value.sourceTabId).catch(() => null);
    if (!source?.url?.startsWith(chrome.runtime.getURL(""))) return;
    await chrome.tabs.update(value.sourceTabId, { active: true });
    await chrome.windows.update(source.windowId, { focused: true });
    if (result.connected && result.sharing && !result.error) await chrome.tabs.remove(id);
  })().catch(() => {
    /* Keep the callback tab available if returning fails. */
  });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[WORKSPACE_KEY]) void notify("workspace.changed");
});
chrome.runtime.onInstalled.addListener(async (details) => {
  await patchSettings({});
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "burrow-note",
      title: "Pin selection in HypeMan",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "burrow-explain",
      title: "Explain with HypeMan",
      contexts: ["selection"],
    });
  });
  if (details.reason === "install")
    await chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || !info.selectionText || isPaused(await settings(), tab.url ?? "")) return;
  if (info.menuItemId === "burrow-note")
    await workspace.saveNote({
      text: info.selectionText,
      excerpt: info.selectionText,
      url: tab.url ?? "",
      title: tab.title ?? "",
    });
  else await notify("ask.selection", { text: info.selectionText }, tab.id);
});
chrome.commands.onCommand.addListener(async (command) => {
  const tab = await activeTab();
  if (command === "open-control")
    await openCompanion();
  else if (tab?.id !== undefined) await notify("command", { name: command }, tab.id);
});

async function trustedInput(
  tabId: number | null,
  raw: unknown,
  enabled: boolean,
): Promise<{ ok: boolean }> {
  if (
    tabId === null ||
    !enabled ||
    !(await chrome.permissions.contains({ permissions: ["debugger"] }))
  )
    throw new Error("Real input is not enabled.");
  if (!Array.isArray(raw) || raw.length > 40 || !raw.every(isRecord))
    throw new Error("Invalid input operations.");
  const privateFocus = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const e = document.activeElement;
      return (
        e instanceof HTMLInputElement &&
        /password|card|credit|cvv|cvc|otp|one.?time|verification|security.?code/i.test(
          [e.type, e.name, e.autocomplete, e.id].join(" "),
        )
      );
    },
  });
  if (privateFocus.some((v) => v.result)) throw new Error("Enter sensitive details yourself.");
  await chrome.debugger.attach({ tabId }, "1.3");
  const send = (method: string, params: Record<string, unknown>) =>
    chrome.debugger.sendCommand({ tabId }, method, params);
  const point = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 20000;
  try {
    for (const op of raw) {
      if (op.kind === "key") {
        if (typeof op.key !== "string" || op.key.length > 30) throw new Error("Invalid key");
        await send("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: op.key,
          code: op.key,
          ...(op.key === "Enter" ? { windowsVirtualKeyCode: 13 } : {}),
        });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: op.key, code: op.key });
      } else if (op.kind === "text") {
        if (typeof op.text !== "string" || op.text.length > 8000) throw new Error("Invalid text");
        await send("Input.insertText", { text: op.text });
      } else {
        if (!point(op.x) || !point(op.y)) throw new Error("Invalid pointer coordinates");
        if (op.kind === "move")
          await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: op.x, y: op.y });
        else if (op.kind === "click") {
          if (
            !["left", "right"].includes(String(op.button)) ||
            !Number.isInteger(op.count) ||
            Number(op.count) < 1 ||
            Number(op.count) > 2
          )
            throw new Error("Invalid click");
          for (let n = 1; n <= Number(op.count); n++) {
            await send("Input.dispatchMouseEvent", {
              type: "mousePressed",
              x: op.x,
              y: op.y,
              button: op.button,
              clickCount: n,
            });
            await send("Input.dispatchMouseEvent", {
              type: "mouseReleased",
              x: op.x,
              y: op.y,
              button: op.button,
              clickCount: n,
            });
          }
        } else if (op.kind === "wheel") {
          if (
            typeof op.deltaY !== "number" ||
            !Number.isFinite(op.deltaY) ||
            Math.abs(op.deltaY) > 10000
          )
            throw new Error("Invalid scroll");
          await send("Input.dispatchMouseEvent", {
            type: "mouseWheel",
            x: op.x,
            y: op.y,
            deltaY: op.deltaY,
            deltaX: 0,
          });
        } else if (op.kind === "drag") {
          if (!point(op.toX) || !point(op.toY)) throw new Error("Invalid drag");
          await send("Input.dispatchMouseEvent", {
            type: "mousePressed",
            x: op.x,
            y: op.y,
            button: "left",
            buttons: 1,
            clickCount: 1,
          });
          for (let i = 1; i <= 12; i++)
            await send("Input.dispatchMouseEvent", {
              type: "mouseMoved",
              x: Number(op.x) + ((Number(op.toX) - Number(op.x)) * i) / 12,
              y: Number(op.y) + ((Number(op.toY) - Number(op.y)) * i) / 12,
              button: "left",
              buttons: 1,
            });
          await send("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: op.toX,
            y: op.toY,
            button: "left",
            buttons: 0,
            clickCount: 1,
          });
        } else throw new Error("Unknown input operation");
      }
    }
    return { ok: true };
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}
