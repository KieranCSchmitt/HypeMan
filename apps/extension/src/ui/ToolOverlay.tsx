import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Action, SelectedContent } from "@core";
import { Board } from "./Board";
import { Video, type NativeVideoState } from "./Video";
import { Documents } from "./Documents";
import { CompanionTools, type CompanionSection } from "./CompanionTools";
import { isOverlaySection, overlaySections, type OverlaySection } from "./overlay-sections";
import { invokeFrameTool, useToolHandler, useWorkbench } from "./WorkbenchContext";
import { FloatingToolWindow } from "./FloatingToolWindow";
export function ToolOverlay({ section, openSections, onFocus, onClose, onError, onStartTask, conversationId: supplied, sketch, pageVideo, onVideoSeek, onNativeVideoCommand, onVideoCaptionsChange }: {
  section: OverlaySection | null; openSections?: OverlaySection[]; onClose: (section: OverlaySection) => void; onFocus?: (section: OverlaySection) => void;
  onError?: (message: string) => void; onStartTask?: () => void; conversationId?: string;
  pageVideo?: NativeVideoState | null; onVideoSeek?: (seconds: number) => void; onNativeVideoCommand?: (operation: string, args: Record<string, unknown>) => Promise<string | void> | string | void; onVideoCaptionsChange?: (text: string) => Promise<void> | void;
  sketch?: Extract<Action, { type: "sketch" }> | null; videoContent?: ReactNode; learningContent?: ReactNode; boardContent?: ReactNode; notesActions?: ReactNode;
}) {
  const workbench = useWorkbench(), conversationId = supplied || workbench.conversationId;
  const frames = useRef(new Map<string, HTMLIFrameElement>()), ready = useRef(new Set<string>());
  const cancellation = useRef(0);
  const frameRefs = useRef<Record<string, (element: HTMLIFrameElement | null) => void>>({});
  const [channels] = useState(() => ({ settings: crypto.randomUUID(), phone: crypto.randomUUID(), connection: crypto.randomUUID() }));
  const [studios, setStudios] = useState(new Set<OverlaySection>());
  const extensionPage = location.protocol === "chrome-extension:", activeSection = section;
  const opened = new Set<OverlaySection>(openSections || (activeSection ? [activeSection] : []));
  const openedKey = [...opened].join(",");
  useEffect(() => { setStudios((current) => new Set([...current, ...opened])); }, [openedKey]);
  useEffect(() => {
    const cancel = () => { cancellation.current++; };
    window.addEventListener("hypeman.cancel-tools", cancel);
    return () => { cancellation.current++; window.removeEventListener("hypeman.cancel-tools", cancel); };
  }, []);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== chrome.runtime.getURL("").replace(/\/$/, "")) return;
      const entry = [...frames.current.entries()].find(([, frame]) => event.source === frame.contentWindow);
      if (!entry) return;
      const [tool, frame] = entry, query = new URL(frame.src).searchParams;
      if (event.data?.channel !== query.get("channel") || event.data?.conversationId !== conversationId) return;
      if (event.data.type === "hypeman.close-overlay") onClose(tool as OverlaySection);
      if (event.data.type === "hypeman.open-overlay" && isOverlaySection(event.data.tool)) workbench.openTool(event.data.tool);
      if (event.data.type === "hypeman.escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      if (event.data.type === "hypeman.tool-selection") {
        const selected = event.data.selected as SelectedContent | null;
        if (selected === null || selected && typeof selected.kind === "string" && typeof selected.id === "string") workbench.selectContent(selected);
      }
    };
    window.addEventListener("message", receive); return () => window.removeEventListener("message", receive);
  }, [conversationId, onClose, workbench.selectContent, workbench.openTool]);
  const relay = async (tool: string, operation: string, args: Record<string, unknown>) => {
    const version = cancellation.current;
    const check = () => { if (version !== cancellation.current) throw new DOMException("Cancelled", "AbortError"); };
    for (let attempt = 0; attempt < 150 && (!frames.current.has(tool) || !ready.current.has(tool)); attempt++) { check(); await new Promise((resolve) => setTimeout(resolve, 30)); }
    check();
    const frame = frames.current.get(tool); if (!frame || !ready.current.has(tool)) throw new Error("The tool is still opening. Try again.");
    return invokeFrameTool(frame, tool, operation, { ...args, ...(workbench.selected ? { selected: workbench.selected } : {}) }, conversationId);
  };
  useToolHandler(extensionPage ? "__settings-frame" : "settings", (operation, args) => relay("settings", operation, args));
  useToolHandler("phone", (operation, args) => relay("phone", operation, args));
  useToolHandler("connection", (operation, args) => relay("connection", operation, args));
  const frame = (tool: "settings" | "phone" | "connection") => {
    const query = new URLSearchParams({ tool, conversationId, channel: channels[tool], parentOrigin: location.origin });
    if (!frameRefs.current[tool]) frameRefs.current[tool] = (element) => { if (element) frames.current.set(tool, element); else { frames.current.delete(tool); ready.current.delete(tool); } };
    return <iframe key={`${conversationId}:${tool}`} ref={frameRefs.current[tool]} onLoad={() => ready.current.add(tool)} className={`workspace-${tool}-frame`} title={overlaySections[tool].title} src={`${chrome.runtime.getURL(tool === "connection" ? "connection.html" : "preferences.html")}?${query}`} />;
  };
  return <>{[...new Set([...studios, ...opened])].map((tool, index) => {
    const open = opened.has(tool), collection = ["tasks", "notes", "activity", "learning", ...(extensionPage ? ["settings"] : [])].includes(tool);
    const close = () => onClose(tool);
    return <FloatingToolWindow key={tool} section={tool} open={open} focused={activeSection === tool} cascade={index} onFocus={(name) => { if (name !== activeSection) onFocus?.(name); }} onClose={onClose}>
      {collection && <CompanionTools key={`${conversationId}:${tool}`} embedded section={tool as CompanionSection} onClose={close} onError={onError} onStartTask={onStartTask} />}
      {tool === "board" && <Board key={conversationId} embedded active={open} conversationId={conversationId} sketch={sketch} />}
      {tool === "video" && <Video key={conversationId} embedded active={open} nativeState={pageVideo} onSeek={onVideoSeek} onNativeCommand={onNativeVideoCommand} onCaptionsChange={onVideoCaptionsChange} />}
      {tool === "documents" && <Documents key={conversationId} active={open} conversationId={conversationId} />}
      {tool === "settings" && !extensionPage && frame("settings")}
      {tool === "phone" && frame("phone")}
      {tool === "connection" && frame("connection")}
    </FloatingToolWindow>;
  })}</>;
}
