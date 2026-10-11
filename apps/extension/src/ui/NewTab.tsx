import { useEffect, useRef, useState, type FormEvent } from "react";
import { request, subscribe } from "../bridge";
import { Notice } from "./common";
import { message, useSettings, useWorkspace, useReducedMotion } from "./hooks";
import { Icon, type IconName } from "./Icon";
import { Rooftop } from "./Rooftop";
import { ToolOverlay } from "./ToolOverlay";
import { isOverlaySection, type OverlaySection, overlaySections } from "./overlay-sections";

type Mode = "task" | "ask" | "search";
const modes: { id: Mode; label: string; icon: IconName; placeholder: string }[] = [
  { id: "task", label: "Ask HypeMan", icon: "bolt", placeholder: "What do you need?" },
  { id: "ask", label: "Quick answer", icon: "chat", placeholder: "Ask a quick question…" },
  { id: "search", label: "Search the web", icon: "search", placeholder: "Search the web…" },
];
const sections = new Set<OverlaySection>(Object.keys(overlaySections) as OverlaySection[]);
const sectionFromHash = () => {
  const value = location.hash.slice(1) as OverlaySection;
  return sections.has(value) ? value : null;
};

/** Ordinary requests stay conversational; a proposed plan can become a project. */
export function NewTab() {
  const { settings } = useSettings();
  const { workspace, refresh, error } = useWorkspace();
  const reduced = useReducedMotion(settings.reducedMotion);
  const [mode, setMode] = useState<Mode>("task");
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [section, setSection] = useState<OverlaySection | null>(sectionFromHash);
  const [more, setMore] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);
  const active = workspace.tasks.find((task) => task.id === workspace.activeTaskId) ||
    [...workspace.tasks].reverse().find((task) => task.status === "paused");
  const current = modes.find((item) => item.id === mode)!;

  const show = (next: OverlaySection | null) => {
    setSection(next);
    setMore(false);
    history.replaceState(null, "", `${location.pathname}${location.search}${next ? `#${next}` : ""}`);
    if (!next) requestAnimationFrame(() => field.current?.focus());
  };
  const toggle = (next: OverlaySection) => show(section === next ? null : next);
  useEffect(() => {
    const changed = () => setSection(sectionFromHash());
    addEventListener("hashchange", changed);
    const remove = subscribe((event) => {
      if (event.type === "command" && event.name === "open-tools" && isOverlaySection(event.section))
        show(event.section);
    });
    return () => {
      removeEventListener("hashchange", changed);
      remove();
      pending.current?.abort();
    };
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (section) show(null);
      else if (more) setMore(false);
      else if (answer || notice) { setAnswer(""); setNotice(""); }
    };
    addEventListener("keydown", escape);
    return () => removeEventListener("keydown", escape);
  }, [section, more, answer, notice]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const goal = query.trim();
    if (!goal || busy) return;
    if (mode === "search") {
      location.href = `https://www.google.com/search?q=${encodeURIComponent(goal)}`;
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setNotice("");
    setAnswer("");
    show(null);
    try {
      if (mode === "task") {
        // A pasted link belongs in the prompt, avoiding a second URL field.
        const url = goal.match(/https?:\/\/[^\s<>]+/i)?.[0].replace(/[),.;!?]+$/, "");
        await request({ type: "assistant.run", goal, ...(url ? { url } : {}) }, controller.signal);
        if (controller.signal.aborted || pending.current !== controller) return;
        setQuery("");
        await refresh();
      } else {
        const reply = await request<{ text?: string; answer?: string; action?: { text?: string } }>(
          { type: "assistant.ask", message: goal }, controller.signal,
        );
        if (controller.signal.aborted || pending.current !== controller) return;
        setAnswer(reply.text || reply.answer || reply.action?.text || "Open a page to ask about its content.");
        setQuery("");
      }
    } catch (e) {
      if (!controller.signal.aborted) setNotice(message(e));
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  };
  const resume = async () => {
    if (!active || busy) return;
    setBusy(true);
    try {
      await request({ type: active.status === "running" ? "task.pause" : "task.resume", id: active.id });
      await refresh();
    } catch (e) { setNotice(message(e)); }
    finally { setBusy(false); }
  };
  const tool = (icon: IconName, label: string, action: () => void, selected = false) => (
    <button type="button" className={`orbit-icon ${selected ? "selected" : ""}`} aria-label={label}
      title={label} aria-pressed={selected} onClick={action}><Icon name={icon} /></button>
  );

  return (
    <div className="newtab-page minimal-desktop" data-reduced-motion={reduced}>
      <main className="mission-orbit" aria-label="HypeMan companion">
        <section className="mission-composer" aria-label="HypeMan launcher">
          <form className="mission-form" onSubmit={submit}>
            <label className="sr-only" htmlFor="task-goal">{mode === "task" ? "What do you need?" : current.label}</label>
            <input ref={field} id="task-goal" autoComplete="off" spellCheck={false} maxLength={2000}
              value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder={current.placeholder} required aria-busy={busy} />
            {busy ? (
              <button type="button" className="mission-send busy" aria-label="Cancel request" title="Cancel request"
                onClick={() => { pending.current?.abort(); pending.current = null; setBusy(false); }}><Icon name="stop" /></button>
            ) : (
              <button className="mission-send" aria-label={current.label} title={current.label} disabled={!query.trim()}><Icon name="arrow" /></button>
            )}
          </form>
          <div className="mission-icons">
            <div className="mission-modes" role="group" aria-label="Prompt mode">
              {modes.map((item) => <button key={item.id} type="button" className={`orbit-icon ${mode === item.id ? "selected" : ""}`}
                aria-label={`${item.label} mode`} aria-pressed={mode === item.id} title={item.label}
                disabled={busy} onClick={() => { setMode(item.id); setAnswer(""); setNotice(""); field.current?.focus(); }}><Icon name={item.icon} /></button>)}
            </div>
            <nav className="mission-utilities" aria-label="Companion tools">
              {active && <button type="button" className={`orbit-icon task-live ${active.status === "running" ? "running" : ""}`}
                aria-label={active.status === "running" ? "Pause project" : "Continue project"} title={`${active.status === "running" ? "Pause" : "Continue"}: ${active.goal}`}
                disabled={busy} onClick={() => void resume()}><Icon name={active.status === "running" ? "pause" : "play"} /></button>}
              {tool("task", "Projects", () => toggle("tasks"), section === "tasks")}
              {tool("notes", "Saved notes", () => toggle("notes"), section === "notes")}
              {tool("sketch", "Whiteboard", () => toggle("board"), section === "board")}
              <button type="button" className={`orbit-icon ${more ? "selected" : ""}`} aria-label="More tools" title="More tools"
                aria-expanded={more} onClick={() => { const next = !more; if (section) show(null); setMore(next); }}><Icon name={more ? "close" : "plus"} /></button>
            </nav>
          </div>
          {more && <nav className="mission-more" aria-label="More companion tools">
            {tool("learn", "Practice", () => show("learning"))}
            {tool("video", "Video companion", () => show("video"))}
            {tool("camera", "Paper camera", () => show("notebook"))}
            {tool("spark", "Customize your companion", () => show("customize"))}
            {tool("settings", "Settings", () => show("settings"))}
          </nav>}
          {(answer || notice || error) && <div className="mission-reply">
            <button type="button" className="orbit-icon reply-close" aria-label="Dismiss answer" title="Dismiss"
              onClick={() => { setAnswer(""); setNotice(""); }}><Icon name="close" /></button>
            {answer && <div className="answer" aria-live="polite">{answer}</div>}
            <Notice tone="error">{error || notice}</Notice>
          </div>}
        </section>
      </main>
      <ToolOverlay section={section} onOpen={show} onClose={() => show(null)} onError={setNotice}
        onStartTask={() => { setMode("task"); show(null); }} />
      <Rooftop reduced={reduced} settings={settings}
        activity={busy ? "thinking" : notice || error ? "confused" : answer ? "celebrate" : "idle"}
        onCompanion={() => { show(null); field.current?.focus(); }}
        onCustomize={() => show("customize")} onNotes={() => show("notes")} />
    </div>
  );
}
