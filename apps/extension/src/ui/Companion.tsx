import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
  type ButtonHTMLAttributes,
} from "react";
import type { Action } from "@core";
import type { CompanionRuntime, CompanionSnapshot } from "../runtime/types";
import { request, subscribe } from "../bridge";
import { Notice } from "./common";
import { message } from "./hooks";
import { Pet } from "./Pet";
import { Icon, type IconName } from "./Icon";
import type { CompanionSection } from "./CompanionTools";
import { ToolOverlay } from "./ToolOverlay";
import { Video } from "./Video";
import { isOverlaySection, type OverlaySection } from "./overlay-sections";

type Tab = "chat" | "learn" | "video" | "sketch" | "task" | CompanionSection;
function Tool({
  icon,
  label,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button
      type="button"
      className={`dock-button ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon name={icon} />
    </button>
  );
}

export function Companion({ runtime }: { runtime: CompanionRuntime }) {
  const [snapshot, setSnapshot] = useState<CompanionSnapshot>(() => runtime.getSnapshot());
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("chat");
  const [overlay, setOverlay] = useState<OverlaySection | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [seenHint, setSeenHint] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [capture, setCapture] = useState("");
  const [capturing, setCapturing] = useState(false);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 20, y: 18 });
  const drag = useRef<{
    x: number;
    y: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => runtime.subscribe(() => setSnapshot(runtime.getSnapshot())), [runtime]);
  useEffect(() => {
    if (open && !overlay && snapshot.learning.autoHint)
      setSeenHint(snapshot.learning.autoHint.id);
  }, [open, overlay, snapshot.learning.autoHint]);
  useEffect(
    () =>
      subscribe((event) => {
        if (event.type !== "command") return;
        if (event.name === "toggle-companion") {
          setOpen((value) => !value);
          setTimeout(() => input.current?.focus(), 30);
        } else if (event.name === "open-chat") {
          setOpen(true);
          setOverlay(null);
          setTab("chat");
          setToolsOpen(false);
          setTimeout(() => input.current?.focus(), 30);
        } else if (event.name === "open-tools") {
          setOverlay(isOverlaySection(event.section) ? event.section : "tasks");
          setTab("chat");
          setOpen(true);
          setToolsOpen(false);
        }
      }),
    [],
  );
  useEffect(() => {
    if (open && tab === "chat")
      end.current?.scrollIntoView({
        block: "nearest",
        behavior: snapshot.reducedMotion ? "instant" : "smooth",
      });
  }, [snapshot.messages.length, open, tab, snapshot.reducedMotion]);
  useEffect(() => {
    const field = input.current;
    if (field) {
      field.style.height = "auto";
      field.style.height = `${Math.min(field.scrollHeight, 96)}px`;
    }
  }, [text, open, tab]);
  useEffect(() => {
    if (!snapshot.confirmation) return;
    setOverlay(null);
    setOpen(true);
    setTab("chat");
    setToolsOpen(false);
    const frame = requestAnimationFrame(() =>
      confirmationRef.current?.querySelector<HTMLButtonElement>("button")?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [snapshot.confirmation]);
  useEffect(() => {
    if (snapshot.sketch) {
      setOpen(true);
      setOverlay("board");
      setToolsOpen(false);
    }
  }, [snapshot.sketch]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !open || snapshot.confirmation) return;
      if (overlay) {
        setOverlay(null);
        input.current?.focus();
      } else if (toolsOpen) {
        setToolsOpen(false);
        input.current?.focus();
      } else if (tab !== "chat") setTab("chat");
      else setOpen(false);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open, tab, toolsOpen, overlay, snapshot.confirmation]);
  const select = (next: Tab | OverlaySection) => {
    if (snapshot.confirmation && next !== "chat") return;
    const selected = next === "task" ? "tasks" : next === "sketch" ? "board" : next === "learn" ? "learning" : next;
    setOverlay(isOverlaySection(selected) ? selected : null);
    setTab("chat");
    setToolsOpen(false);
    setError("");
  };
  const send = async (event?: FormEvent, quick?: string, keepTool = false) => {
    event?.preventDefault();
    const value = quick || text.trim();
    if (!value || snapshot.confirmation) return;
    setText("");
    setError("");
    if (!keepTool) select("chat");
    try {
      await runtime.send(value);
    } catch (e) {
      setError(message(e));
    }
  };
  const pin = async () => {
    setError("");
    try {
      await runtime.pinSelection(text.trim() || undefined);
      setText("");
      select("notes");
    } catch (e) {
      setError(message(e));
    }
  };
  const capturePage = async () => {
    setError("");
    setCapturing(true);
    try {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const result = await request<{ image: string }>({ type: "screenshot" });
      setCapture(result.image);
      setOpen(true);
      select("notes");
    } catch (e) {
      const reason = message(e);
      setError(
        reason.includes("<all_urls>") || reason.includes("activeTab")
          ? "Open HypeMan from the toolbar on this tab, or enable screenshot access in Settings, then try again."
          : reason,
      );
    } finally {
      setCapturing(false);
    }
  };
  const pauseSite = async () => {
    try {
      await request({
        type: "settings.patch",
        patch: {
          hiddenOnHosts: [
            ...new Set([...snapshot.settings.hiddenOnHosts, location.hostname.toLowerCase()]),
          ],
        },
      });
    } catch (e) {
      setError(message(e));
    }
  };
  const down = (event: PointerEvent<HTMLButtonElement>) => {
    drag.current = {
      x: position.x,
      y: position.y,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = d.startX - event.clientX,
      dy = d.startY - event.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true;
    if (d.moved)
      setPosition({
        x: Math.max(4, Math.min(innerWidth - 100, d.x + dx)),
        y: Math.max(4, Math.min(innerHeight - 100, d.y + dy)),
      });
  };
  const up = () => {
    if (!drag.current?.moved) {
      setOpen((v) => !v);
      setTimeout(() => input.current?.focus(), 30);
    }
    drag.current = null;
  };
  const running = snapshot.phase === "thinking" || snapshot.phase === "acting";
  const state = running
    ? "thinking"
    : snapshot.phase === "error"
      ? "confused"
      : snapshot.phase === "paused"
        ? "sleepy"
        : "idle";
  const completed = snapshot.task?.steps.filter((step) => step.status === "done").length || 0;
  const conversation = snapshot.messages.filter((m) => m.role !== "status");
  const visibleConversation = historyOpen ? conversation : conversation.slice(-1);
  const activity = snapshot.messages.filter((m) => m.role === "status").at(-1);
  const freshHint = snapshot.learning.autoHint?.id !== seenHint
    ? snapshot.learning.autoHint
    : null;
  const hintPreview = freshHint?.text.split(/\s+/).slice(0, 35).join(" ").slice(0, 280) ?? "";
  if (snapshot.settings.hiddenOnHosts.includes(location.hostname.toLowerCase())) return null;
  const panelStyle = {
    right: Math.min(0, innerWidth - position.x - Math.min(340, innerWidth - 22) - 12),
    ...(position.y > innerHeight / 2 ? { top: 92, bottom: "auto" } : {}),
    maxHeight: Math.max(
      200,
      (position.y > innerHeight / 2 ? position.y : innerHeight - position.y) - 115,
    ),
  };
  return (
    <div
      className="companion-root"
      style={{
        right: position.x,
        bottom: position.y,
        visibility: capturing ? "hidden" : "visible",
      }}
    >
      {open && (
        <section
          className={`companion-panel ${snapshot.reducedMotion ? "still" : ""} ${conversation.length ? "has-conversation" : ""}`}
          style={panelStyle}
          aria-label={`${snapshot.settings.characterName} companion`}
        >
          <header className="companion-header">
            <div className="dock-identity">
              {tab !== "chat" && <Tool icon="back" label="Chat" onClick={() => select("chat")} />}
              <i
                className={`dock-status ${snapshot.phase}`}
                role="status"
                aria-label={snapshot.status || "Ready"}
                title={snapshot.status || "Ready"}
              />
              <strong className="sr-only">{snapshot.settings.characterName}</strong>
              {snapshot.task && (
                <Tool
                  icon="task"
                  label="Task progress"
                  aria-pressed={tab === "task"}
                  onClick={() => select(tab === "task" ? "chat" : "task")}
                />
              )}
            </div>
            <div className="dock-header-actions">
              {conversation.length > 1 && (
                <Tool
                  icon="activity"
                  label="Conversation history"
                  aria-pressed={historyOpen}
                  onClick={() => {
                    select("chat");
                    setHistoryOpen((value) => !value);
                  }}
                />
              )}
              <Tool
                icon="close"
                label="Close companion panel"
                disabled={!!snapshot.confirmation}
                onClick={() => setOpen(false)}
              />
            </div>
          </header>
          {snapshot.task && (
            <div
              className="dock-progress"
              role="progressbar"
              aria-label="Task progress"
              aria-valuemin={0}
              aria-valuemax={snapshot.task.steps.length}
              aria-valuenow={completed}
            >
              <i
                style={{
                  width: `${snapshot.task.steps.length ? (completed / snapshot.task.steps.length) * 100 : 0}%`,
                }}
              />
            </div>
          )}
          <div className="companion-body">
            {tab === "chat" && (
              <>
                <div className="chat-messages" role="log" aria-live="polite">
                  {visibleConversation.map((m) => (
                    <div
                      key={m.id}
                      className={`chat-message ${m.role}`}
                      aria-label={m.role === "user" ? "You" : snapshot.settings.characterName}
                    >
                      <p>{m.text}</p>
                    </div>
                  ))}
                  <div ref={end} />
                </div>
                {snapshot.confirmation && (
                  <div
                    ref={confirmationRef}
                    className="confirmation"
                    role="alertdialog"
                    aria-label="Confirm browser action"
                    onKeyDown={(event) => {
                      if (event.key !== "Tab") return;
                      const buttons = Array.from(
                        event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
                      );
                      const active = (event.currentTarget.getRootNode() as ShadowRoot)
                        .activeElement;
                      const index = buttons.findIndex((button) => button === active);
                      if (
                        (!event.shiftKey && index === buttons.length - 1) ||
                        (event.shiftKey && index === 0)
                      ) {
                        event.preventDefault();
                        buttons[event.shiftKey ? buttons.length - 1 : 0]?.focus();
                      }
                    }}
                  >
                    <strong>Confirm action</strong>
                    <p>{snapshot.confirmation.message}</p>
                    <div className="row">
                      <button
                        className="button primary small"
                        onClick={() => runtime.confirm(true)}
                      >
                        Yes, continue
                      </button>
                      <button className="button small" onClick={() => runtime.confirm(false)}>
                        Cancel action
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          <Notice tone="error">{error}</Notice>
          {toolsOpen && (
            <nav className="companion-tools" aria-label="Companion tools" inert={snapshot.confirmation ? true : undefined}>
              {snapshot.video && snapshot.settings.videoCompanion !== "off" && <Tool icon="video" label="Video" onClick={() => select("video")} />}
              <Tool icon="learn" label="Practice" onClick={() => select("learning")} />
              <Tool icon="camera" label="Paper camera" onClick={() => select("notebook")} />
              {snapshot.settings.screenshotEnabled && <Tool icon="image" label="Capture this page" onClick={() => void capturePage()} />}
              <Tool icon="customize" label="Customize companion" onClick={() => select("customize")} />
              <Tool icon="settings" label="Preferences" onClick={() => select("settings")} />
              <Tool icon="pause" label="Pause on this site" onClick={() => void pauseSite()} />
            </nav>
          )}
          <form className="companion-composer" onSubmit={send}>
            {snapshot.screenshotAttached && (
              <div className="attachment-chip">
                <Icon name="image" />
                <span>Image attached</span>
                <Tool
                  icon="close"
                  label="Remove attached image"
                  onClick={() => runtime.attachScreenshot(null)}
                />
              </div>
            )}
            <div className="dock-input-row">
              <textarea
                ref={input}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                maxLength={4000}
                placeholder={tab === "notes" ? "A thought to keep…" : "What’s next?"}
                rows={1}
                aria-label="Message your companion"
                disabled={!!snapshot.confirmation}
              />
              {running ? (
                <Tool
                  icon="stop"
                  label="Stop"
                  className="dock-send"
                  onClick={() => runtime.stop()}
                />
              ) : (
                <button
                  className="dock-button dock-send"
                  type="submit"
                  disabled={!text.trim() || !!snapshot.confirmation}
                  aria-label="Send message"
                  title="Send message"
                >
                  <Icon name="arrow" />
                </button>
              )}
            </div>
          </form>
          <nav
            className="companion-quickbar"
            aria-label="Quick tools"
            inert={snapshot.confirmation ? true : undefined}
          >
            {snapshot.learning.enabled && (
              <Tool
                icon="hint"
                label={snapshot.learning.hintLevel ? "Next hint" : "A little hint"}
                disabled={running}
                onClick={() => void send(undefined, "Give me a small hint, without solving it for me")}
              />
            )}
            <Tool
              icon="task"
              label="Tasks"
              aria-pressed={overlay === "tasks"}
              onClick={() => select(overlay === "tasks" ? "chat" : "tasks")}
            />
            <Tool
              icon="notes"
              label="Notes"
              aria-pressed={overlay === "notes"}
              onClick={() => select(overlay === "notes" ? "chat" : "notes")}
            />
            <Tool icon="sketch" label="Whiteboard" aria-pressed={overlay === "board"} onClick={() => select(overlay === "board" ? "chat" : "board")} />
            <Tool
              icon={toolsOpen ? "close" : "plus"}
              label="More tools"
              aria-expanded={toolsOpen}
              className={toolsOpen ? "selected" : ""}
              onClick={() => setToolsOpen((value) => !value)}
            />
          </nav>
          {running && (
            <div className="companion-activity" role="status">
              <i />
              <span>{snapshot.status || "Working…"}</span>
            </div>
          )}
          {!running && activity && tab === "chat" && (
            <details className="companion-activity dock-activity-log">
              <summary>
                <Icon name="check" />
                <span className="sr-only">Activity</span>
              </summary>
              <p>{activity.text}</p>
            </details>
          )}
        </section>
      )}
      <ToolOverlay section={snapshot.confirmation ? null : overlay} onClose={() => { setOverlay(null); input.current?.focus(); }} onOpen={select} onError={setError}
        onStartTask={() => { setOverlay(null); input.current?.focus(); }}
        videoContent={snapshot.video && (
              <div className="panel-video">
                <div className="dock-view-heading">
                  <h2>Video</h2>
                  <time>
                    {Math.floor(snapshot.video.time / 60)}:
                    {Math.floor(snapshot.video.time % 60)
                      .toString()
                      .padStart(2, "0")}
                  </time>
                </div>
                <p className="dock-video-title">{snapshot.video.title || "Video companion"}</p>
                <div className="dock-inline-actions dock-video-controls">
                  <Tool
                    icon="rewind"
                    label="Rewind 15 seconds"
                    onClick={() => void send(undefined, "Rewind the video by 15 seconds", true)}
                  />
                  <Tool
                    icon={snapshot.video.paused ? "play" : "pause"}
                    label={snapshot.video.paused ? "Play video" : "Pause video"}
                    onClick={() =>
                      void send(
                        undefined,
                        snapshot.video?.paused ? "Play the video" : "Pause the video",
                        true,
                      )
                    }
                  />
                  <Tool
                    icon="spark"
                    label="Video key ideas"
                    onClick={() => void send(undefined, "Summarize this video from its captions", true)}
                  />
                </div>
                {snapshot.video.summary && (
                  <p className="video-summary">{snapshot.video.summary}</p>
                )}
                {snapshot.video.available === false && (
                  <Notice>
                    Captions aren’t available on this player. Add captions below to continue.
                  </Notice>
                )}
                {snapshot.video.chapters?.map((chapter, i) => (
                  <button
                    className="video-chapter"
                    key={i}
                    onClick={() =>
                      void send(undefined, `Seek the video to ${chapter.start} seconds`, true)
                    }
                  >
                    <time>
                      {Math.floor(chapter.start / 60)}:
                      {Math.floor(chapter.start % 60)
                        .toString()
                        .padStart(2, "0")}
                    </time>
                    {chapter.title}
                  </button>
                ))}
                <details className="video-add-captions"><summary>Add captions</summary><Video embedded active={overlay === "video"} page={{ url: location.href, title: snapshot.video.title }} onSeek={(seconds) => void send(undefined, `Seek the video to ${seconds} seconds`, true)} /></details>
              </div>
            )}
        learningContent={snapshot.learning.enabled && (
              <div className="panel-learning">
                <div className="dock-view-heading">
                  <h2>Practice</h2>
                  <div className="dock-inline-actions">
                    <Tool
                      icon="hint"
                      label={snapshot.learning.hintLevel ? "Next hint" : "A little hint"}
                      onClick={() =>
                        void send(undefined, "Give me a small hint, without solving it for me")
                      }
                    />
                    <Tool
                      icon="task"
                      label="Make a plan"
                      onClick={() => void send(undefined, "Make a learning plan for this page")}
                    />
                  </div>
                </div>
                {snapshot.learning.plan.length ? (
                  <ol className="steps">
                    {snapshot.learning.plan.map((step, i) => (
                      <li key={i}>
                        <span>{i + 1}</span>
                        {step}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="dock-empty">Need a hint?</p>
                )}
                {snapshot.learning.teaching && (
                  <div className="teaching-card">
                    <h3>{snapshot.learning.teaching.concept}</h3>
                    <p>{snapshot.learning.teaching.heard}</p>
                    <div className="row">
                      <button className="button small primary" onClick={() => runtime.teach(true)}>
                        Yes, check my explanation
                      </button>
                      <button className="button small" onClick={() => runtime.teach(false)}>
                        Try again
                      </button>
                    </div>
                  </div>
                )}
                {snapshot.learning.hintLevel > 0 && (
                  <p className="hint-level">Hint {snapshot.learning.hintLevel} / 4</p>
                )}
              </div>
            )}
        boardContent={snapshot.sketch ? <Sketch sketch={snapshot.sketch} /> : undefined}
        notesActions={<><Tool icon="pin" label="Pin page selection" onMouseDown={(e) => e.preventDefault()} onClick={() => void pin()} />{capture && <div className="page-capture"><img src={capture} alt="Captured webpage" /><a className="dock-button" href={capture} download="hypeman-page.jpg" aria-label="Save image" title="Save image"><Icon name="download" /></a><Tool icon="trash" label="Discard capture" onClick={() => { setCapture(""); runtime.attachScreenshot(null); }} /><Tool icon="image" label="Attach to next message" onClick={() => { runtime.attachScreenshot(capture); select("chat"); }} /></div>}</>}
      />
      {!open && freshHint && snapshot.phase === "idle" && (
        <div className="pet-hint-preview" aria-live="polite" style={{
          right: panelStyle.right,
          ...(position.y > innerHeight / 2 ? { top: 96, bottom: "auto" } : {}),
        }}>
          <button type="button" className="pet-hint-open"
            aria-label={freshHint.kind === "explanation" ? "Show explanation" : "Show hint"}
            title={freshHint.kind === "explanation" ? "Open explanation" : "Open hint"}
            onClick={() => { setSeenHint(freshHint.id); setOpen(true); select("chat"); }}>
            <Icon name="hint" /><span>{hintPreview}{freshHint.text.length > hintPreview.length ? "…" : ""}</span>
          </button>
          <Tool icon="close" label={freshHint.kind === "explanation" ? "Dismiss explanation" : "Dismiss hint"}
            onClick={() => setSeenHint(freshHint.id)} />
        </div>
      )}
      {!open && snapshot.phase !== "idle" && (
        <button
          className={`pet-bubble ${snapshot.phase}`}
          aria-label={
            snapshot.confirmation ? "Review pending action" : snapshot.status || "Open activity"
          }
          title={
            snapshot.confirmation
              ? "Your confirmation is needed"
              : snapshot.status || "Open activity"
          }
          onClick={() => {
            setOpen(true);
            select("chat");
          }}
        >
          <Icon
            name={snapshot.confirmation ? "hint" : snapshot.phase === "error" ? "hint" : "spark"}
          />
          {snapshot.confirmation && <span>Confirm?</span>}
        </button>
      )}
      <button
        className="pet-handle"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onClick={(event) => {
          if (event.detail === 0) {
            setOpen((v) => !v);
            setTimeout(() => input.current?.focus(), 30);
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        aria-label={`${open ? "Close" : "Open"} ${snapshot.settings.characterName}. Drag to move.`}
        aria-expanded={open}
      >
        <Pet settings={snapshot.settings} state={state} scale={1.5} />
        <span className="pet-shadow" />
      </button>
    </div>
  );
}

function Sketch({ sketch }: { sketch: Extract<Action, { type: "sketch" }> }) {
  const marker = `arrow-${crypto.randomUUID()}`;
  return (
    <div className="panel-sketch">
      <h2>{sketch.title}</h2>
      {sketch.shapes?.length ? (
        <svg viewBox="0 0 600 400" className="sketch-canvas" role="img" aria-label={sketch.title}>
          <defs>
            <marker
              id={marker}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#7b5cff" />
            </marker>
          </defs>
          {sketch.shapes.map((shape, i) =>
            shape.type === "circle" ? (
              <circle
                key={i}
                cx={shape.x}
                cy={shape.y}
                r={shape.radius}
                fill="none"
                stroke="#7b5cff"
                strokeWidth="3"
              />
            ) : shape.type === "label" ? (
              <text key={i} x={shape.x} y={shape.y} fill="#1b1f3b" fontSize="18">
                {shape.text}
              </text>
            ) : (
              <line
                key={i}
                x1={shape.x}
                y1={shape.y}
                x2={shape.toX}
                y2={shape.toY}
                stroke="#7b5cff"
                strokeWidth="3"
                markerEnd={shape.type === "arrow" ? `url(#${marker})` : undefined}
              />
            ),
          )}
        </svg>
      ) : null}
      <ol>
        {sketch.lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ol>
    </div>
  );
}
