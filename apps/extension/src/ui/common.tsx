import { useState, type ReactNode, type FormEvent } from "react";
import type { BrowserTask, SourceNote } from "@core";
import { request } from "../bridge";
import { host, message, relativeTime } from "./hooks";
import { Icon } from "./Icon";

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <a
      className={`brand ${small ? "brand-small" : ""}`}
      href="newtab.html"
      aria-label="HypeMan home"
    >
      <span className="brand-symbol" aria-hidden="true">
        <img src={chrome.runtime.getURL("assets/icons/icon32.png")} width={32} height={32} alt="" />
      </span>
      <span>HypeMan</span>
    </a>
  );
}
export function Notice({
  children,
  tone = "info",
}: {
  children?: ReactNode;
  tone?: "info" | "error" | "success";
}) {
  return children ? (
    <div role={tone === "error" ? "alert" : "status"} className={`notice ${tone}`}>
      {children}
    </div>
  ) : null;
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-mark" aria-hidden="true">
        ✦
      </span>
      <h3>{title}</h3>
      <p className="sr-only">{children}</p>
    </div>
  );
}
export function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="toggle-row" title={description}>
      <span>
        <strong>{label}</strong>
        <small className="sr-only">{description}</small>
      </span>
      <input
        type="checkbox"
        className="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
export function TaskCard({
  task,
  refresh,
  dense = false,
}: {
  task: BrowserTask;
  refresh: () => Promise<void>;
  dense?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const act = async (action: "resume" | "pause" | "cancel") => {
    setBusy(true);
    try {
      await request({ type: action === "resume" && location.protocol !== "chrome-extension:"
        ? "task.follow" : `task.${action}`, id: task.id });
      await refresh();
      setError("");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className={`task-card ${dense ? "dense" : ""}`}>
      <div className="row between">
        <span className={`status-pill ${task.status}`} title={task.status} aria-label={task.status}>
          <i />
          <span className="sr-only">{task.status}</span>
        </span>
        <time dateTime={new Date(task.updatedAt).toISOString()}>
          {relativeTime(task.updatedAt)}
        </time>
      </div>
      <h3>{task.goal}</h3>
      {task.lastPage && (
        <a className="source-link" href={task.lastPage.url} target="_blank" rel="noreferrer">
          {host(task.lastPage.url)} <span>↗</span>
        </a>
      )}
      <div
        className="task-progress"
        aria-label={`${task.steps.filter((s) => s.status === "done").length} of ${task.steps.length} steps complete`}
      >
        {task.steps.map((s) => (
          <i key={s.id} className={s.status} title={s.title} />
        ))}
      </div>
      {!dense && (
        <details className="task-details">
          <summary aria-label="Task details" title="Task details">
            <Icon name="task" />
            <span>Details</span>
          </summary>
          <p className="next-step">{task.nextStep}</p>
          <ol className="steps">
            {task.steps.map((s) => (
              <li key={s.id} className={s.status}>
                <span>{s.status === "done" ? "✓" : s.status === "doing" ? "◉" : "○"}</span>
                <div>{s.title}{s.completion && <a className="source-link"
                  href={s.completion.url} target="_blank" rel="noreferrer"
                  title={s.completion.evidence}>
                  {s.completion.source === "user" ? "Confirmed by you" : "Verified on page"} ↗
                </a>}</div>
              </li>
            ))}
          </ol>
        </details>
      )}
      <div className="row">
        {location.protocol !== "chrome-extension:" && task.status === "running" && (
          <button className="button small primary" disabled={busy}
            aria-label="Continue project here" title="Continue project here"
            onClick={() => void act("resume")}><Icon name="play" /></button>
        )}
        <button
          disabled={busy || task.status === "completed" || task.status === "cancelled"}
          className="button small primary"
          aria-label={task.status === "running" ? "Pause task" : "Continue task"}
          title={task.status === "running" ? "Pause task" : "Continue task"}
          onClick={() => void act(task.status === "running" ? "pause" : "resume")}
        >
          <Icon name={task.status === "running" ? "pause" : "play"} />
        </button>
        {!dense && task.status !== "cancelled" && task.status !== "completed" && (
          <button
            className="button small ghost"
            aria-label="Cancel task"
            title="Cancel task"
            disabled={busy}
            onClick={() => void act("cancel")}
          >
            <Icon name="stop" />
          </button>
        )}
      </div>
      <Notice tone="error">{error}</Notice>
    </article>
  );
}
export function NoteCard({
  note,
  refresh,
  compact = false,
}: {
  note: SourceNote;
  refresh: () => Promise<void>;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await request({
        type: "note.save",
        note: {
          id: note.id,
          text,
          excerpt: note.excerpt,
          url: note.url,
          title: note.title,
          taskId: note.taskId,
        },
      });
      setEditing(false);
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await request({ type: "note.remove", id: note.id });
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="note-card">
      <div className="row between">
        <a className="source-link" href={note.url} target="_blank" rel="noreferrer">
          {host(note.url)} ↗
        </a>
        <time>{relativeTime(note.updatedAt)}</time>
      </div>
      {editing ? (
        <form onSubmit={save}>
          <label className="field">
            Your note
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={4000}
              rows={4}
              required
            />
          </label>
          <div className="row">
            <button
              disabled={busy || !text.trim()}
              className="button small primary"
              aria-label="Save note"
              title="Save note"
            >
              <Icon name="check" />
            </button>
            <button
              className="button small ghost"
              type="button"
              aria-label="Cancel edit"
              title="Cancel edit"
              onClick={() => setEditing(false)}
            >
              <Icon name="close" />
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="note-text">{note.text}</p>
          {!compact && note.excerpt && (
            <details className="source-details">
              <summary aria-label="Source details" title="Source details">
                <Icon name="link" />
                Source
              </summary>
              <span className="note-title">{note.title}</span>
              <blockquote>{note.excerpt}</blockquote>
            </details>
          )}
          <div className="row note-actions">
            <button
              className="text-button"
              aria-label="Edit"
              title="Edit note"
              onClick={() => {
                setText(note.text);
                setEditing(true);
              }}
            >
              <Icon name="sketch" />
            </button>
            <button
              className="text-button danger"
              aria-label="Remove"
              title="Remove note"
              disabled={busy}
              onClick={() => void remove()}
            >
              <Icon name="trash" />
            </button>
          </div>
        </>
      )}
      <Notice tone="error">{error}</Notice>
    </article>
  );
}
