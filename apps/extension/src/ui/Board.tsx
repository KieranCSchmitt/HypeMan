import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { parseAction, type Action, type InkReview } from "@core";
import {
  boardObjectBounds, editBoard, emptyBoard, moveBoardObject, parseBoardDocument, parseBoardObject,
  undoBoard, type BoardDocument, type BoardObject, type BoardPoint,
} from "../../../../packages/core/src/board";
import { request } from "../bridge";
import { Notice, ToolButton } from "./common";
import { useToolHandler, useWorkbench } from "./WorkbenchContext";
import { isBoardEquation as equation, placeBoardLabels, restoreBoardLabels } from "./board-layout";
import { loadBoardFonts } from "../entries/fonts";

const inkColor = "#1b1f3b";
const mathOptions: katex.KatexOptions = { throwOnError: false, trust: false, output: "html", maxExpand: 500, maxSize: 15, strict: "warn" };
const textOf = (object: BoardObject) => object.kind === "text" || object.kind === "equation" ? object.text : `${object.kind} on whiteboard`;
const unDelimit = (text: string) => text.trim().replace(/^\$\$?|\$\$?$/g, "").replace(/^\\[([]|\\[)\]]$/g, "");
const makeId = () => crypto.randomUUID();
function sketchKey(sketch: Extract<Action, { type: "sketch" }>): string {
  let hash = 2166136261;
  for (const character of JSON.stringify(sketch)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `sketch-${(hash >>> 0).toString(36)}`;
}
function dimensions(objects: BoardObject[]) {
  const boxes = objects.map(boardObjectBounds);
  return { width: Math.min(20_000, Math.max(1200, ...boxes.map((box) => box.x + box.width + 60))),
    height: Math.min(20_000, Math.max(850, ...boxes.map((box) => box.y + box.height + 60))) };
}
function objectFromArgs(input: Record<string, unknown>, source: "user" | "assistant", fallback?: BoardObject): BoardObject {
  let kind = String(input.kind || input.type || fallback?.kind || (typeof input.text === "string" && equation(input.text) ? "equation" : "text"));
  if (kind === "equation" && typeof input.text === "string" && !equation(input.text)) kind = "text";
  const candidate = { id: input.id || fallback?.id || makeId(), x: 60, y: 60, color: inkColor, size: 3, fontSize: 26,
    ...fallback, ...input, source, kind, ...(kind === "equation" && typeof input.text === "string" ? { text: unDelimit(input.text) } : {}) };
  const object = parseBoardObject(candidate);
  if (!object) throw new Error("Provide a valid board object with text or drawing geometry.");
  return object;
}
function hitObject(object: BoardObject, point: BoardPoint): boolean {
  const bounds = boardObjectBounds(object);
  if (point.x < bounds.x - 12 || point.x > bounds.x + bounds.width + 12 || point.y < bounds.y - 12 || point.y > bounds.y + bounds.height + 12) return false;
  if (object.kind === "text" || object.kind === "equation" || object.kind === "circle") return true;
  const points = object.kind === "stroke" ? object.points.map((p) => ({ x: p.x + object.x, y: p.y + object.y })) : [{ x: object.x, y: object.y }, { x: object.toX, y: object.toY }];
  const distance = (a: BoardPoint, b: BoardPoint) => {
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
    return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
  };
  return points.some((p, i) => distance(p, points[Math.max(0, i - 1)]) <= object.size / 2 + 10);
}
function shapePath(object: BoardObject) {
  if (object.kind !== "stroke") return "";
  return object.points.map((point, i) => `${i ? "L" : "M"}${point.x + object.x},${point.y + object.y}`).join(" ") + (object.points.length === 1 ? `l.1,.1` : "");
}
function drawGeometry(context: CanvasRenderingContext2D, object: BoardObject) {
  context.strokeStyle = object.color; context.fillStyle = object.color;
  context.lineCap = "round"; context.lineJoin = "round";
  if (object.kind === "text" || object.kind === "equation") {
    context.font = `${object.fontSize}px system-ui`; context.textBaseline = "top";
    object.text.split("\n").forEach((line, i) => context.fillText(line, object.x, object.y + i * object.fontSize * 1.6));
    return;
  }
  context.lineWidth = object.size; context.beginPath();
  if (object.kind === "circle") context.arc(object.x, object.y, object.radius, 0, Math.PI * 2);
  else if (object.kind === "stroke") object.points.forEach((point, i) => {
    if (i) context.lineTo(point.x + object.x, point.y + object.y); else context.moveTo(point.x + object.x, point.y + object.y);
    if (object.points.length === 1) context.lineTo(point.x + object.x + .1, point.y + object.y + .1);
  });
  else {
    context.moveTo(object.x, object.y); context.lineTo(object.toX, object.toY);
    if (object.kind === "arrow") {
      const angle = Math.atan2(object.toY - object.y, object.toX - object.x), length = 12 + object.size;
      context.moveTo(object.toX - length * Math.cos(angle - Math.PI / 6), object.toY - length * Math.sin(angle - Math.PI / 6));
      context.lineTo(object.toX, object.toY);
      context.lineTo(object.toX - length * Math.cos(angle + Math.PI / 6), object.toY - length * Math.sin(angle + Math.PI / 6));
    }
  }
  context.stroke();
}
/** Paint KaTeX's actual laid-out glyphs, rules and SVG radicals; no foreignObject canvas taint. */
async function drawMath(context: CanvasRenderingContext2D, object: Extract<BoardObject, { kind: "text" | "equation" }>, element: HTMLElement, scale: number) {
  const math = element.querySelector<HTMLElement>(".katex-html");
  if (!math || !element.getBoundingClientRect().width) { drawGeometry(context, object); return; }
  const origin = element.getBoundingClientRect();
  const walker = document.createTreeWalker(math, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!node.textContent || !parent || parent.closest("svg")) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    const rect = range.getBoundingClientRect(), style = getComputedStyle(parent);
    if (!rect.width || !rect.height) continue;
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    context.fillStyle = style.color; context.textBaseline = "alphabetic";
    const descent = context.measureText(node.textContent).actualBoundingBoxDescent || parseFloat(style.fontSize) * .18;
    context.fillText(node.textContent, object.x + (rect.left - origin.left) / scale, object.y + (rect.bottom - origin.top) / scale - descent);
  }
  for (const rule of math.querySelectorAll<HTMLElement>(".frac-line,.overline-line,.underline-line")) {
    const rect = rule.getBoundingClientRect(), style = getComputedStyle(rule);
    context.fillStyle = style.borderTopColor || object.color;
    context.fillRect(object.x + (rect.left - origin.left) / scale, object.y + (rect.top - origin.top) / scale,
      rect.width / scale, Math.max(1, parseFloat(style.borderTopWidth) || parseFloat(style.borderBottomWidth) || 1));
  }
  for (const svg of math.querySelectorAll<SVGSVGElement>("svg")) {
    const rect = svg.getBoundingClientRect(); if (!rect.width || !rect.height) continue;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(rect.width / scale)); clone.setAttribute("height", String(rect.height / scale));
    const data = new XMLSerializer().serializeToString(clone).replace(/currentColor/g, getComputedStyle(svg).color || object.color);
    const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;
    await image.decode();
    context.drawImage(image, object.x + (rect.left - origin.left) / scale, object.y + (rect.top - origin.top) / scale, rect.width / scale, rect.height / scale);
  }
}

