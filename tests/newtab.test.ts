// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DEFAULT_SETTINGS } from "@core";
import { NewTab } from "../apps/extension/src/ui/NewTab";
import { request } from "../apps/extension/src/bridge";
vi.mock("../apps/extension/src/bridge", () => ({ request: vi.fn(), subscribe: () => () => {} }));
vi.mock("../apps/extension/src/ui/Rooftop", () => ({ Rooftop: ({ onCompanion }: any) => createElement("button", { "aria-label": "Open HypeMan", onClick: onCompanion }) }));
vi.mock("../apps/extension/src/ui/Pet", () => ({ Pet: () => createElement("span", null, "Avatar") }));
vi.mock("../apps/extension/src/ui/ToolOverlay", () => ({ ToolOverlay: ({ section, onClose }: any) => section ? createElement("section", { "data-section": section }, createElement("button", { "aria-label": "Close tools", onClick: () => onClose(section) })) : null }));
vi.mock("../apps/extension/src/ui/hooks", () => ({ useSettings: () => ({ settings: DEFAULT_SETTINGS, error: "", patch: vi.fn() }), useReducedMotion: () => true }));
let root: Root, container: HTMLDivElement;
let decide: (message: any, signal?: AbortSignal) => Promise<any>;
let saved: Array<any>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("chrome", { tabs: {} });
  history.replaceState(null, "", "/"); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  saved = []; decide = async () => ({ action: { type: "say", text: "Fixture answer." }, done: true });
  vi.mocked(request).mockReset().mockImplementation(async (message, signal) => {
    if (message.type === "conversation.resolve") return { id: "fixture-conversation", messages: saved };
    if (message.type === "workbench.ui.get") return null;
    if (message.type === "conversation.append") { saved.push(message.message); return {}; }
    if (message.type === "assistant.turn") return decide(message, signal);
    return {};
  });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(open = true, initialTool?: string) {
  await act(async () => root.render(createElement(NewTab, { initialTool })));
  if (open && !container.querySelector("textarea")) await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Open HypeMan"]')!.click());
}
async function fill(value: string) { await act(async () => { const field = container.querySelector("textarea")!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function submit() { await act(async () => { container.querySelector("form.conversation-composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); }
describe("shared conversation", () => {
  it("starts as a quiet rooftop and opens the conversation only from the avatar", async () => {
    await render(false);
    expect(container.querySelector(".conversation-workbench")).toBeNull();
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ type: "conversation.resolve" }));
    expect([...container.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"))).toEqual(["Open HypeMan", "Open HypeMan chat"]);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Open HypeMan"]')!.click());
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(container.querySelector("main")!.hidden).toBe(false);
  });
  it("provides regular web search without sending the query to HypeMan", async () => {
    await render(false);
    const search = container.querySelector<HTMLFormElement>('form[role="search"]')!;
    expect(search.action).toBe("https://www.google.com/search"); expect(search.method).toBe("get");
    const field = search.querySelector<HTMLInputElement>('input[type="search"]')!;
    field.value = "space telescope";
    expect(new FormData(search).get("q")).toBe("space telescope");
    expect(container.querySelector("textarea")).toBeNull(); expect(request).not.toHaveBeenCalled();
  });
  it("opens and closes the same conversation from its bottom-right avatar", async () => {
    await render(false);
    const avatar = container.querySelector<HTMLButtonElement>(".newtab-avatar-icon")!;
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = "space telescope";
    const expectSearchPreserved = () => {
      expect(container.querySelector('input[type="search"]')).toBe(search);
      expect(search.closest("[hidden]")).toBeNull();
      expect(new FormData(search.form!).get("q")).toBe("space telescope");
    };
    await act(async () => avatar.click());
    const composer = container.querySelector("textarea"); expect(composer).not.toBeNull();
    expect(avatar.getAttribute("aria-expanded")).toBe("true");
    expectSearchPreserved();
    await act(async () => avatar.click()); expect(container.querySelector("main")!.hidden).toBe(true);
    expectSearchPreserved();
    await act(async () => avatar.click()); expect(container.querySelector("textarea")).toBe(composer);
    expectSearchPreserved();
  });
  it("opens explicit chat continuations without requiring another avatar click", async () => {
    history.replaceState(null, "", "/#chat");
    await render(false);
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(container.querySelector("main")!.hidden).toBe(false);
    const search = container.querySelector('input[type="search"]');
    expect(search).not.toBeNull(); expect(search!.closest("[hidden]")).toBeNull();
  });
  it("keeps dedicated tool pages without web search", async () => {
    await render(false, "board");
    expect(container.querySelector('form[role="search"]')).toBeNull();
    expect(container.querySelector('[data-section="board"]')).not.toBeNull();
    expect(container.querySelector("main")!.hidden).toBe(false);
  });
  it("has one composer, contextual file input, and no persistent feature launchers or modes", async () => {
    await render(); expect(container.querySelectorAll("textarea")).toHaveLength(1);
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
    expect([...container.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")).sort()).toEqual(["Attach a file", "Close HypeMan chat", "Close HypeMan window", "Maximize HypeMan window", "Minimize HypeMan window", "Open HypeMan", "Send message"]);
    expect(container.querySelector(".conversation-context")).toBeNull();
    expect(container.querySelector(".conversation-welcome")).toBeNull();
    expect(container.querySelector('a[href*="control.html"]')).toBeNull();
  });
  it("decides ordinary questions before any navigation and persists the answer", async () => {
    await render(); await fill("What is inertia?"); await submit();
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: "assistant.turn", conversationId: "fixture-conversation", message: "What is inertia?" }), expect.any(AbortSignal));
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ type: "assistant.run" }));
    expect(container.textContent).toContain("Fixture answer."); expect(saved.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
  it.each(["button", "Enter"])("clears on %s submission and preserves the next draft when the reply arrives", async (method) => {
    let finish!: (value: any) => void;
    decide = async () => new Promise((resolve) => { finish = resolve; });
    await render(); await fill("A slow question");
    await act(async () => {
      if (method === "button") container.querySelector<HTMLButtonElement>('[aria-label="Send message"]')!.click();
      else container.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(container.querySelector("textarea")!.value).toBe("");
    expect(container.querySelector('[aria-label="Stop"]')).not.toBeNull();
    expect(saved.find((message) => message.role === "user")?.text).toBe("A slow question");
    await fill("My next question");
    await act(async () => finish({ action: { type: "say", text: "Fixture answer." } }));
    expect(container.textContent).toContain("Fixture answer.");
    expect(container.querySelector("textarea")!.value).toBe("My next question");
  });
  it("opens tools through chat locally and keeps the same composer on close", async () => {
    await render(); await fill("open whiteboard"); await submit(); expect(container.querySelector('[data-section="board"]')).not.toBeNull();
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ type: "assistant.turn" }), expect.anything());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close tools"]')!.click());
    expect(container.querySelector("[data-section]")).toBeNull(); expect(document.activeElement).toBe(container.querySelector("textarea"));
  });
  it("dispatches only a decided browser action with the conversation ID", async () => {
    decide = async () => ({ action: { type: "navigate", url: "https://example.com/help" } });
    await render(); await fill("Read https://example.com/help"); await submit();
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: "assistant.run", conversationId: "fixture-conversation", url: "https://example.com/help" }));
  });
  it("dispatches the latest submitted goal after an earlier question", async () => {
    await render(); await fill("What can you do?"); await submit();
    decide = async () => ({ action: { type: "plan", goal: "Compare then prepare", steps: ["Compare two sources", "Prepare the chosen option"] } });
    await fill("Compare two sources then prepare the chosen option"); await submit();
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: "assistant.run", goal: "Compare two sources then prepare the chosen option" }));
  });
  it("cancels a request, preserves the next unsent draft, and ignores a late answer", async () => {
    let finish!: (value: any) => void; let signal!: AbortSignal;
    decide = async (_message, requestSignal) => { signal = requestSignal!; return new Promise((resolve) => { finish = resolve; }); };
    await render(); await fill("A slow question"); await submit();
    expect(container.querySelector("textarea")!.value).toBe("");
    await fill("An unsent follow-up");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Stop"]')!.click()); expect(signal.aborted).toBe(true);
    await act(async () => finish({ action: { type: "say", text: "Late answer" } }));
    expect(container.textContent).not.toContain("Late answer"); expect(container.querySelector("textarea")!.value).toBe("An unsent follow-up");
  });
  it("keeps the sent message in history and the composer clear when a request fails", async () => {
    decide = async () => { throw new Error("Reconnect the local server."); };
    await render(); await fill("Please help"); await submit();
    expect(container.textContent).toContain("Reconnect the local server."); expect(container.querySelector("textarea")!.value).toBe("");
    expect(container.querySelector(".chat-message.user")!.textContent).toBe("Please help");
  });
  it("cancels when the mascot closes chat and does not reopen a tool from a late answer", async () => {
    let finish!: (value: any) => void; let signal!: AbortSignal;
    decide = async (_message, requestSignal) => { signal = requestSignal!; return new Promise((resolve) => { finish = resolve; }); };
    await render(); await fill("Explain this with a diagram"); await submit();
    await fill("Draft after sending");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Open HypeMan"]')!.click());
    expect(signal.aborted).toBe(true);
    expect(container.querySelector("main")!.hidden).toBe(true);
    await act(async () => finish({ action: { type: "tool", tool: "board", operation: "open" } }));
    expect(container.querySelector("[data-section]")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Open HypeMan"]')!.click());
    expect(container.querySelector("textarea")!.value).toBe("Draft after sending");
  });
  it("saves conversational notes without inventing a webpage URL", async () => {
    await render(); await fill("remember: Newton's first law"); await submit();
    expect(request).toHaveBeenCalledWith({ type: "note.save", note: expect.objectContaining({ text: "Newton's first law", url: "", origin: { kind: "conversation", conversationId: "fixture-conversation" } }) });
  });
});
