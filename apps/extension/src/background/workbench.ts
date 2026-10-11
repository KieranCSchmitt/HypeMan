import { isRecord, WORKBENCH_TOOLS, type ConversationUIState, type ConversationUIPatch,
  type WorkbenchToolId, type WorkbenchWindowId, type WindowGeometrySnapshot, type WorkbenchWindowRect } from "@core";

export interface SavedMessage { id: string; role: "user" | "assistant" | "status"; text: string; at: number }
export interface Conversation { id: string; title: string; taskId?: string; messages: SavedMessage[]; updatedAt: number }
let database: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("hypeman.workbench", 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("conversations", { keyPath: "id" }); request.result.createObjectStore("artifacts", { keyPath: "key" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(new Error("Saved work could not be opened.")); };
  });
}
const identifier = (value: unknown): value is string => typeof value === "string" && /^[\w.-]{1,160}$/.test(value);
const uiStateKey = (id: string) => `hypeman.workbench.ui.${id}`;
const toolId = (value: unknown): value is WorkbenchToolId => typeof value === "string" && WORKBENCH_TOOLS.includes(value as WorkbenchToolId);
const windowId = (value: string): value is WorkbenchWindowId => value === "chat" || toolId(value);
const onlyKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every((key) => keys.includes(key));
function windowRect(value: unknown): WorkbenchWindowRect {
  if (!isRecord(value) || !onlyKeys(value, ["x", "y", "width", "height"]) ||
      !["x", "y", "width", "height"].every((key) => typeof value[key] === "number" && Number.isFinite(value[key]) && Math.abs(value[key] as number) <= 100000) ||
      (value.width as number) < 1 || (value.height as number) < 1) throw new Error("Invalid window geometry.");
  return { x: value.x as number, y: value.y as number, width: value.width as number, height: value.height as number };
}
function windowGeometry(value: unknown): WindowGeometrySnapshot {
  if (!isRecord(value) || !onlyKeys(value, ["rect", "minimized", "maximized", "restoreRect", "userResized"]) ||
      typeof value.minimized !== "boolean" || typeof value.maximized !== "boolean" || typeof value.userResized !== "boolean")
    throw new Error("Invalid window geometry.");
  return { rect: windowRect(value.rect), minimized: value.minimized, maximized: value.maximized,
    restoreRect: value.restoreRect === null ? null : windowRect(value.restoreRect), userResized: value.userResized };
}
function uiPatch(value: unknown): ConversationUIPatch {
  if (!isRecord(value) || !onlyKeys(value, ["open", "tools", "active", "geometry"])) throw new Error("Invalid window state.");
  const patch: ConversationUIPatch = {};
  if (Object.hasOwn(value, "open")) {
    if (typeof value.open !== "boolean") throw new Error("Invalid window state.");
    patch.open = value.open;
  }
  if (Object.hasOwn(value, "tools")) {
    if (!Array.isArray(value.tools) || value.tools.length > WORKBENCH_TOOLS.length || !value.tools.every(toolId) || new Set(value.tools).size !== value.tools.length)
      throw new Error("Choose valid tool windows.");
    patch.tools = [...value.tools];
  }
  if (Object.hasOwn(value, "active")) {
    if (value.active !== null && !toolId(value.active)) throw new Error("Choose a valid active window.");
    patch.active = value.active;
  }
  if (Object.hasOwn(value, "geometry")) {
    if (!isRecord(value.geometry)) throw new Error("Invalid window geometry.");
    patch.geometry = {};
    for (const [id, geometry] of Object.entries(value.geometry)) {
      if (!windowId(id)) throw new Error("Choose a valid window.");
      patch.geometry[id] = geometry === null ? null : windowGeometry(geometry);
    }
  }
  return patch;
}
async function readUIState(id: string): Promise<ConversationUIState | null> {
  const value = (await chrome.storage.session.get(uiStateKey(id)))[uiStateKey(id)];
  try {
    if (!isRecord(value) || !["open", "tools", "active", "geometry"].every((key) => Object.hasOwn(value, key))) return null;
    const parsed = uiPatch(value);
    if (Object.values(parsed.geometry!).some((geometry) => geometry === null) || parsed.active !== null && !parsed.tools!.includes(parsed.active!)) return null;
    return parsed as ConversationUIState;
  } catch { return null; }
}
async function patchUIState(id: string, value: unknown): Promise<ConversationUIState> {
  const patch = uiPatch(value);
  const current = await readUIState(id) ?? { open: false, tools: [], active: null, geometry: {} };
  const next: ConversationUIState = { ...current, ...patch, geometry: { ...current.geometry } };
  for (const [id, geometry] of Object.entries(patch.geometry ?? {})) {
    if (geometry === null) delete next.geometry[id as WorkbenchWindowId];
    else next.geometry[id as WorkbenchWindowId] = geometry;
  }
  if (patch.active !== undefined && patch.active !== null && !next.tools.includes(patch.active)) throw new Error("Open the active tool window first.");
  if (next.active !== null && !next.tools.includes(next.active)) next.active = null;
  await chrome.storage.session.set({ [uiStateKey(id)]: next });
  return next;
}
async function read(store: string, key?: string): Promise<any> {
  const database = await db();
  return new Promise((resolve, reject) => { const request = key ? database.transaction(store).objectStore(store).get(key) : database.transaction(store).objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
async function write(store: string, value: unknown) {
  const database = await db();
  return new Promise<void>((resolve, reject) => { const transaction = database.transaction(store, "readwrite"); transaction.objectStore(store).put(value); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(new Error("Saved work could not be stored. Check available browser storage.")); transaction.onabort = () => reject(transaction.error); });
}
async function remove(store: string, key: string) {
  const database = await db();
  return new Promise<void>((resolve, reject) => { const transaction = database.transaction(store, "readwrite"); transaction.objectStore(store).delete(key); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
}
let queue: Promise<unknown> = Promise.resolve();
const uiQueues = new Map<string, Promise<unknown>>();
export function workbenchMessage(message: Record<string, unknown>): Promise<unknown> {
  if (message.type === "workbench.ui.get" || message.type === "workbench.ui.patch") {
    if (!identifier(message.conversationId)) return Promise.reject(new Error("Choose a saved conversation."));
    const id = message.conversationId;
    const operation = (uiQueues.get(id) ?? Promise.resolve()).catch(() => {}).then(() => handle(message));
    uiQueues.set(id, operation);
    const cleanup = () => { if (uiQueues.get(id) === operation) uiQueues.delete(id); };
    void operation.then(cleanup, cleanup);
    return operation;
  }
  const operation = queue.then(() => handle(message)); queue = operation.catch(() => {}); return operation;
}
async function handle(message: Record<string, unknown>): Promise<unknown> {
  const type = message.type;
  if (type === "conversation.list") return read("conversations");
  if (type === "workbench.export") return { version: 1, conversations: await read("conversations"), artifacts: await read("artifacts") };
  if (type === "workbench.restore") {
    if (!isRecord(message.value) || !Array.isArray(message.value.conversations) || !Array.isArray(message.value.artifacts)) throw new Error("Invalid saved conversation restore.");
    const snapshot = message.value as { conversations: Array<Record<string, unknown>>; artifacts: Array<Record<string, unknown>> };
    const database = await db(), current = database.transaction(["conversations", "artifacts"], "readwrite");
    let conversations = 0, artifacts = 0;
    return new Promise((resolve, reject) => {
      current.oncomplete = () => resolve({ conversations, artifacts }); current.onerror = () => reject(new Error("Saved conversations could not be restored; retry the backup.")); current.onabort = current.onerror;
      for (const [storeName, values, keyName] of [["conversations", snapshot.conversations, "id"], ["artifacts", snapshot.artifacts, "key"]] as const) {
        const store = current.objectStore(storeName);
        for (const value of values as Array<Record<string, unknown>>) {
          const request = store.get(value[keyName] as IDBValidKey);
          request.onsuccess = () => { if (request.result) return; store.put(value); if (storeName === "conversations") conversations++; else artifacts++; };
        }
      }
    });
  }
  if (!identifier(message.conversationId)) throw new Error("Choose a saved conversation.");
  const id = message.conversationId;
  if (type === "workbench.ui.get") return readUIState(id);
  if (type === "workbench.ui.patch") return patchUIState(id, message.patch);
  if (type === "conversation.open") {
    const existing = await read("conversations", id); if (existing) return existing;
    const conversation: Conversation = { id, title: "Conversation", messages: [], updatedAt: Date.now(), ...(identifier(message.taskId) ? { taskId: message.taskId } : {}) };
    await write("conversations", conversation); return conversation;
  }
  if (type === "conversation.append") {
    const current: Conversation = await read("conversations", id) || { id, title: "Conversation", messages: [], updatedAt: Date.now() };
    const item = message.message;
    if (!isRecord(item) || !identifier(item.id) || !["user", "assistant", "status"].includes(String(item.role)) || typeof item.text !== "string" || item.text.length > 16000) throw new Error("Invalid conversation message.");
    if (!current.messages.some((m) => m.id === item.id)) current.messages.push({ id: item.id, role: item.role as SavedMessage["role"], text: item.text, at: Date.now() });
    if (current.title === "Conversation" && item.role === "user") current.title = item.text.slice(0, 100);
    current.updatedAt = Date.now(); await write("conversations", current); return current;
  }
  const kind = message.kind;
  if (typeof kind !== "string" || !/^[a-z-]{1,40}$/.test(kind) || (message.id !== undefined && !identifier(message.id))) throw new Error("Choose a valid artifact.");
  const key = `${id}:${kind}:${message.id || "default"}`;
  const current = await read("artifacts", key);
  if (type === "artifact.get") return current?.value ?? null;
  if (type === "artifact.put" && message.value === null) { await remove("artifacts", key); return null; }
  if (type !== "artifact.put" || !isRecord(message.value) || JSON.stringify(message.value).length > 6000000) throw new Error("Invalid saved artifact.");
  const revision = isRecord(current?.value) && typeof current.value.revision === "number" ? current.value.revision : 0;
  if (message.expectedRevision !== undefined && message.expectedRevision !== revision) throw new Error("This artifact changed in another view. Reopen it before editing.");
  await write("artifacts", { key, conversationId: id, kind, value: message.value }); return message.value;
}
