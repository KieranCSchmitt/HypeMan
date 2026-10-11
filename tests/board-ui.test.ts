// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action, InkReview } from "@core";
import { emptyBoard, type BoardDocument } from "../packages/core/src/board";
import { Board } from "../apps/extension/src/ui/Board";
import { request } from "../apps/extension/src/bridge";
import { WorkbenchContext, type ToolHandler, type WorkbenchState } from "../apps/extension/src/ui/WorkbenchContext";
vi.mock("../apps/extension/src/bridge", () => ({ request: vi.fn() }));
let root: Root, container: HTMLDivElement, handler: ToolHandler, context: WorkbenchState;
let stored: Map<string, BoardDocument>;
let canvasContext: Record<string, ReturnType<typeof vi.fn>>;
const review: InkReview = { readback: ["1/2 + 1/4", "= 2/6"], legibility: "readable", observations: ["You are combining two fractions."], issues: [{ evidence: "= 2/6", concern: "The parts have different sizes.", question: "Can both fractions use equal-sized parts?" }], nextStep: "Sketch matching fraction strips.", provider: "demo" };
function render(conversationId = "conversation-one", sketch: Extract<Action, { type: "sketch" }> | null = null) {
  return act(async () => { root.render(createElement(WorkbenchContext.Provider, { value: { ...context, conversationId } }, createElement(Board, { conversationId, sketch }))); });
}
async function command(operation: string, args: Record<string, unknown> = {}) {
  let result: string | void, error: unknown;
  await act(async () => { try { result = await handler(operation, args); } catch (reason) { error = reason; } });
  if (error) throw error;
  return result!;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  stored = new Map();
  context = { conversationId: "conversation-one", selected: null, selectContent: vi.fn(), openTool: vi.fn(), send: vi.fn(), executeTool: vi.fn(),
    register: vi.fn((_tool: string, receive: ToolHandler) => { handler = receive; return () => {}; }) };
  canvasContext = Object.fromEntries(["scale", "translate", "fillRect", "fillText", "beginPath", "moveTo", "lineTo", "stroke", "arc", "drawImage"].map((key) => [key, vi.fn()]));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(canvasContext as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,YQ==");
  vi.mocked(request).mockReset().mockImplementation(async (message) => {
    if (message.type === "artifact.get") return stored.get(String(message.conversationId)) || null;
    if (message.type === "artifact.put") {
      const value = message.value as BoardDocument;
      expect(message.expectedRevision).toBe(stored.get(String(message.conversationId))?.revision || 0);
      stored.set(String(message.conversationId), structuredClone(value)); return value;
    }
    if (message.type === "api") return review;
    throw new Error(`Unexpected request ${message.type}`);
  });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("conversation whiteboard", () => {
  it("combines assistant sketches and direct ink in one persisted scene with direct drawing controls", async () => {
    const sketch: Extract<Action, { type: "sketch" }> = { type: "sketch", title: "A worked equation", lines: ["2x + 4 = 10"], shapes: [{ type: "arrow", x: 20, y: 80, toX: 90, toY: 80 }] };
    await render("conversation-one", sketch);
    expect(container.querySelector(".katex")).not.toBeNull(); expect(container.querySelector('[aria-label="Drawing tools"]')).not.toBeNull(); expect(container.querySelector('[aria-label="Draw"]')).not.toBeNull();
    expect(stored.get("conversation-one")?.objects).toHaveLength(3);
    const surface = container.querySelector<HTMLElement>(".board-viewport")!;
    const pointer = (type: string, x: number, y: number) => { const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }); Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: "pen" } }); surface.dispatchEvent(event); };
    await act(async () => { pointer("pointerdown", 400, 400); pointer("pointermove", 450, 450); pointer("pointerup", 450, 450); });
    expect(stored.get("conversation-one")?.objects.filter((object) => object.kind === "stroke")).toHaveLength(1);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click()); expect(stored.get("conversation-one")?.objects).toHaveLength(3);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Redo"]')!.click()); expect(stored.get("conversation-one")?.objects).toHaveLength(4);
    await act(async () => root.unmount()); root = createRoot(container);
    await render("conversation-one", sketch);
    expect(stored.get("conversation-one")?.objects).toHaveLength(4);
  });
  it("edits equation source directly and restores the full scene through durable undo", async () => {
    await render(); await command("add", { objects: [{ id: "equation", kind: "equation", text: "\\frac{1}{2}+x=3", x: 60, y: 60 }] });
    const equation = container.querySelector<HTMLElement>('[data-board-id="equation"]')!;
    await act(async () => equation.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const editor = container.querySelector<HTMLTextAreaElement>(".board-editor")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, "x=5");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", ctrlKey: true })));
    expect(stored.get("conversation-one")?.objects[0]).toMatchObject({ id: "equation", text: "x=5" });
    await command("clear"); expect(stored.get("conversation-one")?.objects).toHaveLength(0);
    await command("undo"); expect(stored.get("conversation-one")?.objects[0]).toMatchObject({ id: "equation", text: "x=5" });
    await command("undo"); expect(stored.get("conversation-one")?.objects[0]).toMatchObject({ text: "\\frac{1}{2}+x=3" });
  });
  it("exports assistant text, geometry, and user ink together and checks a composed snapshot", async () => {
    await render();
    await command("add", { objects: [{ kind: "text", text: "Assistant explanation", x: 60, y: 60 }, { kind: "line", x: 60, y: 100, toX: 120, toY: 100 }, { kind: "stroke", source: "user", x: 20, y: 20, points: [{ x: 0, y: 0 }, { x: 40, y: 30 }] }] });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await command("export");
    expect(click).toHaveBeenCalledOnce(); expect(canvasContext.fillText).toHaveBeenCalledWith("Assistant explanation", 60, 60);
    expect(canvasContext.lineTo).toHaveBeenCalledWith(120, 100); expect(canvasContext.lineTo).toHaveBeenCalledWith(60, 50);
    await command("check", { goal: "Check my fractions" });
    expect(container.querySelector(".ink-feedback blockquote")?.textContent).toBe("= 2/6");
    expect(request).toHaveBeenLastCalledWith({ type: "api", path: "/api/ink", body: { image: "data:image/png;base64,YQ==", previousLines: [], goal: "Check my fractions" } }, expect.any(AbortSignal));
    await command("check");
    expect(request).toHaveBeenLastCalledWith({ type: "api", path: "/api/ink", body: { image: "data:image/png;base64,YQ==", previousLines: review.readback, goal: "" } }, expect.any(AbortSignal));
  });
  it("keeps documents and undo histories separate across conversations", async () => {
    await render(); await command("add", { text: "First conversation" });
    await render("conversation-two"); expect(container.textContent).not.toContain("First conversation");
    await command("add", { text: "Second conversation" });
    await render("conversation-one"); expect(container.textContent).toContain("First conversation"); expect(container.textContent).not.toContain("Second conversation");
    await command("undo"); expect(stored.get("conversation-one")?.objects).toHaveLength(0); expect(stored.get("conversation-two")?.objects).toHaveLength(1);
  });
  it("edits equations on touch double-tap and discards an in-progress stroke when pinching", async () => {
    await render(); await command("add", { id: "touch-equation", kind: "equation", text: "x=2", x: 60, y: 60 });
    const surface = container.querySelector<HTMLElement>(".board-viewport")!;
    const pointer = (type: string, id: number, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
      Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: "touch" } }); surface.dispatchEvent(event);
    };
    await act(async () => { pointer("pointerdown", 1, 70, 70); pointer("pointerup", 1, 70, 70); pointer("pointerdown", 1, 70, 70); pointer("pointerup", 1, 70, 70); });
    const editor = container.querySelector<HTMLTextAreaElement>(".board-editor")!;
    expect(editor).not.toBeNull();
    await act(async () => editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })));
    await act(async () => { pointer("pointerdown", 1, 500, 500); pointer("pointerdown", 2, 600, 500); pointer("pointermove", 2, 650, 500); pointer("pointerup", 1, 500, 500); pointer("pointerup", 2, 650, 500); });
    expect(stored.get("conversation-one")?.objects).toHaveLength(1);
    expect(container.querySelector<HTMLElement>(".board-scene")!.style.transform).toContain("scale(1.5)");
  });
  it("does not overwrite a newer board after a persistence conflict", async () => {
    await render();
    vi.mocked(request).mockImplementationOnce(async () => { throw new Error("Board revision conflict"); });
    await expect(command("add", { text: "Unsaved contribution" })).rejects.toThrow("Board revision conflict");
    expect(container.textContent).toContain("Unsaved contribution");
    expect(container.textContent).toContain("Board revision conflict");
    expect(stored.has("conversation-one")).toBe(false);
    await expect(command("add", { text: "Another" })).rejects.toThrow("Reopen the board");
  });
  it("cancels review on dismissal and refuses stale updates", async () => {
    await render(); await command("add", { id: "eq", text: "x=2" });
    await expect(command("update", { id: "eq", revision: 0, text: "x=3" })).rejects.toThrow("board changed");
    await expect(command("color", { id: "eq", revision: 0, value: "red" })).rejects.toThrow("board changed");
    expect(stored.get("conversation-one")?.objects[0].color).toBe("#1b1f3b");
    let resolve!: (value: InkReview) => void;
    const delayed = new Promise<InkReview>((done) => { resolve = done; });
    vi.mocked(request).mockImplementationOnce(async () => delayed);
    let checking!: Promise<string | void>;
    await act(async () => { checking = Promise.resolve(handler("check", {})); });
    const rejected = expect(checking).rejects.toMatchObject({ name: "AbortError" });
    await act(async () => { window.dispatchEvent(new CustomEvent("hypeman.cancel-tools")); resolve(review); await rejected; });
    expect(container.querySelector(".ink-feedback")).toBeNull();
  });
});
