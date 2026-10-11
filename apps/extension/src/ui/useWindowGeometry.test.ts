// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowGeometrySnapshot } from "@core";
import { useWindowGeometry, WindowControls, WindowResizeHandles } from "./useWindowGeometry";
import type { WindowGeometryPersistence } from "./WindowGeometryPersistence";

let root: Root, container: HTMLDivElement;
function TestWindow({ preferredHeight, chat = false, open = true, persistence }: { preferredHeight?: number; chat?: boolean; open?: boolean; persistence?: WindowGeometryPersistence }) {
  const geometry = useWindowGeometry({ id: chat ? "chat" : "notes", open, persistence, minSize: chat ? { width: 300, height: 120 } : { width: 320, height: 220 }, preferredHeight,
    initialRect: () => ({ x: 500, y: 200, width: 500, height: 500 }) });
  return createElement("section", { ref: geometry.hostRef, style: geometry.style, hidden: !open || !geometry.hydrated, ...geometry.shellProps },
    createElement("header", { tabIndex: 0, ...geometry.titleProps }, "Window", createElement(WindowControls, { geometry, title: "Test" })),
    createElement("main", { hidden: geometry.minimized }, "Window contents"), createElement(WindowResizeHandles, { geometry, title: "Test" }));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("innerWidth", 1440); vi.stubGlobal("innerHeight", 900);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const render = (props = {}) => act(async () => root.render(createElement(TestWindow, props)));
const rect = () => {
  const style = container.querySelector("section")!.style;
  return { x: Number.parseFloat(style.left), y: Number.parseFloat(style.top), width: Number.parseFloat(style.width), height: Number.parseFloat(style.height) };
};
async function pointer(target: EventTarget, type: string, x: number, y: number, pointerId = 1) {
  await act(async () => {
    const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true });
    Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: true } }); target.dispatchEvent(event);
  });
}
const snapshot = (changes: Partial<WindowGeometrySnapshot> = {}): WindowGeometrySnapshot => ({
  rect: { x: 150, y: 120, width: 450, height: 360 }, minimized: false, maximized: false, restoreRect: null, userResized: false, ...changes,
});
const persistenceFor = (geometry: WindowGeometryPersistence["geometry"] = {}, conversationId = "conversation-a"): WindowGeometryPersistence => ({
  conversationId, ready: true, geometry, onGeometryChange: vi.fn(),
});
const idle = () => act(async () => { vi.advanceTimersByTime(120); });
describe("shared floating window interaction", () => {
  it("resizes from an edge across content and releases the gesture even outside its shell", async () => {
    await render();
    expect(container.querySelectorAll("[data-resize-edge]")).toHaveLength(8);
    expect(container.querySelectorAll(".pixel-window-resize")).toHaveLength(1);
    await pointer(container.querySelector('[data-resize-edge="w"]')!, "pointerdown", 500, 400);
    expect(container.querySelector(".pixel-window-gesture-shield")).not.toBeNull();
    await pointer(window, "pointermove", 420, 400);
    expect(rect()).toEqual({ x: 420, y: 200, width: 580, height: 500 });
    await pointer(window, "pointerup", 420, 400);
    expect(container.querySelector(".pixel-window-gesture-shield")).toBeNull();
    await pointer(window, "pointermove", 100, 100);
    expect(rect()).toEqual({ x: 420, y: 200, width: 580, height: 500 });
  });
  it("keeps keyboard title movement and keyboard corner resizing available", async () => {
    await render();
    await act(async () => container.querySelector("header")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true })));
    expect(rect().x).toBe(450);
    await act(async () => container.querySelector(".pixel-window-resize")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(rect().height).toBe(510);
  });
  it("minimizes to a reachable title bar and restores the previous size after maximizing", async () => {
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>(".pixel-window-minimize")!.click());
    expect(rect().height).toBe(46); expect(container.querySelector("main")!.hidden).toBe(true);
    expect(container.querySelector(".pixel-window-minimize")!.getAttribute("aria-label")).toBe("Restore Test window");
    expect(container.querySelectorAll("[data-resize-edge]")).toHaveLength(0);
    await act(async () => container.querySelector<HTMLButtonElement>(".pixel-window-minimize")!.click());
    expect(rect().height).toBe(500);
    await act(async () => container.querySelector<HTMLButtonElement>(".pixel-window-maximize")!.click());
    expect(rect()).toEqual({ x: 12, y: 12, width: 1416, height: 876 });
    await act(async () => container.querySelector<HTMLButtonElement>(".pixel-window-maximize")!.click());
    expect(rect()).toEqual({ x: 500, y: 200, width: 500, height: 500 });
  });
  it("grows compact chat upward until the user chooses its own size", async () => {
    await render({ chat: true, preferredHeight: 120 });
    expect(rect()).toEqual({ x: 500, y: 580, width: 500, height: 120 });
    await render({ chat: true, preferredHeight: 400 });
    expect(rect()).toEqual({ x: 500, y: 300, width: 500, height: 400 });
    await act(async () => container.querySelector(".pixel-window-resize")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    await render({ chat: true, preferredHeight: 420 });
    expect(rect()).toEqual({ x: 500, y: 300, width: 500, height: 390 });
  });
  it("keeps a restored window onscreen after its minimized title bar was moved near the bottom", async () => {
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>(".pixel-window-minimize")!.click());
    await pointer(container.querySelector("header")!, "pointerdown", 700, 220);
    await pointer(window, "pointermove", 700, 820);
    await pointer(window, "pointerup", 700, 820);
    expect(rect().y).toBe(800);
    await act(async () => container.querySelector<HTMLButtonElement>(".pixel-window-minimize")!.click());
    expect(rect()).toEqual({ x: 500, y: 388, width: 500, height: 500 });
  });
  it("cancels a pointer gesture on Escape without leaving a blocking shield", async () => {
    await render();
    await pointer(container.querySelector("header")!, "pointerdown", 700, 220);
    await pointer(window, "pointermove", 800, 250);
    expect(rect().x).toBe(600);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(rect()).toEqual({ x: 500, y: 200, width: 500, height: 500 });
    expect(container.querySelector(".pixel-window-gesture-shield")).toBeNull();
  });
});