export interface BoardProps {
  embedded?: boolean; active?: boolean; conversationId?: string; sketch?: Extract<Action, { type: "sketch" }> | null;
}
export function Board({ embedded = false, active = true, conversationId: explicitId, sketch }: BoardProps) {
  useEffect(() => { void loadBoardFonts(); }, []);
  const workbench = useWorkbench();
  const conversationId = explicitId || workbench.conversationId;
  const [board, setBoard] = useState<BoardDocument>(emptyBoard());
  const [loaded, setLoaded] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  const [selection, setSelection] = useState<string | null>(null), [editing, setEditing] = useState<string | null>(null);
  const [draftText, setDraftText] = useState(""), [draftObject, setDraftObject] = useState<BoardObject | null>(null);
  const [color, setColor] = useState(inkColor), [width, setWidth] = useState(3);
  const [mode, setMode] = useState<"auto" | "ink" | "select">("auto");
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [review, setReview] = useState<InkReview | null>(null);
  const documentRef = useRef(board), root = useRef<HTMLDivElement>(null), surface = useRef<HTMLDivElement>(null), scene = useRef<HTMLDivElement>(null);
  const session = useRef(0), blocked = useRef(false);
  const queues = useRef(new Map<string, { revision: number; pending: Promise<void>; blocked: boolean }>());
  const ready = useRef<Promise<void>>(Promise.resolve()), controller = useRef<AbortController | null>(null), space = useRef(false);
  const pointers = useRef(new Map<number, BoardPoint>());
  const gesture = useRef<null | { type: "ink" | "move" | "pan" | "pinch"; pointerId: number; start: BoardPoint; object?: BoardObject; view: typeof view; distance?: number; center?: BoardPoint }>(null);
  const objectRef = useRef<BoardObject | null>(null);
  const lastTap = useRef<{ id: string; at: number } | null>(null);
  const update = (next: BoardDocument) => { documentRef.current = next; setBoard(next); };
  useEffect(() => {
    const token = ++session.current;
    setLoaded(false); setError(""); setSelection(null); setEditing(null); setReview(null); blocked.current = false;
    gesture.current = null; objectRef.current = null; setDraftObject(null); setView({ x: 0, y: 0, scale: 1 });
    const queue = queues.current.get(conversationId);
    const load = (queue?.pending || Promise.resolve()).then(() => request<unknown>({ type: "artifact.get", conversationId, kind: "board" })).then((value) => {
      if (token !== session.current) return;
      const parsed = value === null || value === undefined ? emptyBoard() : parseBoardDocument(value);
      if (!parsed) throw new Error("This saved board could not be read. Its original data has been preserved.");
      queues.current.set(conversationId, { revision: parsed.revision, pending: Promise.resolve(), blocked: false });
      update({ ...parsed, objects: restoreBoardLabels(parsed.objects) }); setLoaded(true);
    }).catch((reason: unknown) => { if (token === session.current) { blocked.current = true; setError(reason instanceof Error ? reason.message : String(reason)); } throw reason; });
    ready.current = load;
    void load.catch(() => {});
    return () => { controller.current?.abort(); };
  }, [conversationId]);
  useEffect(() => { if (!active) { controller.current?.abort(); gesture.current = null; objectRef.current = null; setDraftObject(null); } }, [active]);
  useEffect(() => {
    const cancel = () => { controller.current?.abort(); setStatus(""); };
    window.addEventListener("hypeman.cancel-tools", cancel);
    return () => window.removeEventListener("hypeman.cancel-tools", cancel);
  }, []);
  useEffect(() => {
    const target = surface.current;
    if (!target) return;
    const zoom = (event: WheelEvent) => {
      event.preventDefault(); const rect = target.getBoundingClientRect();
      setView((current) => {
        const scale = Math.max(.25, Math.min(3, current.scale * Math.exp(-event.deltaY * .002)));
        return { scale, x: event.clientX - rect.left - (event.clientX - rect.left - current.x) * scale / current.scale,
          y: event.clientY - rect.top - (event.clientY - rect.top - current.y) * scale / current.scale };
      });
    };
    target.addEventListener("wheel", zoom, { passive: false });
    return () => target.removeEventListener("wheel", zoom);
  }, []);
  const save = (next: BoardDocument) => {
    const token = session.current;
    const queue = queues.current.get(conversationId);
    if (!queue) return Promise.reject(new Error("The board is still opening."));
    const task = queue.pending.catch(() => {}).then(async () => {
      if (queue.blocked) throw new Error("The board has unsaved changes. Reopen it before making more changes, or export a copy.");
      const value = await request<unknown>({ type: "artifact.put", conversationId, kind: "board", value: next, expectedRevision: queue.revision });
      const persisted = parseBoardDocument(value);
      if (!persisted || persisted.revision !== next.revision) throw new Error("The saved board changed unexpectedly. Reopen it before continuing.");
      queue.revision = persisted.revision;
      if (token === session.current) setStatus("Saved locally");
    }).catch((reason: unknown) => {
      queue.blocked = true;
      if (token === session.current) { blocked.current = true; setError(reason instanceof Error ? reason.message : String(reason)); setStatus("Unsaved changes · export a copy before reopening"); }
      throw reason;
    });
    queue.pending = task.catch(() => {});
    return task;
  };
  const commit = async (next: BoardDocument) => {
    if (blocked.current) throw new Error("Reopen the board before changing it. Your unsaved scene is still visible.");
    if (next === documentRef.current) return;
    controller.current?.abort(); setReview(null); update(next); setStatus("Saving…");
    await save(next);
  };
  const tryCommit = (next: BoardDocument) => void commit(next).catch(() => {});
  const select = (object: BoardObject | null) => {
    setSelection(object?.id || null);
    workbench.selectContent(object ? { kind: "board", id: object.id, text: textOf(object), title: documentRef.current.title, revision: documentRef.current.revision } : null);
  };
  const renderImage = async () => {
    const current = documentRef.current, size = dimensions(current.objects), canvas = document.createElement("canvas");
    const token = session.current;
    const boxes = current.objects.map(boardObjectBounds);
    const minX = Math.min(0, ...boxes.map((box) => box.x - 20)), minY = Math.min(0, ...boxes.map((box) => box.y - 20));
    const width = size.width - minX, height = size.height - minY;
    const scale = Math.min(1, 5000 / Math.max(width, height));
    canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
    const context = canvas.getContext("2d"); if (!context) throw new Error("This browser could not create the board image.");
    await loadBoardFonts();
    await document.fonts?.ready;
    context.scale(scale, scale); context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height); context.translate(-minX, -minY);
    for (const object of current.objects) {
      const element = object.kind === "equation" ? [...(scene.current?.querySelectorAll<HTMLElement>("[data-board-id]") || [])].find((entry) => entry.dataset.boardId === object.id) : null;
      if (object.kind === "equation" && element) await drawMath(context, object, element, view.scale);
      else drawGeometry(context, object);
    }
    if (token !== session.current || documentRef.current.revision !== current.revision) throw new Error("The board changed while its image was being prepared. Try again.");
    return canvas.toDataURL("image/png");
  };
  const receipt = (message: string, before: BoardDocument, after = documentRef.current) => {
    const changedIds = after.objects.filter((object) => JSON.stringify(before.objects.find((item) => item.id === object.id)) !== JSON.stringify(object)).map((object) => object.id);
    const removedIds = before.objects.filter((object) => !after.objects.some((item) => item.id === object.id)).map((object) => object.id);
    return { message, changed: after.revision !== before.revision, data: { artifactId: `board:${conversationId}`, revision: after.revision, title: after.title, changedIds, removedIds, objects: after.objects.filter((object) => changedIds.includes(object.id)).map((object) => ({ id: object.id, kind: object.kind, text: textOf(object) })) }, continue: true };
  };
  const applySketch = async (sketch: Extract<Action, { type: "sketch" }>) => {
    await ready.current;
    const key = sketchKey(sketch), current = documentRef.current;
    if (current.appliedSketches.includes(key)) {
      await queues.current.get(conversationId)?.pending;
      if (queues.current.get(conversationId)?.blocked || blocked.current) throw new Error("The diagram has unsaved changes. Export a copy before reopening.");
      return receipt("Diagram saved.", current);
    }
    const startY = current.objects.length ? Math.max(...current.objects.map((object) => { const box = boardObjectBounds(object); return box.y + box.height; })) + 60 : 45;
    const title = objectFromArgs({ id: `${key}-title`, kind: "text", text: sketch.title, x: 55, y: startY, fontSize: 30 }, "assistant");
    let shapes: BoardObject[] = (sketch.shapes || []).map((shape, index) => objectFromArgs({ ...shape, id: `${key}-shape-${index}`, kind: shape.type === "label" ? equation(shape.text) ? "equation" : "text" : shape.type, y: shape.y + startY, ...(shape.type === "line" || shape.type === "arrow" ? { toY: shape.toY + startY } : {}) }, "assistant"));
    if (shapes.length) {
      const gap = Math.max(0, startY + boardObjectBounds(title).height + 20 - Math.min(...shapes.map(object => boardObjectBounds(object).y)));
      shapes = shapes.map(object => moveBoardObject(object, 0, gap));
    }
    const bottom = shapes.length ? Math.max(...shapes.map((object) => { const box = boardObjectBounds(object); return box.y + box.height; })) + 35 : startY + 60;
    const objects = [title, ...shapes, ...sketch.lines.map((text, index) => objectFromArgs({ id: `${key}-line-${index}`, kind: equation(text) ? "equation" : "text", text, x: 60, y: bottom + index * 64 }, "assistant"))];
    const next = editBoard(current, { upsert: placeBoardLabels(objects, current.objects), title: sketch.title }); next.appliedSketches = [...next.appliedSketches, key].slice(-100);
    await commit(next); return receipt("Diagram saved.", current, next);
  };
  useToolHandler("board", async (operation, args) => {
    await ready.current;
    if (["add", "update", "erase", "color", "clear"].includes(operation) &&
      typeof args.revision === "number" && args.revision !== documentRef.current.revision)
      throw new Error("This board changed. Select the content again before editing it.");
    if (operation === "open") { await queues.current.get(conversationId)?.pending; if (blocked.current) throw new Error("The visible board has unsaved changes."); return { message: "Whiteboard open.", changed: false, data: { artifactId: `board:${conversationId}`, revision: documentRef.current.revision, title: documentRef.current.title, objects: documentRef.current.objects.map((object) => ({ id: object.id, kind: object.kind, text: textOf(object) })) }, continue: true }; }
    if (operation === "add" && args.sketch) { const sketch = parseAction(args.sketch); if (!sketch || sketch.type !== "sketch") throw new Error("Provide a valid diagram."); return applySketch(sketch); }
    if (operation === "color") {
      const names: Record<string, string> = { black: "#1b1f3b", white: "#ffffff", blue: "#2563eb", red: "#dc2626", green: "#15803d", purple: "#7b5cff", orange: "#ea580c", yellow: "#eab308", pink: "#db2777", gray: "#64748b", grey: "#64748b" };
      const requested = String(args.color || args.value || "").toLowerCase(), value = names[requested] || requested;
      if (!/^#[\da-f]{6}$/i.test(value)) throw new Error("Choose an ink color, such as blue or #7b5cff.");
      const before = documentRef.current;
      if (typeof args.id === "string") {
        const object = documentRef.current.objects.find((entry) => entry.id === args.id);
        if (!object) throw new Error("Select the object you want to recolor.");
        await commit(editBoard(documentRef.current, { upsert: [{ ...object, color: value }] }));
      }
      setColor(value); return receipt(`Ink color is ${value}.`, before);
    }
    if (operation === "width") {
      const value = Number(args.width ?? args.value); if (!Number.isFinite(value) || value < 1 || value > 48) throw new Error("Use a stroke width from 1 to 48.");
      setWidth(value); return `Ink width is ${value}.`;
    }
    if (operation === "mode") {
      const value = String(args.value || args.mode); if (value !== "auto" && value !== "ink" && value !== "select") throw new Error("Choose auto, ink, or select mode.");
      setMode(value); return `Board mode is ${value}.`;
    }
    if (operation === "export") {
      const image = await renderImage(), link = document.createElement("a"); link.href = image;
      link.download = `${documentRef.current.title.replace(/[^\w -]/g, "").trim() || "whiteboard"}.png`; link.click();
      return "Exported the complete board as PNG.";
    }
    if (operation === "check") {
      controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
      const revision = documentRef.current.revision, token = session.current;
      setStatus("Checking your visible work…");
      try {
        const image = await renderImage(); abort.signal.throwIfAborted();
        const result = await request<InkReview>({ type: "api", path: "/api/ink", body: {
          image, previousLines: review?.readback || [], goal: String(args.goal || args.question || ""),
        } }, abort.signal);
        if (abort.signal.aborted || token !== session.current || documentRef.current.revision !== revision) throw new DOMException("Board changed during review", "AbortError");
        setReview(result); setStatus(result.provider === "demo" ? "Demonstration feedback" : "Review ready");
        return [...result.observations, ...result.issues.map((issue) => `${issue.evidence}: ${issue.concern} ${issue.question}`), result.nextStep].join("\n");
      } catch (reason) { setStatus(""); throw reason; }
    }
    let next = documentRef.current;
    if (typeof args.revision === "number" && args.revision !== next.revision) throw new Error("This board changed. Select the content again before editing it.");
    if (operation === "undo" || operation === "redo") next = undoBoard(next, operation);
    else if (operation === "clear") { next = editBoard(next, { remove: next.objects.map((object) => object.id) }); select(null); }
    else if (operation === "erase") {
      const id = String(args.id || (workbench.selected?.kind === "board" ? workbench.selected.id : selection) || "");
      const ids = Array.isArray(args.ids) ? args.ids.filter((value): value is string => typeof value === "string") : [id];
      if (!ids.length || ids.some((value) => !next.objects.some((object) => object.id === value))) throw new Error("Select the board objects you want erased.");
      next = editBoard(next, { remove: ids }); select(null);
    } else if (operation === "add") {
      const raw = Array.isArray(args.objects) ? args.objects : [args.object || args];
      const startY = next.objects.length ? Math.max(...next.objects.map((object) => { const bounds = boardObjectBounds(object); return bounds.y + bounds.height; })) + 50 : 60;
      const objects = raw.map((value, i) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Provide board objects to add.");
        return objectFromArgs({ x: 60, y: startY + i * 60, ...value as Record<string, unknown> }, "assistant");
      });
      if (objects.some((object) => next.objects.some((current) => current.id === object.id))) throw new Error("Use update to change an existing board object.");
      next = editBoard(next, { upsert: placeBoardLabels(objects, next.objects), ...(typeof args.title === "string" ? { title: args.title } : {}) });
    } else if (operation === "update") {
      const id = String(args.id || (workbench.selected?.kind === "board" ? workbench.selected.id : selection) || "");
      const existing = next.objects.find((object) => object.id === id);
      if (!existing) throw new Error("Select an existing board object to change.");
      const patch = args.patch && typeof args.patch === "object" && !Array.isArray(args.patch) ? args.patch as Record<string, unknown> : args;
      const updated = objectFromArgs({ ...patch, id: existing.id, source: existing.source }, existing.source, existing);
      next = editBoard(next, { upsert: [updated] });
    } else throw new Error(`Unknown whiteboard operation: ${operation}`);
    const before = documentRef.current, changed = next !== before; await commit(next);
    return receipt(changed ? `Board ${operation} saved.` : `Nothing to ${operation}.`, before, next);
  });
  useEffect(() => {
    if (!sketch || !loaded || blocked.current) return;
    void applySketch(sketch).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [sketch, loaded]);
  const boardPoint = (event: { clientX: number; clientY: number }): BoardPoint => {
    const bounds = surface.current!.getBoundingClientRect();
    return { x: (event.clientX - bounds.left - view.x) / view.scale, y: (event.clientY - bounds.top - view.y) / view.scale };
  };
  const clientPoint = (event: { clientX: number; clientY: number }) => ({ x: event.clientX, y: event.clientY });
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!loaded || blocked.current || editing || event.button !== 0) return;
    event.preventDefault(); surface.current?.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, clientPoint(event));
    const points = [...pointers.current.values()];
    if (points.length >= 2) {
      objectRef.current = null; setDraftObject(null);
      gesture.current = { type: "pinch", pointerId: event.pointerId, start: clientPoint(event), view,
        distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), center: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 } };
      return;
    }
    if (space.current) { gesture.current = { type: "pan", pointerId: event.pointerId, start: clientPoint(event), view }; return; }
    const point = boardPoint(event), hit = event.pointerType === "pen" || mode === "ink" ? null : [...documentRef.current.objects].reverse().find((object) => hitObject(object, point));
    if (hit) { select(hit); gesture.current = { type: "move", pointerId: event.pointerId, start: point, object: hit, view }; return; }
    select(null);
    if (mode === "select") { gesture.current = { type: "pan", pointerId: event.pointerId, start: clientPoint(event), view }; return; }
    const object: BoardObject = { id: makeId(), kind: "stroke", source: "user", x: point.x, y: point.y, color, size: width, points: [{ x: 0, y: 0 }] };
    objectRef.current = object; setDraftObject(object); gesture.current = { type: "ink", pointerId: event.pointerId, start: point, view };
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, clientPoint(event));
    const current = gesture.current; if (!current) return;
    if (current.type === "pinch") {
      const points = [...pointers.current.values()]; if (points.length < 2 || !current.center || !current.distance) return;
      const center = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }, bounds = surface.current!.getBoundingClientRect();
      const scale = Math.max(.25, Math.min(3, current.view.scale * Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) / current.distance));
      const ratio = scale / current.view.scale;
      setView({ scale, x: center.x - bounds.left - (current.center.x - bounds.left - current.view.x) * ratio, y: center.y - bounds.top - (current.center.y - bounds.top - current.view.y) * ratio });
    } else if (event.pointerId !== current.pointerId) return;
    else if (current.type === "pan") setView({ ...current.view, x: current.view.x + event.clientX - current.start.x, y: current.view.y + event.clientY - current.start.y });
    else if (current.type === "move" && current.object) {
      const point = boardPoint(event), moved = moveBoardObject(current.object, point.x - current.start.x, point.y - current.start.y);
      objectRef.current = moved; setDraftObject(moved);
    } else if (objectRef.current?.kind === "stroke") {
      const point = boardPoint(event), object = objectRef.current;
      let points = [...object.points, { x: point.x - object.x, y: point.y - object.y }];
      if (points.length > 2048) points = points.filter((_, i, all) => i % 2 === 0 || i === all.length - 1);
      objectRef.current = { ...object, points }; setDraftObject(objectRef.current);
    }
  };
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    pointers.current.delete(event.pointerId);
    if (!gesture.current) return;
    if (gesture.current.type === "pinch") { if (!pointers.current.size) gesture.current = null; return; }
    if (event.pointerId !== gesture.current.pointerId) return;
    const object = objectRef.current, ending = gesture.current;
    gesture.current = null; objectRef.current = null; setDraftObject(null);
    if (!cancelled && event.pointerType === "touch" && ending.type === "move" && ending.object &&
      (ending.object.kind === "text" || ending.object.kind === "equation")) {
      const point = boardPoint(event);
      if (Math.hypot(point.x - ending.start.x, point.y - ending.start.y) < 8) {
        if (lastTap.current?.id === ending.object.id && Date.now() - lastTap.current.at < 450) { lastTap.current = null; startEdit(ending.object.id); }
        else lastTap.current = { id: ending.object.id, at: Date.now() };
      }
    }
    if (object && !cancelled) {
      try { tryCommit(editBoard(documentRef.current, { upsert: [object] })); }
      catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    }
  };
  const startEdit = (id?: string) => {
    const object = documentRef.current.objects.find((value) => value.id === (id || selection));
    if (object?.kind === "text" || object?.kind === "equation") { setEditing(object.id); setDraftText(object.text); }
  };
  const finishEdit = () => {
    const object = documentRef.current.objects.find((value) => value.id === editing);
    setEditing(null);
    if (!object || (object.kind !== "text" && object.kind !== "equation")) return;
    try { tryCommit(editBoard(documentRef.current, draftText.trim() ? { upsert: [{ ...object, text: draftText }] } : { remove: [object.id] })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const exportBoard = async () => {
    try { const link = document.createElement("a"); link.href = await renderImage(); link.download = `${documentRef.current.title.replace(/[^\w -]/g, "").trim() || "whiteboard"}.png`; link.click(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const addText = () => {
    const object = objectFromArgs({ kind: "text", text: "Text", x: Math.max(20, (30 - view.x) / view.scale), y: Math.max(20, (30 - view.y) / view.scale), color }, "user");
    tryCommit(editBoard(documentRef.current, { upsert: [object] })); select(object); setEditing(object.id); setDraftText("Text");
  };
  const shown = board.objects.map((object) => draftObject?.id === object.id ? draftObject : object);
  if (draftObject && !shown.some((object) => object.id === draftObject.id)) shown.push(draftObject);
  const size = dimensions(shown), selectedObject = shown.find((object) => object.id === selection), bounds = selectedObject ? boardObjectBounds(selectedObject) : null;
  const transform = `translate(${view.x}px,${view.y}px) scale(${view.scale})`;
  return <div ref={root} className={`shared-board ${embedded ? "embedded-studio" : ""}`} aria-label={board.title}>
    <style>{`.shared-board{display:flex;flex-direction:column;min-height:0;height:100%;gap:0;color:#1b1f3b}.shared-board h2{margin:0;font-size:18px}.shared-board .board-viewport{position:relative;min-height:0;flex:1;height:auto;overflow:hidden;background:#fff;border:1px solid #ddd;touch-action:none;outline-offset:-3px}.shared-board .board-scene{position:absolute;left:0;top:0;transform-origin:0 0;background-image:radial-gradient(#dfe1e9 1px,transparent 1px);background-size:24px 24px}.shared-board .board-text{position:absolute;white-space:pre-wrap;font-family:system-ui;line-height:1.6;max-width:1100px;user-select:none;touch-action:none;cursor:text}.shared-board .board-text:focus-visible{outline:2px solid #7b5cff}.shared-board .board-editor{position:absolute;z-index:3;min-width:250px;min-height:90px;background:white;border:2px solid #7b5cff;font:24px system-ui;color:#1b1f3b}.shared-board .board-hint{font-size:12px;color:#666;margin:0}.shared-board .board-objects{display:flex;gap:8px;flex-wrap:wrap;font-size:12px}.shared-board .board-objects [role=option]{cursor:pointer;padding:3px 6px;border-radius:5px;background:#f0efff;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.shared-board .board-objects [aria-selected=true]{outline:2px solid #7b5cff}.shared-board .ink-feedback{max-height:240px;overflow:auto}`}</style>
    <div className="drawing-toolbar tool-toolbar" role="toolbar" aria-label="Drawing tools">
      <ToolButton icon="arrow" label="Select and move" pressed={mode === "select"} disabled={!loaded} onClick={() => setMode("select")} />
      <ToolButton icon="sketch" label="Draw" pressed={mode !== "select"} disabled={!loaded} onClick={() => setMode("ink")} />
      <ToolButton icon="eraser" label="Erase selected object" disabled={!loaded || !selection} onClick={() => { if (selection) { tryCommit(editBoard(documentRef.current, { remove: [selection] })); select(null); } }} />
      <ToolButton icon="notes" label="Add text" disabled={!loaded} onClick={addText} />
      <input type="color" aria-label="Ink color" title="Ink color" value={color} onChange={(event) => setColor(event.target.value)} />
      <select aria-label="Stroke width" title="Stroke width" value={width} onChange={(event) => setWidth(Number(event.target.value))}>{[1, 3, 6, 12, 24, 48].map((value) => <option key={value} value={value}>{value}px</option>)}</select>
      <ToolButton icon="undo" label="Undo" disabled={!loaded} onClick={() => tryCommit(undoBoard(documentRef.current, "undo"))} />
      <ToolButton icon="redo" label="Redo" disabled={!loaded} onClick={() => tryCommit(undoBoard(documentRef.current, "redo"))} />
      <button type="button" className="button" aria-label="Reset board zoom" title="Reset zoom" onClick={() => setView({ x: 0, y: 0, scale: 1 })}>{Math.round(view.scale * 100)}%</button>
      <ToolButton icon="check" label="Check drawing" disabled={!loaded || !board.objects.length} onClick={() => void workbench.executeTool("board", "check").catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))} />
      <ToolButton icon="download" label="Export board" disabled={!loaded} onClick={() => void exportBoard()} />
    </div>
    <Notice tone="error">{error}</Notice>
    <div ref={surface} className="board-viewport drawing-canvas" role="application" aria-label="Drawing board. Draw on empty space, select objects to move, and use chat for commands." tabIndex={0}
      aria-busy={!loaded} onPointerDown={pointerDown} onPointerMove={pointerMove}
      onPointerUp={(event) => pointerUp(event)} onPointerCancel={(event) => pointerUp(event, true)}
      onDoubleClick={(event) => {
        const id = (event.target as Element).closest<HTMLElement>("[data-board-id]")?.dataset.boardId;
        if (id) startEdit(id); else startEdit();
      }}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).tagName === "TEXTAREA") return;
        if (event.code === "Space") { event.preventDefault(); space.current = true; }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); tryCommit(undoBoard(documentRef.current, event.shiftKey ? "redo" : "undo")); }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") { event.preventDefault(); tryCommit(undoBoard(documentRef.current, "redo")); }
        if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); if (selection) { tryCommit(editBoard(documentRef.current, { remove: [selection] })); select(null); } }
        if (event.key === "Enter") { event.preventDefault(); startEdit(); }
        if (event.key === "Escape") { setEditing(null); setMode("auto"); select(null); }
      }} onKeyUp={(event) => { if (event.code === "Space") space.current = false; }} onBlur={() => { space.current = false; }}>
      <div ref={scene} className="board-scene" style={{ width: size.width, height: size.height, transform }}>
        <svg width={size.width} height={size.height} style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }} aria-hidden="true">
          <defs><marker id={`board-arrow-${conversationId.replace(/[^a-z0-9-]/gi, "")}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke" /></marker></defs>
          {shown.map((object) => object.kind === "stroke" ? <path key={object.id} d={shapePath(object)} stroke={object.color} strokeWidth={object.size} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            : object.kind === "circle" ? <circle key={object.id} cx={object.x} cy={object.y} r={object.radius} stroke={object.color} strokeWidth={object.size} fill="none" />
              : object.kind === "line" || object.kind === "arrow" ? <line key={object.id} x1={object.x} y1={object.y} x2={object.toX} y2={object.toY} stroke={object.color} strokeWidth={object.size} markerEnd={object.kind === "arrow" ? `url(#board-arrow-${conversationId.replace(/[^a-z0-9-]/gi, "")})` : undefined} /> : null)}
          {bounds && <rect x={bounds.x - 7} y={bounds.y - 7} width={bounds.width + 14} height={bounds.height + 14} stroke="#7b5cff" strokeWidth={2 / view.scale} strokeDasharray="5 4" fill="none" />}
        </svg>
        {shown.map((object) => (object.kind === "text" || object.kind === "equation") && <div key={object.id} className="board-text" data-board-id={object.id} role="option" aria-selected={selection === object.id} tabIndex={0}
          aria-label={`${object.kind}: ${object.text}`} style={{ left: object.x, top: object.y, fontSize: object.fontSize, color: object.color } as CSSProperties}
          onFocus={() => select(object)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); startEdit(object.id); } }}>
          {object.kind === "equation" && equation(object.text) ? <span dangerouslySetInnerHTML={{ __html: katex.renderToString(unDelimit(object.text), mathOptions) }} /> : object.text}
        </div>)}
        {editing && (() => { const object = shown.find((value) => value.id === editing); return object ? <textarea className="board-editor" aria-label="Edit selected board text or equation" autoFocus
          style={{ left: object.x, top: object.y }} value={draftText} maxLength={4000} onChange={(event) => setDraftText(event.target.value)}
          onPointerDown={(event) => event.stopPropagation()} onBlur={finishEdit}
          onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setEditing(null); }
            else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); finishEdit(); } }} /> : null; })()}
      </div>
    </div>
    <div className="board-objects" role="listbox" aria-label="Board objects">
      {board.objects.filter((object) => object.kind !== "text" && object.kind !== "equation").map((object, i) => <span key={object.id} role="option" aria-selected={selection === object.id} tabIndex={0}
        onClick={() => select(object)} onFocus={() => select(object)} onKeyDown={(event) => {
          if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); tryCommit(editBoard(documentRef.current, { remove: [object.id] })); select(null); }
          const shifts: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
          if (shifts[event.key]) { event.preventDefault(); tryCommit(editBoard(documentRef.current, { upsert: [moveBoardObject(object, ...shifts[event.key])] })); }
        }}>{object.kind} {i + 1}</span>)}
    </div>
    <small className="tool-status" role="status" aria-live="polite">{!loaded ? "Opening…" : status || "Saved"}</small>
    {review && <div className="ink-feedback" aria-live="polite">
      <p>{review.legibility === "readable" ? "Writing readable" : "Recognition needs review"}</p>
      {review.observations.map((observation, i) => <p key={i}>{observation}</p>)}
      {review.readback.length > 0 && <details><summary>Readback</summary><ol>{review.readback.map((line, i) => <li key={i}>{line}</li>)}</ol></details>}
      {review.issues.map((issue, i) => <section key={i}><blockquote>{issue.evidence}</blockquote><p>{issue.concern}</p><p>{issue.question}</p></section>)}
      <p>{review.nextStep}</p><small>{review.provider === "demo" ? "Demonstration feedback" : "Review recognition against your drawing."}</small>
    </div>}
  </div>;
}
