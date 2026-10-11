// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isolateCompanionKeyboard } from "../apps/extension/src/entries/keyboard";

let host: HTMLDivElement, shadow: ShadowRoot, composer: HTMLTextAreaElement;
let release: () => void;
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host);
  shadow = host.attachShadow({ mode: "open" });
  composer = document.createElement("textarea"); shadow.append(composer);
  release = isolateCompanionKeyboard(shadow);
});
afterEach(() => { release(); host.remove(); vi.restoreAllMocks(); });
const key = (type: string, value: string, extra: KeyboardEventInit = {}) => new KeyboardEvent(type, {
  key: value, bubbles: true, composed: true, cancelable: true, ...extra,
});

describe("companion keyboard isolation", () => {
  it.each(["keydown", "keypress", "keyup"] as const)("keeps %s Space inside the chat without preventing text entry", (type) => {
    const pageShortcut = vi.fn((event: KeyboardEvent) => event.preventDefault());
    const control = vi.fn();
    document.addEventListener(type, pageShortcut);
    composer.addEventListener(type, control);
    try {
      const event = key(type, " ");
      expect(composer.dispatchEvent(event)).toBe(true);
      expect(event.defaultPrevented).toBe(false);
      expect(control).toHaveBeenCalledOnce();
      expect(pageShortcut).not.toHaveBeenCalled();
      // Keyboard shortcuts continue working outside the companion.
      document.body.dispatchEvent(key(type, " "));
      expect(pageShortcut).toHaveBeenCalledOnce();
    } finally { document.removeEventListener(type, pageShortcut); }
  });

  it("preserves Enter submission, Shift+Enter, composition and focus navigation", () => {
    const submitted = vi.fn(), pageShortcut = vi.fn();
    composer.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); submitted(); }
    });
    document.addEventListener("keydown", pageShortcut);
    try {
      expect(composer.dispatchEvent(key("keydown", "Enter"))).toBe(false);
      expect(submitted).toHaveBeenCalledOnce();
      expect(composer.dispatchEvent(key("keydown", "Enter", { shiftKey: true }))).toBe(true);
      expect(composer.dispatchEvent(key("keydown", "Enter", { isComposing: true }))).toBe(true);
      expect(composer.dispatchEvent(key("keydown", "Tab"))).toBe(true);
      expect(composer.dispatchEvent(key("keydown", "k"))).toBe(true);
      expect(submitted).toHaveBeenCalledOnce();
      expect(pageShortcut).not.toHaveBeenCalled();
    } finally { document.removeEventListener("keydown", pageShortcut); }
  });

  it("keeps Escape available to the companion's cancel/close handlers", () => {
    const close = vi.fn(); window.addEventListener("keydown", close);
    try {
      composer.dispatchEvent(key("keydown", "Escape"));
      expect(close).toHaveBeenCalledOnce();
    } finally { window.removeEventListener("keydown", close); }
  });

  it("cleans up when the content script unmounts", () => {
    const pageShortcut = vi.fn(); document.addEventListener("keydown", pageShortcut);
    try {
      release(); composer.dispatchEvent(key("keydown", " "));
      expect(pageShortcut).toHaveBeenCalledOnce();
    } finally { document.removeEventListener("keydown", pageShortcut); }
  });
});