describe("session window geometry", () => {
  beforeEach(() => vi.useFakeTimers());
  it("waits for stored geometry without saving a default rectangle over it", async () => {
    const stored = snapshot({ userResized: true }), persistence = persistenceFor({ notes: stored });
    await render({ persistence: { ...persistence, ready: false } });
    expect(container.querySelector("section")!.hidden).toBe(true);
    await idle();
    expect(persistence.onGeometryChange).not.toHaveBeenCalled();
    await render({ persistence });
    expect(container.querySelector("section")!.hidden).toBe(false);
    expect(rect()).toEqual(stored.rect);
    await idle();
    expect(persistence.onGeometryChange).not.toHaveBeenCalled();
  });
  it("saves the final pointer rectangle once, without sending every movement", async () => {
    const persistence = persistenceFor({ notes: snapshot() });
    await render({ persistence });
    await pointer(container.querySelector('[data-resize-edge="se"]')!, "pointerdown", 600, 480);
    await pointer(window, "pointermove", 620, 500);
    await pointer(window, "pointermove", 650, 530);
    await idle();
    expect(persistence.onGeometryChange).not.toHaveBeenCalled();
    await pointer(window, "pointerup", 650, 530);
    expect(persistence.onGeometryChange).toHaveBeenCalledExactlyOnceWith("notes", snapshot({ rect: { x: 150, y: 120, width: 500, height: 410 }, userResized: true }));
    await idle();
    expect(persistence.onGeometryChange).toHaveBeenCalledTimes(1);
  });
  it("never persists the intermediate rectangle of a canceled resize", async () => {
    const persistence = persistenceFor({ notes: snapshot() });
    await render({ persistence });
    await pointer(container.querySelector('[data-resize-edge="se"]')!, "pointerdown", 600, 480);
    await pointer(window, "pointermove", 720, 600);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(rect()).toEqual(snapshot().rect);
    await idle();
    expect(persistence.onGeometryChange).not.toHaveBeenCalled();
  });
  it("hydrates maximize and clamps its saved restore rectangle to a smaller viewport", async () => {
    vi.stubGlobal("innerWidth", 800); vi.stubGlobal("innerHeight", 600);
    const persistence = persistenceFor({ notes: snapshot({ maximized: true, rect: { x: 12, y: 12, width: 1416, height: 876 },
      restoreRect: { x: 900, y: 650, width: 500, height: 400 }, userResized: true }) });
    await render({ persistence });
    expect(rect()).toEqual({ x: 12, y: 12, width: 776, height: 576 });
    await act(async () => container.querySelector<HTMLButtonElement>(".pixel-window-maximize")!.click());
    expect(rect()).toEqual({ x: 288, y: 188, width: 500, height: 400 });
    await idle();
    expect(persistence.onGeometryChange).toHaveBeenLastCalledWith("notes", snapshot({ rect: rect(), restoreRect: rect(), userResized: true }));
  });
  it("hydrates a minimized title near the bottom and restores the full window onscreen", async () => {
    const stored = snapshot({ minimized: true, rect: { x: 150, y: 800, width: 450, height: 360 } });
    const persistence = persistenceFor({ notes: stored });
    await render({ persistence });
    expect(rect()).toEqual({ ...stored.rect, height: 46 });
    expect(container.querySelector("main")!.hidden).toBe(true);
    await idle();
    expect(persistence.onGeometryChange).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>(".pixel-window-minimize")!.click());
    expect(rect()).toEqual({ ...stored.rect, y: 528 });
  });
  it("preserves restored chat size instead of applying its initial history height", async () => {
    const stored = snapshot({ rect: { x: 700, y: 200, width: 420, height: 300 }, userResized: true });
    const persistence = persistenceFor({ chat: stored });
    await render({ chat: true, preferredHeight: 120, persistence });
    expect(rect()).toEqual(stored.rect);
    await render({ chat: true, preferredHeight: 400, persistence });
    expect(rect()).toEqual(stored.rect);
    await idle();
    expect(persistence.onGeometryChange).not.toHaveBeenCalled();
  });
  it("does not rehydrate local windows when another geometry patch updates the provider", async () => {
    const persistence = persistenceFor({ notes: snapshot() });
    await render({ persistence });
    await act(async () => container.querySelector("header")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    await render({ persistence: { ...persistence, geometry: { notes: snapshot(), chat: snapshot() } } });
    expect(rect().x).toBe(160);
    await idle();
    expect(persistence.onGeometryChange).toHaveBeenCalledExactlyOnceWith("notes", snapshot({ rect: { ...snapshot().rect, x: 160 } }));
  });
  it("flushes the previous conversation and hydrates the next without cross-writing", async () => {
    const first = persistenceFor({ notes: snapshot() }), secondStored = snapshot({ rect: { x: 750, y: 400, width: 400, height: 300 } });
    const second = persistenceFor({ notes: secondStored }, "conversation-b");
    await render({ persistence: first });
    await act(async () => container.querySelector("header")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    await render({ persistence: second });
    expect(first.onGeometryChange).toHaveBeenCalledExactlyOnceWith("notes", snapshot({ rect: { ...snapshot().rect, x: 160 } }));
    expect(rect()).toEqual(secondStored.rect);
    await idle();
    expect(second.onGeometryChange).not.toHaveBeenCalled();
  });
  it("keeps hidden tools from overwriting saved geometry and flushes a pending change on navigation", async () => {
    const stored = snapshot(), persistence = persistenceFor({ notes: stored });
    await render({ open: false, persistence });
    await idle();
    expect(persistence.onGeometryChange).not.toHaveBeenCalled();
    await render({ open: true, persistence });
    expect(rect()).toEqual(stored.rect);
    await act(async () => container.querySelector("header")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await act(async () => window.dispatchEvent(new Event("pagehide")));
    expect(persistence.onGeometryChange).toHaveBeenCalledExactlyOnceWith("notes", snapshot({ rect: { ...stored.rect, y: 130 } }));
    await render({ open: false, persistence });
    await idle();
    expect(persistence.onGeometryChange).toHaveBeenCalledTimes(1);
  });
  it("flushes pending keyboard geometry before task handoff without waiting for idle", async () => {
    const stored = snapshot(), persistence = persistenceFor({ notes: stored });
    await render({ persistence });
    await act(async () => container.querySelector(".pixel-window-resize")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(persistence.onGeometryChange).not.toHaveBeenCalled();
    await act(async () => window.dispatchEvent(new Event("hypeman.flush-window-geometry")));
    expect(persistence.onGeometryChange).toHaveBeenCalledExactlyOnceWith("notes", snapshot({ rect: { ...stored.rect, width: 460 }, userResized: true }));
    await idle();
    expect(persistence.onGeometryChange).toHaveBeenCalledTimes(1);
  });
});
