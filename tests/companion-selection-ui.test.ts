// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@core";
import { Companion } from "../apps/extension/src/ui/Companion";
import type { CompanionRuntime, CompanionSnapshot } from "../apps/extension/src/runtime/types";

vi.mock("../apps/extension/src/bridge", () => ({ request: vi.fn(), subscribe: vi.fn(() => () => {}) }));
vi.mock("../apps/extension/src/ui/Pet", () => ({ Pet: () => null }));
vi.mock("../apps/extension/src/ui/ToolOverlay", () => ({ ToolOverlay: () => null }));
vi.mock("../apps/extension/src/ui/Video", () => ({ Video: () => null }));

let root: Root, container: HTMLDivElement;
let snapshot: CompanionSnapshot;
let notify: () => void;
const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  document.body.innerHTML = '<p id="source">The nervous system carries signals around the body.</p>';
  const range = document.createRange(); range.selectNodeContents(document.getElementById("source")!);
  document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  snapshot = {
    phase: "idle", status: "Ready", confirmation: null, task: null, video: null,
    messages: [{ id: "explanation-1", role: "assistant", text: "Nerves carry signals between your brain and body.", at: 1 }],
    learning: { enabled: false, hintLevel: 0, plan: [], teaching: null,
      autoHint: { id: "explanation-1", kind: "explanation", text: "Nerves carry signals between your brain and body." } },
    sketch: null, settings: DEFAULT_SETTINGS, reducedMotion: true, screenshotAttached: false,
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); document.getSelection()!.removeAllRanges();
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  vi.unstubAllGlobals();
});
async function render() {
  const runtime: CompanionRuntime = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { notify = listener; return () => {}; },
    start: async () => {}, send: async () => {}, confirm: vi.fn(), stop: vi.fn(), setSettings: vi.fn(),
    pinSelection: async () => {}, attachScreenshot: vi.fn(), teach: vi.fn(), suspend: vi.fn(),
    resume: async () => {}, dispose: vi.fn(),
  };
  await act(async () => root.render(createElement(Companion, { runtime })));
}
function button(label: string) {
  const found = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(found).not.toBeNull(); return found!;
}
async function pressWithNativeSelectionDefault(label: string) {
  const target = button(label);
  await act(async () => {
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    // The browser's uncancelled button press clears the page selection, which
    // removes the live preview before click can open or dismiss it.
    if (!event.defaultPrevented) {
      document.getSelection()!.removeAllRanges();
      snapshot = { ...snapshot, learning: { ...snapshot.learning, autoHint: null } };
      notify();
    }
  });
  await act(async () => target.click());
}

describe("selection explanation preview", () => {
  it("opens the explanation without clearing the source selection before click", async () => {
    await render();
    await pressWithNativeSelectionDefault("Show explanation");
    expect(document.getSelection()!.toString()).toContain("nervous system");
    expect(container.querySelector(".companion-panel")).not.toBeNull();
    expect(container.querySelector(".companion-panel")!.textContent).toContain("Nerves carry signals");
  });
  it("dismisses the preview while retaining the selected text", async () => {
    await render();
    await pressWithNativeSelectionDefault("Dismiss explanation");
    expect(document.getSelection()!.toString()).toContain("nervous system");
    expect(container.querySelector(".pet-hint-preview")).toBeNull();
    expect(container.querySelector(".companion-panel")).toBeNull();
  });
  it("also opens with keyboard-style activation without a pointer press", async () => {
    await render();
    await act(async () => button("Show explanation").click());
    expect(container.querySelector(".companion-panel")).not.toBeNull();
  });
});
