// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FrameToolProvider, invokeFrameTool, useWorkbench, WorkbenchContext, type WorkbenchState } from "../apps/extension/src/ui/WorkbenchContext";
import { ToolOverlay } from "../apps/extension/src/ui/ToolOverlay";
import { request } from "../apps/extension/src/bridge";
vi.mock("../apps/extension/src/bridge", () => ({ request: vi.fn() }));
vi.mock("../apps/extension/src/ui/Board", () => ({ Board: () => null }));
vi.mock("../apps/extension/src/ui/Video", () => ({ Video: () => null }));
vi.mock("../apps/extension/src/ui/Documents", () => ({ Documents: () => null }));
vi.mock("../apps/extension/src/ui/CompanionTools", () => ({ CompanionTools: () => null }));
vi.mock("../apps/extension/src/ui/FloatingToolWindow", () => ({ FloatingToolWindow: ({ children }: { children: ReactNode }) => createElement("section", null, children) }));
let frame: HTMLIFrameElement;
let root: Root | undefined, container: HTMLDivElement | undefined;
beforeEach(() => {
  vi.stubGlobal("chrome", { runtime: { getURL: (path: string) => `https://extension.test/${path}` } });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  history.replaceState(null, "", "/"); root = undefined; container = undefined;
  vi.mocked(request).mockReset();
  frame = document.createElement("iframe"); frame.src = "https://extension.test/preferences.html?channel=channel-one"; document.body.append(frame);
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); container?.remove(); frame.remove(); vi.unstubAllGlobals(); });
it("does not send a privileged command after cancellation while its grant is pending", async () => {
  let grant!: (value: any) => void;
  vi.mocked(request).mockImplementation(async (message) => message.type === "frame.grant" ? new Promise((resolve) => { grant = resolve; }) : {});
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  const result = invokeFrameTool(frame, "phone", "send", { text: "hello" }, "conversation-one");
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  window.dispatchEvent(new Event("hypeman.cancel-tools"));
  grant({ token: "late-token" }); await rejected; await Promise.resolve();
  expect(post).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledWith({ type: "frame.revoke", token: "late-token" });
});
it("ignores a result from another window and accepts only the selected frame", async () => {
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  const result = invokeFrameTool(frame, "phone", "status", {}, "conversation-one", "token");
  const command = post.mock.calls[0][0] as { requestId: string };
  const data = { type: "hypeman.tool-result", channel: "channel-one", requestId: command.requestId, result: "Paired" };
  let completed = false; void result.then(() => { completed = true; });
  window.dispatchEvent(new MessageEvent("message", { origin: "https://extension.test", source: window, data }));
  await Promise.resolve(); expect(completed).toBe(false);
  window.dispatchEvent(new MessageEvent("message", { origin: "https://extension.test", source: frame.contentWindow, data }));
  await expect(result).resolves.toBe("Paired");
});
it("opens Account and Phone from Preferences through a scoped UI navigation message", async () => {
  history.replaceState(null, "", "/preferences.html?channel=channel-one&conversationId=conversation-one&parentOrigin=https%3A%2F%2Fpage.test");
  const post = vi.fn(); vi.stubGlobal("parent", { postMessage: post });
  let navigate!: WorkbenchState["openTool"];
  function Shortcuts() {
    const workbench = useWorkbench(); navigate = workbench.openTool;
    return createElement("div", null,
      createElement("button", { onClick: () => workbench.openTool("connection") }, "Account"),
      createElement("button", { onClick: () => workbench.openTool("phone") }, "Phone"));
  }
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(createElement(FrameToolProvider, { children: createElement(Shortcuts) })));
  await act(async () => { container!.querySelectorAll("button").forEach((button) => button.click()); });
  expect(post.mock.calls).toEqual([
    [{ type: "hypeman.open-overlay", tool: "connection", channel: "channel-one", conversationId: "conversation-one" }, "https://page.test"],
    [{ type: "hypeman.open-overlay", tool: "phone", channel: "channel-one", conversationId: "conversation-one" }, "https://page.test"],
  ]);
  await act(async () => { navigate("__proto__"); navigate("send"); navigate(null); });
  expect(post).toHaveBeenCalledTimes(2);
  expect(request).not.toHaveBeenCalled();
});
it("ignores frame navigation without an embedding channel and origin", async () => {
  const post = vi.fn(); vi.stubGlobal("parent", { postMessage: post });
  let navigate!: WorkbenchState["openTool"];
  function Shortcut() { navigate = useWorkbench().openTool; return null; }
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(createElement(FrameToolProvider, { children: createElement(Shortcut) })));
  await act(async () => navigate("connection"));
  expect(post).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
});
it("accepts recognized overlay navigation only from its registered frame, channel, conversation, and origin", async () => {
  const openTool = vi.fn();
  const workbench: WorkbenchState = { conversationId: "conversation-one", selected: null, selectContent: vi.fn(), openTool,
    send: async () => {}, executeTool: async () => {}, register: () => () => {} };
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(createElement(WorkbenchContext.Provider, { value: workbench },
    createElement(ToolOverlay, { section: "settings", onClose: vi.fn() }))));
  const preferences = container.querySelector("iframe")!, channel = new URL(preferences.src).searchParams.get("channel");
  const data = { type: "hypeman.open-overlay", tool: "connection", channel, conversationId: "conversation-one" };
  const send = (overrides: Partial<MessageEventInit> = {}) => window.dispatchEvent(new MessageEvent("message", {
    origin: "https://extension.test", source: preferences.contentWindow, data, ...overrides,
  }));
  await act(async () => {
    send({ origin: "https://hostile.test" }); send({ source: frame.contentWindow }); send({ data: { ...data, channel: "wrong-channel" } });
    send({ data: { ...data, conversationId: "another-conversation" } }); send({ data: { ...data, tool: "__proto__" } }); send({ data: { ...data, tool: null } });
  });
  expect(openTool).not.toHaveBeenCalled();
  await act(async () => { send(); send({ data: { ...data, tool: "phone" } }); });
  expect(openTool.mock.calls).toEqual([["connection"], ["phone"]]);
  expect(request).not.toHaveBeenCalled();
});
