// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatScroll } from "./useChatScroll";

let root: Root, host: HTMLDivElement, height: number, contentHeight: number, top: number;
let frames: Map<number, FrameRequestCallback>, sequence: number, resize: () => void;
let visibility: "visible" | "hidden";
let options: Parameters<typeof useChatScroll>[0];
const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
function Chat() {
  const scroll = useChatScroll(options);
  return createElement("div", { ref: scroll.ref, onScroll: scroll.onScroll });
}
const render = () => act(async () => root.render(createElement(Chat)));
const flush = () => { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(0); };
const move = (value: number) => { top = value; host.firstElementChild!.dispatchEvent(new Event("scroll")); };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  height = 200; contentHeight = 2000; top = 0; sequence = 0; frames = new Map(); visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { const id = ++sequence; frames.set(id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
  options = { conversationId: "first-chat", ready: true, open: true, lastMessage: { id: "last", role: "assistant" } };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  if (originalVisibility) Object.defineProperty(document, "visibilityState", originalVisibility);
  else Reflect.deleteProperty(document, "visibilityState");
});
async function mount() {
  await render();
  Object.defineProperties(host.firstElementChild!, {
    clientHeight: { configurable: true, get: () => height },
    scrollHeight: { configurable: true, get: () => contentHeight },
    scrollTop: { configurable: true, get: () => top, set: (value: number) => { top = Math.max(0, Math.min(value, contentHeight - height)); } },
  });
}
describe("latest conversation scrolling", () => {
  it("waits for window restoration and visible layout before scrolling", async () => {
    options.ready = false; height = 0; await mount(); flush(); expect(top).toBe(0);
    options.ready = true; await render(); flush(); expect(top).toBe(0);
    height = 200; resize(); flush(); expect(top).toBe(1800);
    // Opening a previously hidden or minimized chat also restores the latest message.
    options.open = false; await render(); move(0); flush();
    options.open = true; await render(); flush(); expect(top).toBe(1800);
  });
  it("returns to the latest chat when a browser tab becomes visible or focused", async () => {
    await mount(); flush(); move(0);
    visibility = "hidden"; document.dispatchEvent(new Event("visibilitychange")); flush(); expect(top).toBe(0);
    contentHeight = 2600; visibility = "visible"; document.dispatchEvent(new Event("visibilitychange")); flush(); expect(top).toBe(2400);
    move(0); window.dispatchEvent(new Event("focus")); flush(); expect(top).toBe(2400);
  });
  it("keeps manual history scrolling during incoming messages and resets on a chat switch or sent message", async () => {
    await mount(); flush(); move(250);
    contentHeight = 2400; options.lastMessage = { id: "new-reply", role: "assistant" }; await render(); flush(); expect(top).toBe(250);
    height = 300; resize(); flush(); expect(top).toBe(250);
    options.lastMessage = { id: "my-message", role: "user" }; await render(); flush(); expect(top).toBe(2100);
    move(0); options.conversationId = "same-length-different-chat"; await render(); flush(); expect(top).toBe(2100);
  });
  it("continues following the bottom as the window resizes and cancels work on unmount", async () => {
    await mount(); flush(); height = 150; resize(); flush(); expect(top).toBe(1850);
    resize(); expect(frames.size).toBe(1);
    await act(async () => root.unmount()); expect(frames.size).toBe(0); root = createRoot(host);
  });
});
