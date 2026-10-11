// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowGeometry, WindowControls, WindowResizeHandles } from "./useWindowGeometry";

let root: Root, container: HTMLDivElement;
function TestWindow({ preferredHeight, chat = false }: { preferredHeight?: number; chat?: boolean }) {
  const geometry = useWindowGeometry({ id: "test", minSize: chat ? { width: 300, height: 120 } : { width: 320, height: 220 }, preferredHeight,
    initialRect: () => ({ x: 500, y: 200, width: 500, height: 500 }) });
  return createElement("section", { ref: geometry.hostRef, style: geometry.style, ...geometry.shellProps },
    createElement("header", { tabIndex: 0, ...geometry.titleProps }, "Window", createElement(WindowControls, { geometry, title: "Test" })),
    createElement("main", { hidden: geometry.minimized }, "Window contents"), createElement(WindowResizeHandles, { geometry, title: "Test" }));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("innerWidth", 1440); vi.stubGlobal("innerHeight", 900);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
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
