import { useEffect, useRef, useState } from "react";
import { learningEstimate, type AgentReply, type Health, type LearningGraph, type LearningPlan, type Settings, type SourceNote } from "@core";
import { request } from "../bridge";
import { Empty, NoteCard, Notice, TaskCard, Toggle } from "./common";
import { exportWorkspace, host, message, relativeTime, setScreenshotAccess, useSettings, useWorkspace } from "./hooks";
import { useToolHandler, useWorkbench } from "./WorkbenchContext";
import { ChatGPTConnection } from "./ChatGPTConnection";
import { Messaging } from "./Messaging";
import type { IconName } from "./Icon";
export type CompanionSection = "tasks" | "notes" | "activity" | "settings" | "learning";
export const companionSections: { section: CompanionSection; icon: IconName; label: string }[] = [
  { section: "tasks", icon: "task", label: "Projects" }, { section: "notes", icon: "notes", label: "Notes" },
  { section: "activity", icon: "rewind", label: "Recent actions" }, { section: "settings", icon: "settings", label: "Preferences" },
  { section: "learning", icon: "learn", label: "Practice" },
];
export function CompanionTools({ section, onError, embedded = false }: { section: CompanionSection; onClose: () => void; onError?: (error: string) => void; onStartTask?: () => void; onSectionChange?: (section: CompanionSection) => void; embedded?: boolean }) {
  const { workspace, refresh, error, loading } = useWorkspace();
  const { settings, patch, error: settingsError } = useSettings();
  const workbench = useWorkbench();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [permission, setPermission] = useState<"capture" | "input" | null>(null);
  const removed = useRef<SourceNote | null>(null);
  const extensionPage = location.protocol === "chrome-extension:";
  const fail = (cause: unknown) => { const value = message(cause); setNotice(value); onError?.(value); };
  const edit = (changes: Partial<Settings>) => void patch(changes).then(() => setNotice("Preferences saved.")).catch(fail);
  const resolveId = (args: Record<string, unknown>, kind: string) => typeof args.id === "string" ? args.id : workbench.selected?.kind === kind ? workbench.selected.id : "";
  useToolHandler(section === "tasks" ? "projects" : null, async (operation, args) => {
    if (operation === "open") return "Select a project and ask to continue, pause, cancel, or text it.";
    if (operation === "filter") { setFilter(String(args.status || args.filter || "all")); return "Projects filtered."; }
    const id = resolveId(args, "project") || workspace.activeTaskId;
    if (!id) throw new Error("Select a project first.");
    if (operation === "done") { const task = workspace.tasks.find((item) => item.id === id); const step = task?.steps.find((item) => item.status !== "done"); if (!task || !step) throw new Error("That project has no unfinished step."); await request({ type: "task.step.confirm", taskId: task.id, stepId: step.id }); await refresh(); return "Current step marked complete by you."; }
    if (!["pause", "resume", "cancel"].includes(operation)) throw new Error("That project action is unavailable.");
    await request({ type: operation === "resume" && !extensionPage ? "task.follow" : `task.${operation}`, id });
    await refresh(); return operation === "resume" ? "Continuing the project." : operation === "pause" ? "Project paused." : "Project cancelled.";
  });
  useToolHandler(section === "notes" ? "notes" : null, async (operation, args) => {
    if (operation === "open" || operation === "find") { setSearch(String(args.query || args.text || "")); return search ? "Showing matching notes." : "Your notes are ready. Edit them directly."; }
    if (operation === "undo") { if (!removed.current) throw new Error("There is no deleted note to restore."); const { id: _id, ...restored } = removed.current; await request({ type: "note.save", note: restored }); removed.current = null; await refresh(); return "Note restored."; }
    const id = resolveId(args, "note");
    const note = workspace.notes.find((item) => item.id === id);
    if (operation === "delete") { if (!note) throw new Error("Select the note to delete."); await request({ type: "note.remove", id: note.id }); removed.current = note; await refresh(); return "Note deleted. Say undo to restore it."; }
    if (operation === "save") {
      const text = String(args.text || workbench.selected?.text || "").trim();
      if (!text) throw new Error("Select text or say what to save.");
      await request({ type: "note.save", note: { ...(note || {}), text, excerpt: String(args.excerpt || workbench.selected?.text || ""), url: String(args.url || workbench.selected?.url || ""), title: String(args.title || workbench.selected?.title || "Conversation note"), origin: { kind: workbench.selected?.artifactId ? "document" : "conversation", conversationId: workbench.conversationId, ...(workbench.selected?.artifactId ? { documentId: workbench.selected.artifactId, page: workbench.selected.page } : {}) } } });
      await refresh(); return "Note saved.";
    }
    throw new Error("That note action is unavailable.");
  });
  useToolHandler(section === "activity" ? "activity" : null, async () => `${workspace.events.length} actions recorded. Select an action to inspect its source and evidence.`);
  useToolHandler(section === "settings" ? "settings" : null, async (operation, args) => {
    if (operation === "open") return "Edit a preference directly, or tell me what to change.";
    if (operation === "permissions") {
      if (args.screenshotEnabled === false || args.trustedInput === false) { await patch({ ...(args.screenshotEnabled === false ? { screenshotEnabled: false } : {}), ...(args.trustedInput === false ? { trustedInput: false } : {}) }); return "Access disabled."; }
      const kind = String(args.permission || args.kind || args.name || (args.trustedInput === true ? "input" : "capture"));
      if (["capture", "screenshots", "screenshotEnabled", "input", "trustedInput"].includes(kind)) { setPermission(["input", "trustedInput"].includes(kind) ? "input" : "capture"); return "Use Allow access below to open Chrome’s permission prompt."; }
    }
    if (operation === "pause-site" || operation === "resume-site") {
      const hostname = String(args.hostname || args.host || (location.protocol === "chrome-extension:" ? "" : location.hostname));
      if (!hostname) throw new Error("Name the site to change.");
      await patch({ hiddenOnHosts: operation === "pause-site" ? [...new Set([...settings.hiddenOnHosts, hostname])] : settings.hiddenOnHosts.filter((item) => item !== hostname) });
      return operation === "pause-site" ? `Paused on ${hostname}.` : `Resumed on ${hostname}.`;
    }
    if (operation === "set") {
      const raw = args.patch && typeof args.patch === "object" ? args.patch as Record<string, unknown> : args.key || args.name ? { [String(args.key || args.name)]: args.value } : Object.fromEntries(Object.entries(args).filter(([key]) => !["conversationId", "selected"].includes(key)));
      const next: Partial<Settings> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (["screenshotEnabled", "trustedInput"].includes(key) && value === true) { setPermission(key === "trustedInput" ? "input" : "capture"); continue; }
        if (!["reducedMotion", "videoCompanion", "proactiveEnabled", "learningEnabled", "tabContextEnabled", "screenshotEnabled", "trustedInput"].includes(key)) throw new Error("That preference is unavailable here.");
        Object.assign(next, { [key]: value });
      }
      if (Object.keys(next).length) await patch(next);
      return permission ? "Review the access request below." : "Preferences saved.";
    }
    throw new Error("That settings action is unavailable.");
  });
  const tasks = [...workspace.tasks].sort((a, b) => b.updatedAt - a.updatedAt).filter((task) => filter === "all" || filter === "unfinished" && ["running", "paused"].includes(task.status) || task.status === filter);
  const notes = [...workspace.notes].sort((a, b) => b.updatedAt - a.updatedAt).filter((note) => `${note.text} ${note.excerpt} ${note.title} ${note.url}`.toLowerCase().includes(search.toLowerCase()));
  const outcomes = [...workspace.events].reverse();
  const grant = async () => {
    try {
      if (permission === "capture") await setScreenshotAccess(true, patch);
      else { if (!(await chrome.permissions.request({ permissions: ["debugger"] }))) throw new Error("Browser input permission was not granted."); await patch({ trustedInput: true }); }
      setPermission(null); setNotice("Access enabled.");
    } catch (cause) { fail(cause); }
  };
  return <section className={`inline-toolbox inline-toolbox-${section} ${embedded ? "embedded" : ""}`} aria-label={companionSections.find((item) => item.section === section)?.label}><div className="inline-tool-body">
    <Notice tone="error">{error || settingsError}</Notice><Notice>{notice}</Notice>{loading && <p role="status">Loading…</p>}
    {section === "tasks" && <><p>Ask to filter, continue, pause, or cancel a project. Select a project to make “this” refer to it.</p><div className="inline-tool-list">{tasks.length ? tasks.map((task) => <TaskCard key={task.id} task={task} refresh={refresh} />) : <Empty title="No projects">Describe a goal in the conversation.</Empty>}</div></>}
    {section === "notes" && <><p>{search ? `Notes matching “${search}”` : "Edit notes directly. Ask to find, save, delete, or text a note."}</p><div className="inline-tool-list">{notes.length ? notes.map((note) => <NoteCard key={note.id} note={note} refresh={refresh} />) : <Empty title="No notes yet">Select text or an explanation and ask to save it.</Empty>}</div></>}
    {section === "activity" && <div className="inline-action-list">{outcomes.length ? outcomes.map((event) => <article key={event.id} className="inline-action" tabIndex={0} onFocus={() => workbench.selectContent({ kind: "action", id: event.id, text: event.summary, url: event.url })}><p>{event.ok ? "✓" : "!"} {event.summary}</p><details><summary>{relativeTime(event.at)} · details</summary><p>{event.action.replaceAll("_", " ")}</p>{event.url && <a href={event.url} target="_blank" rel="noreferrer">{host(event.url)} ↗</a>}</details></article>) : <Empty title="No actions yet">Completed actions and their evidence appear here.</Empty>}</div>}
    {section === "settings" && <>
      <p>Preferences save as you edit. Ask to connect your phone, manage accounts, or export your workspace.</p>
      <Toggle label="Page screenshots" description="Chrome asks before granting capture access." checked={settings.screenshotEnabled} onChange={(value) => value ? setPermission("capture") : edit({ screenshotEnabled: false })} />
      <Toggle label="Other tab context" description="Share other tab titles and links." checked={settings.tabContextEnabled} onChange={(value) => edit({ tabContextEnabled: value })} />
      <Toggle label="Trusted browser actions" description="Chrome asks before enabling browser input." checked={settings.trustedInput} onChange={(value) => value ? setPermission("input") : edit({ trustedInput: false })} />
      <Toggle label="Automatic assistance" description="Explain selections and offer contextual help." checked={settings.proactiveEnabled} onChange={(value) => edit({ proactiveEnabled: value })} />
      <Toggle label="Learning mode" description="Keep practice evidence on this device." checked={settings.learningEnabled} onChange={(value) => edit({ learningEnabled: value })} />
      <label className="field">Motion<select aria-label="Motion" value={settings.reducedMotion} onChange={(event) => edit({ reducedMotion: event.target.value as Settings["reducedMotion"] })}><option value="auto">System preference</option><option value="on">Reduced motion</option><option value="off">Full animation</option></select></label>
      <label className="field">Video companion<select aria-label="Video companion" value={settings.videoCompanion} onChange={(event) => edit({ videoCompanion: event.target.value as Settings["videoCompanion"] })}><option value="ask">When requested</option><option value="on">Available automatically</option><option value="off">Hidden</option></select></label>
      {permission && <div className="confirmation" role="group" aria-label="Browser permission"><p>Allow {permission === "capture" ? "page screenshots" : "trusted browser input"}?</p><button data-essential="permission" className="button" onClick={() => void grant()}>Allow access</button><button data-essential="permission" className="button" onClick={() => setPermission(null)}>Decline</button></div>}
      {!!settings.hiddenOnHosts.length && <details><summary>Paused sites</summary>{settings.hiddenOnHosts.map((hostname) => <p key={hostname}>{hostname} · ask to resume this site</p>)}</details>}
    </>}
    {section === "learning" && <LearningCollection />}
  </div></section>;
}
function LearningCollection() {
  const { settings, patch } = useSettings();
  const workbench = useWorkbench();
  const [graph, setGraph] = useState<LearningGraph | null>(null);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const refresh = async (signal?: AbortSignal) => {
    const next = await request<LearningGraph>({ type: "graph.get" }, signal);
    signal?.throwIfAborted(); setGraph(next);
  };
  useEffect(() => {
    const controller = new AbortController();
    const cancel = () => abort.current?.abort();
    window.addEventListener("hypeman.cancel-tools", cancel);
    void refresh(controller.signal).catch((cause) => { if (!controller.signal.aborted) setError(message(cause)); });
    return () => { controller.abort(); cancel(); window.removeEventListener("hypeman.cancel-tools", cancel); };
  }, []);
  useToolHandler("learning", async (operation, args) => {
    if (operation === "open") return "Ask for a practice plan, a hint, or feedback on your explanation.";
    const controller = new AbortController(); abort.current?.abort(); abort.current = controller;
    const signal = controller.signal;
    try {
      if (operation === "clear") { await request({ type: "learn.clear" }, signal); signal.throwIfAborted(); await refresh(signal); return "Practice history cleared."; }
      if (!settings.learningEnabled) await patch({ learningEnabled: true });
      signal.throwIfAborted();
      const concept = String(args.concept || args.goal || workbench.selected?.title || "This topic");
      if (operation === "plan") {
        const result = await request<{ goal: string; steps: { title: string; concept: string }[] }>({ type: "api", path: "/api/learn/plan", body: { goal: concept } }, signal);
        signal.throwIfAborted();
        const plan: LearningPlan = { id: crypto.randomUUID(), goal: result.goal, steps: result.steps.map((step) => ({ ...step, done: false })), createdAt: Date.now() };
        await request({ type: "learn.plan", plan }, signal); signal.throwIfAborted(); await refresh(signal); return plan.steps.map((step, index) => `${index + 1}. ${step.title}`).join("\n");
      }
      if (operation === "hint") { const reply = await request<{ text?: string }>({ type: "assistant.ask", message: `Give me one small hint about ${concept}, without solving it for me. ${workbench.selected?.text || ""}` }, signal); signal.throwIfAborted(); return reply.text || "Select the problem or describe what you are working on."; }
      if (operation === "teach" || operation === "check") {
        const explanation = String(args.explanation || args.text || workbench.selected?.text || "");
        if (!explanation.trim()) throw new Error("Explain the idea in your own words first.");
        const result = await request<{ status: "correct" | "needs-work" | "uncertain"; hint: string; evidence: string; provider: AgentReply["provider"] }>({ type: "api", path: "/api/learn/teachback", body: { concept, explanation } }, signal);
        signal.throwIfAborted();
        if (!["correct", "needs-work", "uncertain"].includes(result.status) || typeof result.hint !== "string" || typeof result.evidence !== "string") throw new Error("The explanation assessment returned invalid data.");
        const grounded = result.provider === "openai" && result.status !== "uncertain" && !!result.evidence && explanation.includes(result.evidence);
        if (grounded) await request({ type: "learn.event", event: { id: crypto.randomUUID(), concept, kind: "explanation", correct: result.status === "correct", evidence: result.evidence, at: Date.now() } }, signal);
        signal.throwIfAborted(); await refresh(signal); return `${result.provider === "demo" ? "Demonstration feedback:" : !grounded ? "I need more detail." : result.status === "correct" ? "Your explanation is supported." : "One thing to revisit:"} ${result.hint}`;
      }
      throw new Error("That learning action is unavailable.");
    } finally { if (abort.current === controller) abort.current = null; }
  });
  return <div className="inline-learning"><Notice tone="error">{error}</Notice><p>Ask for a plan, a hint, or feedback. Evidence comes from practice, not page visits.</p>{graph?.plans.map((plan) => <article key={plan.id}><h3>{plan.goal}</h3><ol>{plan.steps.map((step, index) => <li key={index}>{step.done ? "✓ " : ""}{step.title}</li>)}</ol></article>)}{graph?.nodes.length ? graph.nodes.map((node) => { const estimate = learningEstimate(node); return <article key={node.id} tabIndex={0} onFocus={() => workbench.selectContent({ kind: "concept", id: node.id, title: node.label, text: node.evidence.join("\n") })} onClick={() => workbench.selectContent({ kind: "concept", id: node.id, title: node.label, text: node.evidence.join("\n") })}><h3>{node.label}</h3><p>{estimate.evidenceCount} practice observations{estimate.due ? " · due for review" : ""}</p><details><summary>Practice evidence</summary>{node.evidence.map((evidence, index) => <p key={index}>{evidence}</p>)}</details></article>; }) : <Empty title="A fresh start">Your practiced concepts will appear here.</Empty>}</div>;
}
