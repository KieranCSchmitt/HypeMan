// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DEFAULT_SETTINGS, emptyWorkspace } from "@core";
import { NewTab } from "../apps/extension/src/ui/NewTab";
import { request } from "../apps/extension/src/bridge";
import { useReducedMotion, useSettings, useWorkspace } from "../apps/extension/src/ui/hooks";

vi.mock("../apps/extension/src/bridge", () => ({
  request: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));
vi.mock("../apps/extension/src/ui/Rooftop", () => ({ Rooftop: () => null }));
vi.mock("../apps/extension/src/ui/ToolOverlay", () => ({
  ToolOverlay: ({ section, onClose }: { section: string | null; onClose: () => void }) => section
    ? createElement("section", { "data-section": section }, createElement("button", { "aria-label": "Close tools", onClick: onClose })) : null,
}));
vi.mock("../apps/extension/src/ui/CompanionTools", () => ({
  CompanionTools: ({ section, onClose }: { section: string; onClose: () => void }) =>
    createElement("section", { "data-section": section },
      createElement("button", { "aria-label": "Close tools", onClick: onClose })),
}));
vi.mock("../apps/extension/src/ui/hooks", () => ({
  useSettings: vi.fn(),
  useWorkspace: vi.fn(),
  useReducedMotion: vi.fn(),
  exportWorkspace: vi.fn(),
  openPage: vi.fn(),
  message: (error: unknown) => error instanceof Error ? error.message : String(error),
}));

let root: Root, container: HTMLDivElement;
const refresh = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal("chrome", { tabs: { create: vi.fn() } });
  history.replaceState(null, "", "/");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  refresh.mockReset().mockResolvedValue(undefined);
  vi.mocked(useSettings).mockReturnValue({ settings: DEFAULT_SETTINGS, patch: vi.fn(), error: "" });
  vi.mocked(useWorkspace).mockReturnValue({
    workspace: emptyWorkspace(), refresh, loading: false, error: "",
  });
  vi.mocked(useReducedMotion).mockReturnValue(true);
  vi.mocked(request).mockReset().mockResolvedValue({ text: "Fixture answer." });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(createElement(NewTab)));
}
function button(label: string) {
  const found = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(found, `Missing icon button: ${label}`).not.toBeNull();
  return found!;
}
async function fill(value: string) {
  await act(async () => {
    const field = container.querySelector<HTMLInputElement>("#task-goal")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => container.querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

describe("single-field companion new tab", () => {
  it("starts with one text field and named icons instead of dashboard links", async () => {
    await render();
    expect(container.querySelectorAll("input,textarea")).toHaveLength(1);
    expect(container.querySelector('input[type="url"]')).toBeNull();
    expect(container.querySelector('a[href*="control.html"]')).toBeNull();
    expect(container.querySelector('a[href*="onboarding.html"]')).toBeNull();
    for (const name of ["Tasks", "Saved notes", "Whiteboard", "More tools"])
      expect(button(name).textContent).toBe("");
    expect(button("Start task").disabled).toBe(true);
  });

  it("starts from a link in the same natural-language task field", async () => {
    await render();
    const goal = "Read https://example.com/help, and save the important facts.";
    await fill(`  ${goal}  `);
    await submit();
    expect(request).toHaveBeenCalledWith({
      type: "task.start", goal, url: "https://example.com/help",
    }, expect.any(AbortSignal));
    expect(refresh).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLInputElement>("#task-goal")!.value).toBe("");
  });

  it("routes a question through the same field without starting a browser task", async () => {
    await render();
    await act(async () => button("Ask HypeMan mode").click());
    await fill("What can you help with?");
    await submit();
    expect(request).toHaveBeenCalledWith({
      type: "assistant.ask", message: "What can you help with?",
    }, expect.any(AbortSignal));
    expect(vi.mocked(request).mock.calls.some(([message]) => message.type === "task.start")).toBe(false);
    expect(container.querySelector(".answer")?.textContent).toBe("Fixture answer.");
  });

  it("opens collections inline and returns focus to the same composer when closed", async () => {
    await render();
    for (const [name, section] of [["Tasks", "tasks"], ["Saved notes", "notes"], ["Whiteboard", "board"]]) {
      await act(async () => button(name!).click());
      expect(container.querySelector(`[data-section="${section}"]`)).not.toBeNull();
      expect(location.hash).toBe(`#${section}`);
      await act(async () => button("Close tools").click());
      expect(container.querySelector("[data-section]")).toBeNull();
      expect(document.activeElement).toBe(container.querySelector("#task-goal"));
    }
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it("cancels an outstanding question and ignores its late response", async () => {
    let finish!: (reply: unknown) => void;
    vi.mocked(request).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await render();
    await act(async () => button("Ask HypeMan mode").click());
    await fill("A slow question");
    await submit();
    const signal = vi.mocked(request).mock.calls[0]![1]!;
    await act(async () => button("Cancel request").click());
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ text: "Late answer should stay hidden." }));
    expect(container.querySelector(".answer")).toBeNull();
    expect(button("Ask HypeMan").disabled).toBe(false);
  });
});
