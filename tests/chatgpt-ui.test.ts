// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DEFAULT_SETTINGS, type ChatGPTStatus, type Health } from "@core";
import { ChatGPTConnection } from "../apps/extension/src/ui/ChatGPTConnection";
import { request, readSettings, writeSettings } from "../apps/extension/src/bridge";
import { WorkbenchContext, type ToolHandler } from "../apps/extension/src/ui/WorkbenchContext";
const handlers = new Map<string, ToolHandler>();
const register = (tool: string, handler: ToolHandler) => { handlers.set(tool, handler); return () => { if (handlers.get(tool) === handler) handlers.delete(tool); }; };

vi.mock("../apps/extension/src/bridge", () => ({
  request: vi.fn(),
  readSettings: vi.fn(),
  writeSettings: vi.fn(),
  subscribe: vi.fn(),
}));
let root: Root, container: HTMLDivElement;
let status: ChatGPTStatus;
const health: Health = {
  ok: true,
  version: "0.2.0",
  demoMode: false,
  authRequired: true,
  capabilities: { agent: { available: false, mode: "unavailable" } },
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  handlers.clear();
  vi.mocked(readSettings).mockResolvedValue(DEFAULT_SETTINGS);
  vi.mocked(writeSettings).mockImplementation(async (patch) => ({ ...DEFAULT_SETTINGS, ...patch }));
  vi.stubGlobal("chrome", { runtime: { getURL: (path: string) => `chrome-extension://hypeman/${path}` }, storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } }, tabs: { create: vi.fn().mockResolvedValue({}) } });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  status = {
    connected: false,
    sharing: false,
    pending: false,
    activeProfileId: null,
    profiles: [],
  };
  vi.mocked(request).mockReset();
  vi.mocked(request).mockImplementation(async (message) => {
    if (message.type === "connection.ensure") return health;
    if (message.type === "chatgpt.status") return structuredClone(status);
    if (message.type === "chatgpt.login") status.pending = true;
    if (message.type === "chatgpt.cancel") status.pending = false;
    return { ok: true };
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(props: Partial<Parameters<typeof ChatGPTConnection>[0]> = {}) {
  await act(async () =>
    root.render(createElement(WorkbenchContext.Provider, { value: { conversationId: "connection-test", selected: null, selectContent: () => {}, register, openTool: () => {}, send: async () => {}, executeTool: async (tool, operation, args = {}) => handlers.get(tool)!(operation, args) } }, createElement(ChatGPTConnection, { connectionKey: "local", ...props }))),
  );
}
async function invoke(operation: string, args: Record<string, unknown> = {}) { await act(async () => { await handlers.get("connection")!(operation, args); }); }
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  );
  expect(found, `Missing button: ${label}`).toBeDefined();
  return found!;
}
describe("ChatGPT connection UI", () => {
  it("links the local gateway automatically and offers account sign-in without a token field", async () => {
    await render();
    expect(vi.mocked(request).mock.calls[0]![0]).toEqual({ type: "connection.ensure" });
    expect(vi.mocked(request).mock.calls[1]![0]).toEqual({ type: "chatgpt.status" });
    expect(container.textContent).not.toMatch(/pair|token/i);
    expect(container.querySelector('input[type="password"]')).toBeNull();
    await act(async () => button("Continue with ChatGPT").click());
    expect(request).toHaveBeenCalledWith({ type: "chatgpt.login" });
  });
  it("keeps sign-in available while the initial local connection is still being checked", async () => {
    vi.mocked(request).mockImplementationOnce(() => new Promise(() => {}));
    await render();
    expect(button("Continue with ChatGPT").disabled).toBe(false);
    await act(async () => button("Continue with ChatGPT").click());
    expect(request).toHaveBeenCalledWith({ type: "chatgpt.login" });
  });
  it("lets the same sign-in button retry after an unavailable local server", async () => {
    vi.mocked(request).mockRejectedValueOnce(
      new Error("Start HypeMan’s local server, then retry."),
    );
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Start HypeMan");
    expect(button("Continue with ChatGPT").disabled).toBe(false);
    await act(async () => button("Continue with ChatGPT").click());
    expect(request).toHaveBeenCalledWith({ type: "chatgpt.login" });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("continues automatically after a newly started sign-in succeeds", async () => {
    vi.useFakeTimers();
    const onSignedIn = vi.fn();
    await render({ onSignedIn });
    expect(onSignedIn).not.toHaveBeenCalled();
    await act(async () => button("Continue with ChatGPT").click());
    expect(onSignedIn).not.toHaveBeenCalled();
    status = { ...status, pending: false, connected: true, sharing: true };
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    expect(onSignedIn).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(onSignedIn).toHaveBeenCalledOnce();
  });
  it("polls pending sign-in only while visible and lets the user cancel", async () => {
    vi.useFakeTimers();
    status.pending = true;
    await render();
    expect(container.textContent).toContain("Finish sign-in in the opened tab");
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    expect(request).toHaveBeenCalledTimes(3);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(request).toHaveBeenCalledTimes(3);
    await act(async () => button("Cancel").click());
    expect(request).toHaveBeenCalledWith({ type: "chatgpt.cancel" });
    expect(button("Continue with ChatGPT").disabled).toBe(false);
  });
  it("shows a declined permission and offers reconnecting the existing account", async () => {
    status = {
      ...status,
      connected: true,
      activeProfileId: "personal",
      profiles: [{ id: "personal", label: "Personal", connected: true, sharing: false }],
      error: "Permission declined. Sign in again to allow ChatGPT access.",
    };
    await render();
    expect(container.textContent).toContain("Reconnect your account");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Permission declined");
    expect(container.textContent).not.toContain("Using your ChatGPT plan");
    await act(async () => button("Continue with ChatGPT").click());
    expect(request).toHaveBeenCalledWith({ type: "chatgpt.login", profileId: "personal" });
  });
  it("keeps reconnect available when a saved sharing grant encounters an authorization error", async () => {
    status = {
      ...status,
      connected: true,
      sharing: true,
      activeProfileId: "personal",
      error: "Sign-in expired. Connect again.",
    };
    await render();
    expect(button("Continue with ChatGPT").disabled).toBe(false);
    expect(container.textContent).not.toContain("Using your ChatGPT plan");
  });
  it("shows distinct saved accounts, plan usage, and the active model", async () => {
    status = {
      connected: true,
      sharing: true,
      pending: false,
      activeProfileId: "personal",
      profiles: [
        {
          id: "personal",
          label: "Account",
          email: "hypeman@example.com",
          connected: true,
          sharing: true,
        },
        {
          id: "work",
          label: "Account",
          email: "hypeman@example.com",
          connected: true,
          sharing: true,
        },
      ],
      models: [
        { slug: "model-a", displayName: "Model A" },
        { slug: "model-b", displayName: "Model B" },
      ],
      model: "model-b",
    };
    await render();
    expect(container.querySelector('.connection-state [role="status"]')?.textContent).toBe("Connected");
    expect(button("Disconnect").disabled).toBe(false);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="View usage"]')!.click());
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "https://chatgpt.com/settings/usage" });
    const [accounts, models] = [...container.querySelectorAll("select")];
    expect(accounts!.getAttribute("aria-label")).toBe("ChatGPT account");
    expect(models!.getAttribute("aria-label")).toBe("ChatGPT model");
    expect(accounts!.options[0]!.textContent).not.toBe(accounts!.options[1]!.textContent);
    expect(models!.value).toBe("model-b");
    await act(async () => {
      models!.value = "model-a";
      models!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(request).toHaveBeenCalledWith({ type: "chatgpt.model", model: "model-a" });
    await invoke("login", { newProfile: true });
    expect(button("Continue with ChatGPT")).toBeDefined();
    await act(async () => button("Continue with ChatGPT").click());
    expect(request).toHaveBeenCalledWith({ type: "chatgpt.login", newProfile: true });
    await invoke("logout");
    expect(request).toHaveBeenCalledWith({ type: "chatgpt.logout" });
  });
});
