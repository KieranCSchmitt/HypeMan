import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { parseToolAction, type SelectedContent } from "@core";
import { request } from "../bridge";

export type ToolHandler = (operation: string, args: Record<string, unknown>) => Promise<string | void> | string | void;
export interface WorkbenchState {
  conversationId: string;
  selected: SelectedContent | null;
  selectContent: (content: SelectedContent | null) => void;
  openTool: (tool: string | null) => void;
  send: (message: string) => Promise<void>;
  executeTool: (tool: string, operation: string, args?: Record<string, unknown>) => Promise<string | void>;
  register: (tool: string, handler: ToolHandler) => () => void;
}
const noop = () => {};
const fallback: WorkbenchState = { conversationId: "default", selected: null, selectContent: noop,
  openTool: noop, send: async () => {}, executeTool: async () => { throw new Error("Open this tool in HypeMan's conversation."); }, register: () => noop };
export const WorkbenchContext = createContext<WorkbenchState>(fallback);
export const useWorkbench = () => useContext(WorkbenchContext);
export function useToolHandler(tool: string | null, handler: ToolHandler) {
  const { register } = useWorkbench();
  const latest = useRef(handler); latest.current = handler;
  useEffect(() => tool ? register(tool, (operation, args) => latest.current(operation, args)) : undefined, [tool, register]);
}

/** Only the extension frame named by this channel can complete a privileged operation. */
export async function invokeFrameTool(frame: HTMLIFrameElement, tool: string, operation: string,
  args: Record<string, unknown> = {}, conversationId = "default", suppliedToken?: string): Promise<string | void> {
  const url = new URL(frame.src), channel = url.searchParams.get("channel");
  if (!channel || url.origin !== chrome.runtime.getURL("").replace(/\/$/, "")) return Promise.reject(new Error("Invalid tool frame."));
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    let token = suppliedToken, settled = false;
    const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", receive); window.removeEventListener("hypeman.cancel-tools", cancel); };
    const cancel = () => {
      settled = true;
      if (token) frame.contentWindow?.postMessage({ type: "hypeman.tool-cancel", requestId, channel, conversationId, tool, token }, url.origin);
      cleanup(); reject(new DOMException("Cancelled", "AbortError"));
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== url.origin || event.data?.channel !== channel || event.data?.requestId !== requestId) return;
      if (event.data.type !== "hypeman.tool-result") return;
      settled = true;
      cleanup(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result);
    };
    const timer = setTimeout(() => { settled = true; cleanup(); reject(new Error("Tool took too long. Try again.")); }, 95000);
    window.addEventListener("message", receive);
    window.addEventListener("hypeman.cancel-tools", cancel);
    void (async () => {
      try {
        token ||= (await request<{ token: string }>({ type: "frame.grant", tool, channel, conversationId })).token;
        if (settled) { if (!suppliedToken) void request({ type: "frame.revoke", token }).catch(() => {}); return; }
        frame.contentWindow?.postMessage({ type: "hypeman.tool-command", requestId, tool, operation, args, conversationId, channel, token }, url.origin);
      } catch (error) { if (!settled) { settled = true; cleanup(); reject(error); } }
    })();
  });
}

/** Local-only tool frames keep privileged handlers out of the embedding webpage. */
export function FrameToolProvider({ children, conversationId }: { children: ReactNode; conversationId?: string; tool?: string }) {
  const handlers = useRef(new Map<string, ToolHandler>());
  const query = new URLSearchParams(location.search);
  const id = conversationId || query.get("conversationId") || "default";
  const [selected, setSelected] = useState<SelectedContent | null>(null);
  const selectContent = (content: SelectedContent | null) => {
    setSelected(content);
    const channel = query.get("channel");
    if (channel && parent !== window) parent.postMessage({ type: "hypeman.tool-selection", channel, conversationId: id, selected: content }, "*");
  };
  const register = useRef((tool: string, handler: ToolHandler) => {
    handlers.current.set(tool, handler);
    return () => { if (handlers.current.get(tool) === handler) handlers.current.delete(tool); };
  }).current;
  const executeTool = async (tool: string, operation: string, args: Record<string, unknown> = {}) => {
    const handler = handlers.current.get(tool); if (!handler) throw new Error("Tool is still opening. Try again.");
    return handler(operation, args);
  };
  useEffect(() => {
    const channel = query.get("channel");
    const receive = async (event: MessageEvent) => {
      if (!channel || event.source !== parent || event.data?.channel !== channel || event.data.conversationId !== id) return;
      if (!["hypeman.tool-command", "hypeman.tool-cancel"].includes(event.data.type)) return;
      if (query.get("parentOrigin") && event.origin !== query.get("parentOrigin")) return;
      const response = { type: "hypeman.tool-result", channel, requestId: event.data.requestId };
      try {
        await request({ type: "frame.check", tool: event.data.tool, channel, conversationId: id, token: event.data.token });
        if (event.data.type === "hypeman.tool-cancel") { window.dispatchEvent(new Event("hypeman.cancel-tools")); return; }
        if (!parseToolAction({ type: "tool", tool: event.data.tool, operation: event.data.operation, args: event.data.args || {} })) throw new Error("Unknown tool operation.");
        if (event.data.args?.selected) setSelected(event.data.args.selected);
        parent.postMessage({ ...response, result: await executeTool(event.data.tool, event.data.operation, event.data.args || {}) }, event.origin);
      }
      catch (error) { parent.postMessage({ ...response, error: error instanceof Error ? error.message : String(error) }, event.origin); }
    };
    window.addEventListener("message", receive); return () => window.removeEventListener("message", receive);
  }, [id]);
  return <WorkbenchContext.Provider value={{ ...fallback, conversationId: id, selected, selectContent, register, executeTool }}>{children}</WorkbenchContext.Provider>;
}
