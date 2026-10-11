import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { parseAction, type Action, type SelectedContent } from "@core";
import type { CompanionRuntime } from "../runtime/types";
import { request, subscribe } from "../bridge";
import { WorkbenchContext, type ToolHandler } from "./WorkbenchContext";
import { toolIntent } from "./tool-intents";
import { ToolOverlay } from "./ToolOverlay";
import { isOverlaySection, type OverlaySection } from "./overlay-sections";
import { uploadDocument } from "./document-client";
import { Icon } from "./Icon";
import { Notice } from "./common";
import { useSettings } from "./hooks";
import { ScreenRegion } from "./ScreenRegion";
import { parseCaptions } from "./Video";
import { MessageContent } from "./MessageContent";
import { clampWindow } from "./window-layout";
import { useWindowGeometry, WindowControls, WindowResizeHandles } from "./useWindowGeometry";
import { useConversationUI } from "./useConversationUI";
import { WindowGeometryProvider, type WindowGeometryPersistence } from "./WindowGeometryPersistence";
import type { AvatarActivity } from "./useAvatarAnimation";
import { useChatScroll } from "./useChatScroll";

interface Message { id: string; role: "user" | "assistant" | "status"; text: string; at: number }
const sections: Record<string, string> = { projects: "tasks", pdf: "documents" };
const resolveSection = (tool: string | null): OverlaySection | null => {
  const value = tool && (sections[tool] || tool); return isOverlaySection(value) ? value : null;
};
export function ConversationWorkbench({ runtime, initialTool, onClose, onActivity, onAvatarActivity, chatOpen = true, onRestoreChatOpen }: {
  runtime?: CompanionRuntime; initialTool?: string; onClose?: () => void; onActivity?: (busy: boolean) => void;
  chatOpen?: boolean; onRestoreChatOpen?: (open: boolean, conversationId: string) => boolean;
  onAvatarActivity?: (activity: AvatarActivity) => void;
}) {
  const { settings } = useSettings();
  const [conversationId, setConversationId] = useState("");
  const [hydrating, setHydrating] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [windows, setWindows] = useState<{ active: OverlaySection | null; open: OverlaySection[] }>(() => {
    const active = resolveSection(initialTool || location.hash.slice(1));
    return { active, open: active ? [active] : [] };
  });
  const windowsRef = useRef(windows); windowsRef.current = windows;
  const ui = useConversationUI(conversationId, { open: chatOpen, tools: windows.open, active: windows.active, geometry: {} }, (saved) => {
    const restored = { open: saved.tools, active: saved.active };
    windowsRef.current = restored; setWindows(restored);
    return { ...saved, open: onRestoreChatOpen?.(saved.open, conversationId) ?? saved.open };
  });
  const lastChatOpen = useRef(chatOpen);
  useEffect(() => {
    if (lastChatOpen.current !== chatOpen) { lastChatOpen.current = chatOpen; ui.patch({ open: chatOpen }); }
  }, [chatOpen, ui.patch]);
  const updateWindows = useCallback((change: (current: typeof windows) => typeof windows) => {
    const next = change(windowsRef.current);
    windowsRef.current = next; setWindows(next);
    ui.patch({ tools: next.open, active: next.active });
  }, [ui.patch]);
  const tool = windows.active;
  const closeTool = useCallback((section: OverlaySection) => {
    updateWindows((current) => {
      const open = current.open.filter((value) => value !== section);
      return { open, active: current.active === section ? open.at(-1) || null : current.active };
    });
  }, [updateWindows]);
  const setTool = useCallback((section: OverlaySection | null) => {
    updateWindows((current) => {
      const open = current.open.filter((value) => value !== (section || current.active));
      if (section) open.push(section);
      return { open, active: section || open.at(-1) || null };
    });
  }, [updateWindows]);
  const focusTool = useCallback((section: OverlaySection) => {
    if (windowsRef.current.active !== section) updateWindows((current) => ({ ...current, active: section }));
  }, [updateWindows]);
  const onGeometryChange: WindowGeometryPersistence["onGeometryChange"] = useCallback((id, snapshot) => ui.patch({ geometry: { [id]: snapshot } }), [ui.patch]);
  const persistence: WindowGeometryPersistence = { conversationId, ready: ui.ready, geometry: ui.geometry, onGeometryChange };
  const [selected, setSelected] = useState<SelectedContent | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [celebration, setCelebration] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [saved, setSaved] = useState<Array<{ id: string; title: string; messages: Message[] }>>([]);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const confirmationAnswer = useRef<((answer: boolean) => void) | null>(null);
  const [captureRegion, setCaptureRegion] = useState(false);
  const regionAnswer = useRef<((image: string | null) => void) | null>(null);
  const [snapshot, setSnapshot] = useState(() => runtime?.getSnapshot());
  const [sketch, setSketch] = useState<Extract<Action, { type: "sketch" }> | null>(null);
  const field = useRef<HTMLTextAreaElement>(null), files = useRef<HTMLInputElement>(null);
  const preferredHeight = Math.min(400, messages.length ? 360 : confirmation || snapshot?.confirmation ? 240 : image ? 220 : error ? 180 : 120);
  const chatWindow = useWindowGeometry({
    id: "chat", minSize: { width: 300, height: 120 }, preferredHeight, persistence,
    initialRect: (viewport) => clampWindow({ x: viewport.x + viewport.width - 368, y: viewport.y + viewport.height - 105 - preferredHeight, width: 340, height: preferredHeight }, viewport, { width: 300, height: 120 }),
  });
  const chatScroll = useChatScroll({ conversationId, ready: !hydrating && chatWindow.hydrated, open: chatOpen && !chatWindow.minimized, lastMessage: messages.at(-1) });
  const handlers = useRef(new Map<string, ToolHandler>());
  const pending = useRef<AbortController | null>(null);
  const state = useRef({ conversationId, messages, tool, selected }); state.current = { conversationId, messages, tool, selected };
  const seen = useRef(new Set<string>());
  const alive = useRef(true);
  const loadingSequence = useRef(0);
  const register = useCallback((name: string, handler: ToolHandler) => {
    handlers.current.set(name, handler);
    return () => { if (handlers.current.get(name) === handler) handlers.current.delete(name); };
  }, []);
  const openTool = useCallback((name: string | null) => { setTool(resolveSection(name)); }, [setTool]);
  const append = useCallback(async (role: Message["role"], text: string, id: string = crypto.randomUUID()) => {
    if (!text || !state.current.conversationId) return;
    const message = { id, role, text, at: Date.now() };
    const owner = state.current.conversationId;
    await request({ type: "conversation.append", conversationId: owner, message });
    if (alive.current && state.current.conversationId === owner) setMessages((current) => current.some((m) => m.id === id) ? current : [...current, message]);
  }, []);
  useEffect(() => {
    alive.current = true;
    const version = ++loadingSequence.current;
    void (async () => {
      const query = new URLSearchParams(location.search);
      const tab = location.protocol === "chrome-extension:" ? await chrome.tabs.getCurrent?.().catch(() => undefined) : undefined;
      const resolved = await request<{ id: string; messages: Message[] }>({ type: "conversation.resolve", ...(query.get("conversationId") ? { conversationId: query.get("conversationId") } : {}), ...(tab?.id !== undefined ? { tabId: tab.id } : {}) });
      if (!alive.current || version !== loadingSequence.current) return;
      state.current.conversationId = resolved.id; state.current.messages = resolved.messages || [];
      seen.current = new Set((resolved.messages || []).map((message) => message.id));
      setConversationId(resolved.id); setMessages(resolved.messages || []); setHydrating(false);
      runtime?.setConversationId?.(resolved.id);
    })().catch((e) => { if (alive.current && version === loadingSequence.current) { setHydrating(false); setError(String(e instanceof Error ? e.message : e)); } });
    return () => { alive.current = false; pending.current?.abort(); };
  }, [runtime]);
  useEffect(() => runtime?.subscribe(() => setSnapshot(runtime.getSnapshot())), [runtime]);
  useEffect(() => {
    const id = snapshot?.conversationId;
    if (!runtime || !id || id === state.current.conversationId) return;
    const version = ++loadingSequence.current;
    // The background already moved the running session. Cancel only UI work from its previous chat.
    pending.current?.abort(); pending.current = null;
    confirmationAnswer.current?.(false); confirmationAnswer.current = null; setConfirmation(null);
    regionAnswer.current?.(null); regionAnswer.current = null; setCaptureRegion(false);
    window.dispatchEvent(new Event("hypeman.cancel-tools"));
    state.current = { conversationId: id, messages: [], tool: null, selected: null };
    seen.current.clear(); setConversationId(id); setMessages([]); setHydrating(true);
    setWindows({ active: null, open: [] }); setSelected(null); setSketch(null); setSaved([]); setImage(null); setDraft(""); setBusy(false); setError("");
    void request<{ id: string; messages: Message[] }>({ type: "conversation.open", conversationId: id }).then((conversation) => {
      if (!alive.current || version !== loadingSequence.current || runtime.getSnapshot().conversationId !== id) return;
      const savedMessages = conversation.messages || [];
      state.current.messages = savedMessages; seen.current = new Set(savedMessages.map((message) => message.id));
      setMessages(savedMessages); setHydrating(false);
    }).catch((cause) => { if (alive.current && version === loadingSequence.current) { setHydrating(false); setError(cause instanceof Error ? cause.message : String(cause)); } });
  }, [runtime, snapshot?.conversationId]);
  useEffect(() => {
    if (!conversationId || !snapshot || hydrating || (snapshot.conversationId && snapshot.conversationId !== conversationId)) return;
    for (const message of snapshot.messages) {
      if (seen.current.has(message.id)) continue;
      if (message.role === "user" && state.current.messages.some((m) => m.role === "user" && m.text === message.text && Math.abs(m.at - message.at) < 5000)) { seen.current.add(message.id); continue; }
      seen.current.add(message.id); void append(message.role, message.text, message.id).catch((e) => setError(e.message));
    }
    if (snapshot.sketch && snapshot.sketch !== sketch) { setSketch(snapshot.sketch); setTool("board"); }
  }, [snapshot, conversationId, hydrating, append]);
  const executeTool = useCallback(async (name: string, operation: string, args: Record<string, unknown> = {}) => {
    const signal = pending.current?.signal; signal?.throwIfAborted();
    setTool(resolveSection(name));
    if ((operation === "open" || operation === "show") && !Object.keys(args).length) return;
    // React mounts the tool before its registered operation can execute.
    for (let attempt = 0; attempt < 100 && !handlers.current.has(name); attempt++) { signal?.throwIfAborted(); await new Promise((resolve) => setTimeout(resolve, 30)); }
    signal?.throwIfAborted();
    const handler = handlers.current.get(name);
    if (!handler) throw new Error("The tool is still opening. Try your request again.");
    const result = await handler(operation, { ...args, conversationId: state.current.conversationId, ...(!args.selected && state.current.selected ? { selected: state.current.selected } : {}) });
    signal?.throwIfAborted(); return result;
  }, [setTool]);
  useEffect(() => {
    runtime?.setToolHandler?.((action) => executeTool(action.tool, action.operation, action.args));
    return () => runtime?.setToolHandler?.(null);
  }, [runtime, executeTool]);
  const stop = useCallback(() => {
    pending.current?.abort(); pending.current = null; runtime?.stop();
    confirmationAnswer.current?.(false); confirmationAnswer.current = null; setConfirmation(null);
    regionAnswer.current?.(null); regionAnswer.current = null; setCaptureRegion(false);
    window.dispatchEvent(new Event("hypeman.cancel-tools")); setBusy(false);
  }, [runtime]);
  const cancelPending = useCallback(async () => {
    const id = state.current.conversationId;
    stop();
    if (id) await request({ type: "conversation.cancel-pending", conversationId: id });
  }, [stop]);
  useEffect(() => {
    window.addEventListener("hypeman.close-conversation", stop);
    return () => window.removeEventListener("hypeman.close-conversation", stop);
  }, [stop]);
  useEffect(() => runtime?.setSelectedContent?.(selected), [runtime, selected]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (busy || snapshot?.phase === "thinking" || snapshot?.phase === "acting") void cancelPending().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
      else if (confirmation) { confirmationAnswer.current?.(false); setConfirmation(null); }
      else if (snapshot?.confirmation) runtime?.confirm(false);
      else if (state.current.tool) { window.dispatchEvent(new Event("hypeman.cancel-tools")); setTool(null); field.current?.focus(); }
      else onClose?.();
    };
    const selection = () => {
      const selection = document.getSelection(); const text = selection?.toString().trim();
      const element = selection?.anchorNode?.parentElement;
      if (!text || !element || element.closest("input,textarea,[contenteditable],#hypeman-companion-v2,.conversation-workbench")) return;
      setSelected({ kind: "page", id: `selection-${Date.now()}`, text: text.slice(0, 4000), url: location.href, title: document.title });
    };
    window.addEventListener("keydown", escape); document.addEventListener("selectionchange", selection);
    const oldLink = () => { if (location.protocol === "chrome-extension:") { const section = resolveSection(location.hash.slice(1)); if (section) setTool(section); } };
    window.addEventListener("hashchange", oldLink);
    const unsubscribe = subscribe((event) => {
      if (event.type === "tab.activated") chatScroll.latest(true);
      if (event.type === "command" && event.name === "open-tools" && typeof event.section === "string") setTool(resolveSection(event.section));
    });
    return () => { window.removeEventListener("keydown", escape); document.removeEventListener("selectionchange", selection); window.removeEventListener("hashchange", oldLink); unsubscribe(); };
  }, [busy, snapshot?.phase, snapshot?.confirmation, confirmation, cancelPending, onClose, runtime, chatScroll.latest]);
  useEffect(() => { onActivity?.(busy); }, [busy, onActivity]);
  const avatarPhase: AvatarActivity["phase"] = error || snapshot?.phase === "error" ? "confused"
    : confirmation || snapshot?.confirmation || snapshot?.phase === "confirming" ? "point"
    : busy || snapshot?.phase === "thinking" || snapshot?.phase === "acting" ? "thinking" : "idle";
  const avatarCompletion = snapshot?.completionId || celebration ? `${snapshot?.completionId || ""}:${celebration}` : undefined;
  useEffect(() => {
    onAvatarActivity?.({ phase: avatarPhase, conversationId, task: snapshot?.task, hintId: snapshot?.learning.autoHint?.id, celebration: avatarCompletion });
  }, [onAvatarActivity, avatarPhase, conversationId, snapshot?.task, snapshot?.learning.autoHint?.id, avatarCompletion]);
  const applyReply = async (action: Action, say?: string, requestSelection = state.current.selected, submittedText = draft) => {
    if (action.type === "tool") {
      const sensitive = (action.tool === "phone" && ["send", "test", "pair", "unpair", "remind", "settings", "continue"].includes(action.operation)) || (action.tool === "connection" && ["login", "logout", "account", "model"].includes(action.operation)) || (action.tool === "settings" && action.operation === "permissions");
      if (sensitive) {
        const answer = await new Promise<boolean>((resolve) => { confirmationAnswer.current = resolve; setConfirmation(`Allow HypeMan to ${action.operation} using ${action.tool}?`); });
        confirmationAnswer.current = null; setConfirmation(null);
        if (!answer) return;
        pending.current?.signal.throwIfAborted();
      }
      const targetedBoard = action.tool === "board" && ["update", "erase", "color"].includes(action.operation) && requestSelection?.kind === "board";
      const args = { ...(action.args || {}), ...(requestSelection ? { selected: requestSelection } : {}), ...(targetedBoard ? { id: action.args?.id || requestSelection.id, revision: requestSelection.revision } : {}) };
      const result = await executeTool(action.tool, action.operation, args); if (result) await append("assistant", result);
    }
    else if (action.type === "sketch") { setSketch(action); setTool("board"); await append("assistant", say || `I've shown ${action.title} on the whiteboard.`); }
    else if (action.type === "say") await append("assistant", action.text);
    else if (action.type === "ask") await append("assistant", action.question);
    else if (action.type === "finish") {
      const signal = pending.current?.signal;
      await append("assistant", action.summary); signal?.throwIfAborted();
      if (alive.current) setCelebration(crypto.randomUUID());
    }
    else if (action.type === "note") await saveNote(action.text, action.excerpt);
    else {
      await request({ type: "assistant.run", goal: submittedText, ...(action.type === "navigate" ? { url: action.url } : {}), conversationId: state.current.conversationId });
      await append("assistant", say || "Continuing this request in the browser.");
    }
  };
  const saveNote = async (text?: string, excerpt?: string) => {
    const content = state.current.selected;
    const value = text || content?.text || state.current.messages.filter((m) => m.role === "assistant").at(-1)?.text;
    if (!value) throw new Error("Select something or tell me what to remember.");
    const web = content?.url && /^https?:/.test(content.url);
    await request({ type: "note.save", note: { text: value.slice(0, 4000), excerpt: excerpt || content?.text || "", url: web ? content.url : "", title: content?.title || "Conversation note", ...(!web ? { origin: { kind: content?.artifactId || content?.kind === "document" ? "document" : "conversation", conversationId: state.current.conversationId, ...(content?.artifactId ? { documentId: content.artifactId, page: content.page || 1 } : {}) } } : {}) } });
    setTool("notes"); await append("assistant", "Saved to your notes.");
  };
  const send = async (raw: string) => {
    const text = raw.trim(); if (!text || !state.current.conversationId) return;
    if (/^(?:stop|cancel|never mind)[.!]?$/i.test(text)) { await cancelPending(); return; }
    if (confirmation) { if (/^(?:yes|continue|go ahead|no|cancel)[.!]?$/i.test(text)) { confirmationAnswer.current?.(/^(?:yes|continue|go ahead)/i.test(text)); setConfirmation(null); } else throw new Error("Confirm or cancel the pending action first."); return; }
    if (snapshot?.confirmation) { if (/^(?:yes|continue|go ahead|no|cancel)[.!]?$/i.test(text)) runtime?.confirm(/^(?:yes|continue|go ahead)/i.test(text)); else throw new Error("Confirm or cancel the pending browser action first."); return; }
    if (pending.current) stop();
    const controller = new AbortController(); pending.current = controller; setBusy(true); setError("");
    try {
      window.dispatchEvent(new Event("hypeman.flush-window-geometry"));
      await ui.flush(); controller.signal.throwIfAborted();
      await append("user", text);
      const dismiss = text.match(/^(?:close|dismiss|hide)(?: this| the)?(?: (tool|board|whiteboard|documents?|pdf|notes|video|projects|settings|preferences|practice|phone|connection))?$/i);
      if (dismiss) {
        const names: Record<string, OverlaySection> = { board: "board", whiteboard: "board", document: "documents", documents: "documents", pdf: "documents", notes: "notes", video: "video", projects: "tasks", settings: "settings", preferences: "settings", practice: "learning", phone: "phone", connection: "connection" };
        const section = names[dismiss[1]?.toLowerCase()] || state.current.tool;
        if (section) closeTool(section);
        return;
      }
      if (/^(?:new (?:chat|conversation)|start over)$/i.test(text)) { await switchConversation(crypto.randomUUID()); return; }
      if (/^(?:show|open|find|list)(?: my| the)? (?:saved work|conversations|chats)(?: about .+)?$/i.test(text)) { const all = await request<Array<{ id: string; title: string; messages: Message[] }>>({ type: "conversation.list" }); const query = text.split(/ about /i)[1]?.toLowerCase(); setSaved(all.filter((c) => !query || c.title.toLowerCase().includes(query)).sort((a,b) => (b.messages.at(-1)?.at || 0) - (a.messages.at(-1)?.at || 0))); await append("assistant", "Select a conversation to continue its saved work."); return; }
      if (/^(?:help|what can you do)[?!]?$/i.test(text)) { await append("assistant", "Ask me a question, drop a PDF, or select something on the page. I can draw explanations, save notes, manage projects, help with videos and practice, and manage settings or your phone."); return; }
      if (/^(?:capture|screenshot|attach)(?: a| the)? (?:screen region|region of (?:the|my) screen|part of (?:the|my) screen)$/i.test(text)) {
        if (!runtime) throw new Error("Open the conversation on the webpage you want to capture, then ask to capture a screen region.");
        if (!settings.screenshotEnabled) { await executeTool("settings", "permissions", { permission: "capture" }); await append("assistant", "Allow screenshot access, then ask to capture the screen region again."); return; }
        const captured = await new Promise<string | null>((resolve) => { regionAnswer.current = resolve; setCaptureRegion(true); });
        setCaptureRegion(false); regionAnswer.current = null; controller.signal.throwIfAborted();
        if (captured) { setImage(captured); runtime.attachImage?.(captured); await append("status", "Screen region attached to your next message."); }
        return;
      }
      if (/^(?:export|download)(?: my| the)? workspace$/i.test(text)) {
        const [workspace, saved] = await Promise.all([request({ type: "workspace.get" }), request({ type: "workbench.export" })]);
        const url = URL.createObjectURL(new Blob([JSON.stringify({ workspace, workbench: saved }, null, 2)], { type: "application/json" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = "hypeman-workspace.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60000); await append("assistant", "Exported your conversations, notes, projects, and saved tool content. Ask to export a PDF to download its original file."); return;
      }
      const assisted = await request<{ reply?: { action: Action; say?: string } | null; contextTool?: "documents" | "video" | null }>({ type: "conversation.assist", conversationId: state.current.conversationId, message: text, toolContext: { activeTool: state.current.tool, selected: state.current.selected } }, controller.signal);
      controller.signal.throwIfAborted();
      if (assisted?.reply) { await applyReply(assisted.reply.action, assisted.reply.say, null, text); return; }
      const local = toolIntent(text, state.current.tool, state.current.selected);
      if (local) {
        if (local.tool === "video" && runtime && snapshot?.video && ["play", "pause", "seek", "speed", "summarize", "ask"].includes(local.operation)) {
          setTool("video");
          const command = local.operation === "seek" ? `seek to ${local.args?.value || 0} seconds` : local.operation === "speed" ? `set speed to ${local.args?.value || 1}x` : text;
          await runtime.send(command); if (runtime.getSnapshot().phase === "error") throw new Error(runtime.getSnapshot().messages.at(-1)?.text || "Video request failed."); setImage(null); return;
        }
        if (local.tool === "notes" && local.operation === "save") { await saveNote(typeof local.args?.text === "string" ? local.args.text : undefined); return; }
        if (local.tool === "learning" && ["hint", "plan", "teach", "check"].includes(local.operation) && runtime) {
          setTool("learning"); if (!settings.learningEnabled) runtime.setSettings(await request({ type: "settings.patch", patch: { learningEnabled: true } }));
          if (local.operation === "teach" && snapshot?.learning.teaching) runtime.teach(true); else await runtime.send(text); return;
        }
        const result = await executeTool(local.tool, local.operation, local.args); controller.signal.throwIfAborted(); if (result) await append("assistant", result); return;
      }
      if (state.current.tool === "documents" && assisted?.contextTool === "documents") {
        const documentSelection = state.current.selected;
        const result = await executeTool("documents", "analyze", { question: text, ...(documentSelection?.page ? { page: documentSelection.page, quote: documentSelection.quote } : {}) });
        controller.signal.throwIfAborted(); if (result) await append("assistant", result);
        if (/\b(draw|diagram|whiteboard|show (?:the |your )?work)\b/i.test(text)) {
          const selectedDocument = { ...documentSelection, kind: "pdf", id: documentSelection?.id || "document", text: String(result || documentSelection?.text || "").slice(0, 4000) };
          const reply = await request<{ action: Action; say?: string }>({ type: "assistant.turn", conversationId: state.current.conversationId, message: `${text}\nUse the whiteboard to explain the supplied PDF analysis.`, toolContext: { activeTool: "documents", selected: selectedDocument } }, controller.signal);
          controller.signal.throwIfAborted(); const action = parseAction(reply.action); if (!action) throw new Error("The whiteboard explanation was invalid. Your PDF is still saved."); await applyReply(action, reply.say, selectedDocument, text);
        }
        return;
      }
      if (state.current.tool === "video" && assisted?.contextTool === "video" && !runtime) { const result = await executeTool("video", "ask", { question: text }); controller.signal.throwIfAborted(); if (result) await append("assistant", result); return; }
      if (runtime) { await runtime.send(text); if (runtime.getSnapshot().phase === "error") throw new Error(runtime.getSnapshot().messages.at(-1)?.text || "Request failed. Try again."); setImage(null); }
      else {
        const requestSelection = state.current.selected;
        const reply = await request<{ action: Action; say?: string }>({ type: "assistant.turn", conversationId: state.current.conversationId, message: text, toolContext: { activeTool: state.current.tool, selected: requestSelection }, ...(image ? { image } : {}) }, controller.signal);
        controller.signal.throwIfAborted(); const action = parseAction(reply.action); if (!action) throw new Error("HypeMan returned an invalid action. Nothing changed."); await applyReply(action, reply.say, requestSelection, text); setImage(null);
      }
    } finally { if (pending.current === controller) { pending.current = null; setBusy(false); } }
  };
  const switchConversation = async (id: string) => {
    stop();
    const version = ++loadingSequence.current; setHydrating(true);
    try {
    const tab = location.protocol === "chrome-extension:" ? await chrome.tabs.getCurrent?.().catch(() => undefined) : undefined;
    const result = await request<{ id: string; messages: Message[] }>({ type: "conversation.select", conversationId: id, ...(tab?.id !== undefined ? { tabId: tab.id } : {}) });
    if (!alive.current || version !== loadingSequence.current) return;
    state.current.conversationId = result.id; state.current.messages = result.messages;
    seen.current = new Set(result.messages.map((message) => message.id));
    setConversationId(result.id); setMessages(result.messages); setHydrating(false); setSelected(null); setSaved([]); setWindows({ active: null, open: [] }); setSketch(null); runtime?.setConversationId?.(result.id);
    for (const message of runtime?.getSnapshot().messages || []) seen.current.add(message.id);
    } finally { if (alive.current && version === loadingSequence.current) setHydrating(false); }
  };
  const submit = async (event?: FormEvent) => {
    event?.preventDefault(); const text = draft;
    if (!text.trim() || !state.current.conversationId || hydrating) return;
    setDraft("");
    try { await send(text); }
    catch (e) { if ((e as Error).name !== "AbortError") setError((e as Error).message); }
  };
  const acceptFiles = async (files: FileList | File[]) => {
    const controller = new AbortController(); pending.current?.abort(); pending.current = controller; setBusy(true); setError("");
    try {
      for (const file of Array.from(files)) {
        if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
          const document = await uploadDocument(file, state.current.conversationId, controller.signal);
          controller.signal.throwIfAborted(); setSelected({ kind: "document", id: document.id, artifactId: document.id, title: document.name }); setTool("documents");
          window.dispatchEvent(new CustomEvent("hypeman.document.attached", { detail: document }));
        } else if (/^image\//.test(file.type)) {
          if (file.size > 25 * 1024 * 1024) throw new Error("Choose an image up to 25 MiB.");
          const bitmap = await createImageBitmap(file); const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height)); const canvas = document.createElement("canvas"); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale); canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
          controller.signal.throwIfAborted();
          const data = canvas.toDataURL("image/jpeg", 0.8); setImage(data); runtime?.attachImage?.(data);
        } else { setTool("video"); await executeTool("video", "captions", { file }); }
      }
    } catch (e) { if ((e as Error).name !== "AbortError") setError((e as Error).message); }
    finally { if (pending.current === controller) { pending.current = null; setBusy(false); } }
  };
  const working = busy || snapshot?.phase === "thinking" || snapshot?.phase === "acting";
  return <WorkbenchContext.Provider value={{ conversationId: conversationId || "default", selected, selectContent: setSelected, openTool, register, executeTool, send }}><WindowGeometryProvider {...persistence}>
    <div className={`conversation-workbench ${tool ? "has-tool" : ""}`} onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
      onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); event.stopPropagation(); void acceptFiles(event.dataTransfer.files); } }}>
      <section ref={chatWindow.hostRef} className="conversation-pane pixel-workspace workspace-chat" aria-label="HypeMan conversation"
        data-window-tool="chat"
        hidden={!chatWindow.hydrated}
        style={chatWindow.style} {...chatWindow.shellProps}>
        <header className="conversation-title pixel-workspace-bar" tabIndex={0} aria-label="Move HypeMan window" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown" {...chatWindow.titleProps}>
          <span><Icon name="chat" /><strong>HypeMan</strong></span><span className="pixel-window-grip" aria-hidden="true" />
          <WindowControls geometry={chatWindow} title="HypeMan" onClose={() => { stop(); onClose?.(); }} />
        </header>
        <div className="conversation-body" hidden={chatWindow.minimized}>
        <div ref={chatScroll.ref} onScroll={chatScroll.onScroll} className="conversation-messages" role="log" aria-live="polite">
          {messages.map((message) => <article key={message.id} className={`chat-message ${message.role}${selected?.kind === "message" && selected.id === message.id ? " is-selected" : ""}`} aria-label={message.role === "user" ? "You" : "HypeMan"} tabIndex={0}
            onClick={(event) => { if (!(event.target as Element).closest("a,button")) setSelected({ kind: "message", id: message.id, text: message.text, title: "Conversation message" }); }}
            onKeyDown={(event) => { if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); setSelected({ kind: "message", id: message.id, text: message.text, title: "Conversation message" }); } }}>
            <MessageContent text={message.text} onDocumentPage={(documentId, page) => { void executeTool("documents", "page", { documentId, page }).catch((cause) => setError(cause.message)); }} />
            {message === messages.at(-1) && message.role === "assistant" && /^\d{1,2}:\d{2} AM or PM\?$/.test(message.text) && <div className="tool-actions" style={{ marginTop: 8 }} aria-label="Choose reminder time">{["AM", "PM"].map((period) => <button key={period} type="button" className="button" disabled={working} onClick={(event) => { event.stopPropagation(); void send(`${message.text.split(" ")[0]} ${period}`).catch((cause) => setError(cause.message)); }}>{message.text.split(" ")[0]} {period}</button>)}</div>}
          </article>)}
          {saved.length > 0 && <div className="saved-conversations" aria-label="Saved conversations">{saved.map((c) => <article key={c.id} tabIndex={0} onClick={() => void switchConversation(c.id)} onKeyDown={(e) => { if (e.key === "Enter") void switchConversation(c.id); }}>{c.title}</article>)}</div>}
          {working && <div className="conversation-working" role="status" aria-label={snapshot?.status || "Working"}><span /><span /><span /></div>}
        </div>
        {snapshot?.confirmation && <div className="confirmation" role="alertdialog" aria-label="Confirm browser action"><p>{snapshot.confirmation.message}</p><button type="button" className="button primary" onClick={() => runtime?.confirm(true)}>Allow</button><button type="button" className="button" onClick={() => runtime?.confirm(false)}>Cancel</button></div>}
        {confirmation && <div className="confirmation" role="alertdialog" aria-label="Confirm action"><p>{confirmation}</p><button type="button" className="button primary" onClick={() => { confirmationAnswer.current?.(true); setConfirmation(null); }}>Allow</button><button type="button" className="button" onClick={() => { confirmationAnswer.current?.(false); setConfirmation(null); }}>Cancel</button></div>}
        <Notice tone="error">{error}</Notice>
        {selected && ["pdf", "document", "documents"].includes(selected.kind) && <div className="conversation-attachment-chip" aria-label="Attached document"><Icon name="documents" /><span>{selected.title || "PDF"}{selected.page ? ` · p. ${selected.page}` : ""}</span><button type="button" className="icon-button" aria-label="Remove document context" title="Remove document context" onClick={() => setSelected(null)}><Icon name="close" /></button></div>}
        {image && <div className="conversation-attachment-wrapper"><img className="conversation-attachment" src={image} alt="Attached image" /><button type="button" className="icon-button" aria-label="Remove image attachment" title="Remove image attachment" onClick={() => { setImage(null); runtime?.attachImage?.(null); }}><Icon name="close" /></button></div>}
        <form className="conversation-composer" onSubmit={submit} onPaste={(event) => { if (event.clipboardData.files.length) { event.preventDefault(); void acceptFiles(event.clipboardData.files); } }}>
          <button type="button" className="conversation-attach" aria-label="Attach a file" title="Attach a file" onClick={() => files.current?.click()}><Icon name="paperclip" /></button>
          <textarea id="task-goal" ref={field} aria-label="What do you need?" placeholder="Ask anything…" rows={1} value={draft} maxLength={4000} disabled={!conversationId || hydrating} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} />
          {working ? <button type="button" aria-label="Stop" onClick={() => void cancelPending().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))}><Icon name="stop" /></button> : <button type="submit" aria-label="Send message" disabled={!draft.trim() || !conversationId || hydrating}><Icon name="arrow" /></button>}
        </form>
        <input ref={files} className="sr-only" type="file" aria-label="Choose a file" accept="application/pdf,image/*,video/*,.vtt,.srt" multiple onChange={(event) => { if (event.target.files?.length) void acceptFiles(event.target.files); event.target.value = ""; }} />
        </div>
        <WindowResizeHandles geometry={chatWindow} title="HypeMan" />
      </section>
      <ToolOverlay key={conversationId} section={tool} openSections={windows.open} onFocus={focusTool} conversationId={conversationId || "default"} sketch={sketch} pageVideo={snapshot?.video || undefined}
        onNativeVideoCommand={async (operation, args) => {
          if (!runtime) return;
          const text = operation === "seek" ? `seek to ${args.seconds ?? args.value ?? 0} seconds` : operation === "speed" ? `set speed to ${args.rate ?? args.value ?? 1}x` : operation === "summarize" ? "Summarize this video" : operation === "ask" ? String(args.question || args.text || "Explain this part of the video") : `${operation} video`;
          await runtime.send(text);
          if (runtime.getSnapshot().phase === "error") throw new Error(runtime.getSnapshot().messages.at(-1)?.text || "Video request failed.");
          return operation === "summarize" || operation === "ask" ? runtime.getSnapshot().video?.summary : undefined;
        }}
        onVideoSeek={(seconds) => { void runtime?.send(`seek to ${seconds} seconds`); }}
        onVideoCaptionsChange={(text) => { const timed = parseCaptions(text); runtime?.attachVideoCaptions?.(text.trim() ? timed.length ? timed : text.split(/\n+/).filter(Boolean).flatMap((line) => line.match(/[\s\S]{1,1800}/g) || []).map((text) => ({ start: 0, end: 0, text })) : null); }}
        onClose={(section) => { window.dispatchEvent(new Event("hypeman.cancel-tools")); closeTool(section); field.current?.focus(); }} onError={setError} />
      {captureRegion && <ScreenRegion onImage={(data) => regionAnswer.current?.(data)} onError={(cause) => { if (cause.name !== "AbortError") setError(cause.message); regionAnswer.current?.(null); }} />}
    </div>
  </WindowGeometryProvider></WorkbenchContext.Provider>;
}
