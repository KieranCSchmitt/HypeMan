import { isRecord } from "@core";

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
export function workbenchMessage(message: Record<string, unknown>): Promise<unknown> {
  const operation = queue.then(() => handle(message)); queue = operation.catch(() => {}); return operation;
}
async function handle(message: Record<string, unknown>): Promise<unknown> {
  const type = message.type;
  if (type === "conversation.list") return read("conversations");
  if (type === "workbench.export") return { version: 1, conversations: await read("conversations"), artifacts: await read("artifacts") };
  if (!identifier(message.conversationId)) throw new Error("Choose a saved conversation.");
  const id = message.conversationId;
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
