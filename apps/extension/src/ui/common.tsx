import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BrowserTask, SourceNote } from "@core";
import { request } from "../bridge";
import { host, message, relativeTime } from "./hooks";
import { useWorkbench } from "./WorkbenchContext";

export function Brand({ small = false }: { small?: boolean }) {
  return <span className={`brand ${small ? "brand-small" : ""}`}><span className="brand-symbol" aria-hidden="true"><img src={chrome.runtime.getURL("assets/icons/icon32.png")} width={32} height={32} alt="" /></span><span>HypeMan</span></span>;
}
export function Notice({ children, tone = "info" }: { children?: ReactNode; tone?: "info" | "error" | "success" }) {
  return children ? <div role={tone === "error" ? "alert" : "status"} className={`notice ${tone}`}>{children}</div> : null;
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty"><h3>{title}</h3><p>{children}</p></div>;
}
export function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle-row" title={description}><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" className="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}
export function TaskCard({ task, dense = false }: { task: BrowserTask; refresh: () => Promise<void>; dense?: boolean; textToPhone?: boolean }) {
  const workbench = useWorkbench();
  const select = () => workbench.selectContent({ kind: "project", id: task.id, text: [task.goal, `Status: ${task.status}`, task.nextStep, ...task.steps.map((step) => `${step.status === "done" ? "✓" : "○"} ${step.title}`)].join("\n"), title: task.goal, url: task.lastPage?.url });
  return <article className={`task-card ${dense ? "dense" : ""}`} tabIndex={0} aria-label={`Project: ${task.goal}`} onFocus={select} onClick={select} data-selected={workbench.selected?.id === task.id}>
    <div className="row between"><span className={`status-pill ${task.status}`}>{task.status}</span><time>{relativeTime(task.updatedAt)}</time></div>
    <h3>{task.goal}</h3>
    {task.lastPage && <a className="source-link" href={task.lastPage.url} target="_blank" rel="noreferrer">{host(task.lastPage.url)} ↗</a>}
    <p className="next-step">{task.nextStep}</p>
    {!dense && <details className="task-details"><summary>Project steps</summary><ol className="steps">{task.steps.map((step) => <li key={step.id} className={step.status}><span>{step.status === "done" ? "✓" : "○"}</span><div>{step.title}{step.completion && <a className="source-link" href={step.completion.url} target="_blank" rel="noreferrer" title={step.completion.evidence}>{step.completion.source === "user" ? "Confirmed by you" : "Verified on page"} ↗</a>}</div></li>)}</ol></details>}
    <small>Select this project, then ask to continue, pause, cancel, or text it.</small>
  </article>;
}
export function NoteCard({ note, refresh, compact = false }: { note: SourceNote; refresh: () => Promise<void>; compact?: boolean; textToPhone?: boolean }) {
  const workbench = useWorkbench();
  const [text, setText] = useState(note.text), [saved, setSaved] = useState(note.text);
  const [error, setError] = useState(""), [saving, setSaving] = useState(false);
  const textRef = useRef(text), savedRef = useRef(note.text), noteRef = useRef(note), queue = useRef<Promise<unknown>>(Promise.resolve()), pending = useRef(0), noteId = useRef(note.id);
  textRef.current = text; noteRef.current = note;
  useEffect(() => {
    if (noteId.current !== note.id || textRef.current === savedRef.current) { setText(note.text); textRef.current = note.text; }
    noteId.current = note.id; savedRef.current = note.text; setSaved(note.text);
  }, [note.id, note.text]);
  const select = () => workbench.selectContent({ kind: "note", id: note.id, text: textRef.current, title: note.title, url: note.url || undefined, ...(note.origin ? { conversationId: note.origin.conversationId, artifactId: note.origin.documentId, page: note.origin.page } : {}) });
  const save = () => {
    const snapshot = textRef.current;
    if (snapshot === savedRef.current && pending.current === 0) return Promise.resolve();
    if (!snapshot.trim()) { setError("A note cannot be empty. Ask to delete this note instead."); return Promise.resolve(); }
    const original = noteRef.current;
    pending.current++; setSaving(true); setError("");
    const task = queue.current.catch(() => {}).then(async () => {
      if (snapshot === savedRef.current) return;
      await request({ type: "note.save", note: { ...original, text: snapshot } });
      savedRef.current = snapshot; setSaved(snapshot); await refresh();
    }).catch((cause) => setError(message(cause))).finally(() => { pending.current--; setSaving(pending.current > 0); });
    queue.current = task; return task;
  };
  const latestSave = useRef(save); latestSave.current = save;
  useEffect(() => () => { void latestSave.current(); }, []);
  useEffect(() => { if (text === saved) return; const timer = setTimeout(() => void latestSave.current(), 500); return () => clearTimeout(timer); }, [text, saved]);
  const source = note.url || (note.origin ? `${chrome.runtime.getURL("newtab.html")}?${new URLSearchParams({ conversationId: note.origin.conversationId, ...(note.origin.documentId ? { documentId: note.origin.documentId } : {}), ...(note.origin.page ? { page: String(note.origin.page) } : {}) })}${note.origin.kind === "document" ? "#documents" : ""}` : "");
  return <article className="note-card" onClick={select} data-selected={workbench.selected?.id === note.id}>
    <div className="row between">{source && <a className="source-link" href={source} target="_blank" rel="noreferrer">{note.url ? host(note.url) : note.origin?.kind === "document" ? `Document${note.origin.page ? ` · page ${note.origin.page}` : ""}` : "Conversation"} ↗</a>}<time>{relativeTime(note.updatedAt)}</time></div>
    <textarea className="note-text direct-note-editor" aria-label={`Edit note: ${note.title || note.text.slice(0, 50)}`} rows={compact ? 3 : 5} maxLength={4000} value={text} onFocus={select} onChange={(event) => { textRef.current = event.target.value; setText(event.target.value); }} onBlur={() => void save()} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void save(); } }} />
    {!compact && note.excerpt && <details className="source-details"><summary>Source</summary><span>{note.title}</span><blockquote>{note.excerpt}</blockquote></details>}
    <small role="status">{saving ? "Saving…" : text === saved ? "Saved · edit directly, or ask to delete/text this note." : "Saving edits automatically…"}</small><Notice tone="error">{error}</Notice>
  </article>;
}
/** Sending selected content is provided by the phone conversation tool. */
export function TextToPhone(_props: { text: string }) { return null; }
