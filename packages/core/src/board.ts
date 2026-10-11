/** A shared, revisioned whiteboard. Both ink and assistant objects use the same history. */
export interface BoardPoint { x: number; y: number }
interface BoardObjectBase {
  id: string;
  source: "user" | "assistant";
  x: number;
  y: number;
  color: string;
}
export type BoardObject =
  | (BoardObjectBase & { kind: "stroke"; size: number; points: BoardPoint[] })
  | (BoardObjectBase & { kind: "line"; size: number; toX: number; toY: number })
  | (BoardObjectBase & { kind: "arrow"; size: number; toX: number; toY: number })
  | (BoardObjectBase & { kind: "circle"; size: number; radius: number })
  | (BoardObjectBase & { kind: "text"; text: string; fontSize: number })
  | (BoardObjectBase & { kind: "equation"; text: string; fontSize: number });
export interface BoardChange {
  id: string;
  before: BoardObject | null;
  after: BoardObject | null;
  beforeIndex: number;
  afterIndex: number;
}
export interface BoardTransaction {
  changes: BoardChange[];
  beforeTitle: string;
  afterTitle: string;
}
export interface BoardDocument {
  version: 1;
  title: string;
  revision: number;
  objects: BoardObject[];
  undo: BoardTransaction[];
  redo: BoardTransaction[];
  appliedSketches: string[];
  updatedAt: number;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const coordinate = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 20_000;
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const color = (value: unknown): value is string => typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
export function parseBoardObject(value: unknown): BoardObject | null {
  if (!record(value) || typeof value.id !== "string" || !value.id.trim() || value.id.length > 150 ||
    !["user", "assistant"].includes(String(value.source)) || !coordinate(value.x) || !coordinate(value.y) || !color(value.color)) return null;
  const base: BoardObjectBase = { id: value.id, source: value.source as "user" | "assistant", x: value.x, y: value.y, color: value.color };
  if (value.kind === "text" || value.kind === "equation") {
    if (typeof value.text !== "string" || !value.text.trim() || value.text.length > 4000 ||
      typeof value.fontSize !== "number" || !Number.isFinite(value.fontSize) || value.fontSize < 10 || value.fontSize > 100) return null;
    return { ...base, kind: value.kind, text: value.text, fontSize: value.fontSize };
  }
  if (typeof value.size !== "number" || !Number.isFinite(value.size) || value.size < 1 || value.size > 48) return null;
  if (value.kind === "stroke" && Array.isArray(value.points) && value.points.length > 0 && value.points.length <= 2048 &&
    value.points.every((point) => record(point) && coordinate(point.x) && coordinate(point.y)))
    return { ...base, kind: "stroke", size: value.size, points: value.points.map((point) => ({ x: point.x as number, y: point.y as number })) };
  if ((value.kind === "line" || value.kind === "arrow") && coordinate(value.toX) && coordinate(value.toY))
    return { ...base, kind: value.kind, size: value.size, toX: value.toX, toY: value.toY };
  if (value.kind === "circle" && typeof value.radius === "number" && Number.isFinite(value.radius) && value.radius >= 1 && value.radius <= 4000)
    return { ...base, kind: "circle", size: value.size, radius: value.radius };
  return null;
}
function transaction(value: unknown): BoardTransaction | null {
  if (!record(value) || !Array.isArray(value.changes) || value.changes.length > 500 ||
    typeof value.beforeTitle !== "string" || value.beforeTitle.length > 200 ||
    typeof value.afterTitle !== "string" || value.afterTitle.length > 200) return null;
  const changes: BoardChange[] = [];
  for (const change of value.changes) {
    if (!record(change) || typeof change.id !== "string" || !integer(change.beforeIndex) || !integer(change.afterIndex)) return null;
    const before = change.before === null ? null : parseBoardObject(change.before);
    const after = change.after === null ? null : parseBoardObject(change.after);
    if ((!before && change.before !== null) || (!after && change.after !== null) || (!before && !after) ||
      (before && before.id !== change.id) || (after && after.id !== change.id)) return null;
    changes.push({ id: change.id, before, after, beforeIndex: change.beforeIndex, afterIndex: change.afterIndex });
  }
  if (new Set(changes.map((change) => change.id)).size !== changes.length) return null;
  return { changes, beforeTitle: value.beforeTitle, afterTitle: value.afterTitle };
}
export function emptyBoard(title = "Whiteboard"): BoardDocument {
  return { version: 1, title, revision: 0, objects: [], undo: [], redo: [], appliedSketches: [], updatedAt: 0 };
}
export function parseBoardDocument(value: unknown): BoardDocument | null {
  if (!record(value) || value.version !== 1 || typeof value.title !== "string" || value.title.length > 200 ||
    !integer(value.revision) || !Array.isArray(value.objects) || value.objects.length > 500 ||
    !Array.isArray(value.undo) || value.undo.length > 40 || !Array.isArray(value.redo) || value.redo.length > 40 ||
    !Array.isArray(value.appliedSketches) || value.appliedSketches.length > 100 ||
    !value.appliedSketches.every((key) => typeof key === "string" && key.length <= 200) ||
    typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt) || value.updatedAt < 0) return null;
  const objects = value.objects.map(parseBoardObject), undo = value.undo.map(transaction), redo = value.redo.map(transaction);
  if (objects.some((object) => !object) || undo.some((entry) => !entry) || redo.some((entry) => !entry) ||
    new Set(objects.map((object) => object!.id)).size !== objects.length) return null;
  return { version: 1, title: value.title, revision: value.revision, objects: objects as BoardObject[],
    undo: undo as BoardTransaction[], redo: redo as BoardTransaction[], appliedSketches: [...value.appliedSketches] as string[], updatedAt: value.updatedAt };
}
function boundedHistory(document: BoardDocument): BoardDocument {
  const next = { ...document, undo: document.undo.slice(-40), redo: document.redo.slice(-40) };
  // Keep chat artifacts comfortably below the bridge limit even after several long ink sessions.
  while (JSON.stringify(next).length > 2_000_000 && (next.undo.length || next.redo.length)) {
    if (next.undo.length) next.undo.shift(); else next.redo.shift();
  }
  if (JSON.stringify(next).length > 2_000_000) throw new Error("This board is full. Start another board before adding more ink.");
  return next;
}
export function editBoard(document: BoardDocument, edit: { upsert?: BoardObject[]; remove?: string[]; title?: string }, now = Date.now()): BoardDocument {
  const upsert = (edit.upsert || []).map((object) => {
    const parsed = parseBoardObject(object);
    if (!parsed) throw new Error("Invalid board object. Nothing was changed.");
    return parsed;
  });
  if (new Set(upsert.map((object) => object.id)).size !== upsert.length) throw new Error("Duplicate board object IDs.");
  const remove = new Set(edit.remove || []);
  const objects = document.objects.filter((object) => !remove.has(object.id)).map((object) => upsert.find((replacement) => replacement.id === object.id) || object);
  for (const object of upsert) if (!objects.some((current) => current.id === object.id)) objects.push(object);
  if (objects.length > 500) throw new Error("This board is full. Start another board before adding more objects.");
  const title = (edit.title ?? document.title).trim().slice(0, 200) || "Whiteboard";
  const changedIDs = new Set([...document.objects, ...objects].map((object) => object.id));
  const changes: BoardChange[] = [];
  for (const id of changedIDs) {
    const beforeIndex = document.objects.findIndex((object) => object.id === id), afterIndex = objects.findIndex((object) => object.id === id);
    const before = document.objects[beforeIndex] ?? null, after = objects[afterIndex] ?? null;
    if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ id, before, after, beforeIndex: Math.max(0, beforeIndex), afterIndex: Math.max(0, afterIndex) });
  }
  if (!changes.length && title === document.title) return document;
  return boundedHistory({ ...document, title, objects, revision: document.revision + 1, updatedAt: now,
    undo: [...document.undo, { changes, beforeTitle: document.title, afterTitle: title }], redo: [] });
}
export function undoBoard(document: BoardDocument, direction: "undo" | "redo", now = Date.now()): BoardDocument {
  const entry = document[direction].at(-1);
  if (!entry) return document;
  const undo = direction === "undo";
  const ids = new Set(entry.changes.map((change) => change.id));
  const objects = document.objects.filter((object) => !ids.has(object.id));
  for (const change of [...entry.changes].sort((a, b) => (undo ? a.beforeIndex - b.beforeIndex : a.afterIndex - b.afterIndex))) {
    const object = undo ? change.before : change.after;
    if (object) objects.splice(undo ? change.beforeIndex : change.afterIndex, 0, object);
  }
  return boundedHistory({ ...document, objects, title: undo ? entry.beforeTitle : entry.afterTitle,
    revision: document.revision + 1, updatedAt: now,
    undo: undo ? document.undo.slice(0, -1) : [...document.undo, entry],
    redo: undo ? [...document.redo, entry] : document.redo.slice(0, -1) });
}
export function moveBoardObject(object: BoardObject, dx: number, dy: number): BoardObject {
  return { ...object, x: object.x + dx, y: object.y + dy,
    ...(object.kind === "line" || object.kind === "arrow" ? { toX: object.toX + dx, toY: object.toY + dy } : {}) };
}
export function boardObjectBounds(object: BoardObject): { x: number; y: number; width: number; height: number } {
  if (object.kind === "circle") return { x: object.x - object.radius, y: object.y - object.radius, width: object.radius * 2, height: object.radius * 2 };
  if (object.kind === "text" || object.kind === "equation") {
    const lines = object.text.split("\n");
    return { x: object.x, y: object.y, width: Math.min(1100, Math.max(...lines.map((line) => line.length), 1) * object.fontSize * .62), height: lines.length * object.fontSize * 1.6 };
  }
  const points = object.kind === "stroke" ? object.points.map((point) => ({ x: point.x + object.x, y: point.y + object.y })) : [{ x: object.x, y: object.y }, { x: object.toX, y: object.toY }];
  const xs = points.map((point) => point.x), ys = points.map((point) => point.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y) };
}
