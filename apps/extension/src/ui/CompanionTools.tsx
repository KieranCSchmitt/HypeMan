import { useEffect, useState } from "react";
import { learningEstimate, type Health, type LearningGraph, type Settings } from "@core";
import { request } from "../bridge";
import { Empty, NoteCard, Notice, TaskCard } from "./common";
import {
  exportWorkspace,
  host,
  message,
  relativeTime,
  setScreenshotAccess,
  useSettings,
  useWorkspace,
} from "./hooks";
import { Icon, type IconName } from "./Icon";
import { ChatGPTConnection } from "./ChatGPTConnection";

export type CompanionSection = "tasks" | "notes" | "activity" | "settings" | "learning";
export const companionSections: { section: CompanionSection; icon: IconName; label: string }[] = [
  { section: "tasks", icon: "task", label: "Tasks" },
  { section: "notes", icon: "notes", label: "Saved notes" },
  { section: "activity", icon: "rewind", label: "Recent actions" },
  { section: "settings", icon: "settings", label: "Settings and permissions" },
  { section: "learning", icon: "learn", label: "Learning" },
];

export function CompanionTools({
  section,
  onClose,
  onError,
  onStartTask,
  onSectionChange,
  embedded = false,
  onOpenTool,
}: {
  section: CompanionSection;
  onClose: () => void;
  onError?: (error: string) => void;
  onStartTask?: () => void;
  onSectionChange?: (section: CompanionSection) => void;
  embedded?: boolean;
  onOpenTool?: (section: "customize" | "connection") => void;
}) {
  const { workspace, refresh, error, loading } = useWorkspace();
  const { settings, patch, error: settingsError } = useSettings();
  const [active, setActive] = useState(section);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState(settings.characterName);
  const [health, setHealth] = useState<Health | null>(null);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const extensionPage = location.protocol === "chrome-extension:";
  useEffect(() => setActive(section), [section]);
  useEffect(() => setName(settings.characterName), [settings.characterName]);
  const fail = (e: unknown) => {
    const value = message(e);
    setNotice(value);
    onError?.(value);
  };
  const edit = (changes: Partial<Settings>) => void patch(changes).catch(fail);
  const permission = async (enabled: boolean) => {
    try {
      if (enabled && !(await chrome.permissions.request({ permissions: ["debugger"] })))
        throw new Error("Browser input permission was not granted.");
      await patch({ trustedInput: enabled });
    } catch (e) {
      fail(e);
    }
  };
  useEffect(() => {
    if (active !== "settings" || !extensionPage) return;
    const controller = new AbortController();
    void request<Health>({ type: "connection.ensure" }, controller.signal)
      .then(setHealth)
      .catch((e) => {
        if (!controller.signal.aborted) setHealth(null);
      });
    return () => controller.abort();
  }, [active, settings.serverUrl, extensionPage]);
  const tasks = [...workspace.tasks]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((task) => filter === "all" || task.status === filter);
  const notes = [...workspace.notes]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((note) =>
      `${note.text} ${note.excerpt} ${note.title} ${note.url}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  const outcomes = [...workspace.events].reverse().filter((event) =>
    !event.ok || !/^(Page observed|Control activated|Video seek verified|Field filled|Scrolled|Highlighted)/i.test(event.summary),
  );
  const toggle = (
    icon: IconName,
    label: string,
    checked: boolean,
    change: (value: boolean) => void,
  ) => (
    <button
      type="button"
      className={`inline-capability ${checked ? "selected" : ""}`}
      aria-label={label}
      title={`${label}: ${checked ? "on" : "off"}`}
      aria-pressed={checked}
      onClick={() => change(!checked)}
    >
      <Icon name={icon} />
      <i aria-hidden="true" />
    </button>
  );
  return (
    <section
      className={`inline-toolbox inline-toolbox-${active}`}
      aria-label={companionSections.find((s) => s.section === active)?.label}
    >
      {!embedded && <header className="inline-tool-header">
        <nav className="inline-tool-tabs" aria-label="Companion collections">
          {companionSections.map((item) => (
            <button
              key={item.section}
              type="button"
              aria-label={item.label}
              title={item.label}
              aria-pressed={active === item.section}
              className={active === item.section ? "selected" : ""}
              onClick={() => {
                setActive(item.section);
                onSectionChange?.(item.section);
                setNotice("");
              }}
            >
              <Icon name={item.icon} />
            </button>
          ))}
        </nav>
        <div className="inline-tool-actions">
          <button
            type="button"
            aria-label="Export workspace"
            title="Export workspace"
            onClick={() => exportWorkspace(workspace)}
          >
            <Icon name="download" />
          </button>
          <button type="button" aria-label="Close tools" title="Close tools" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
      </header>}
      <div className="inline-tool-body">
        <Notice tone="error">{error || settingsError || (!onError ? notice : "")}</Notice>
        {loading && (
          <span role="status" className="inline-loading">
            <Icon name="activity" />
            <span className="sr-only">Loading</span>
          </span>
        )}
        {active === "tasks" && (
          <>
            <div className="inline-tool-filters" role="group" aria-label="Filter tasks">
              {(
                [
                  ["all", "task", "All tasks"],
                  ["running", "play", "Running tasks"],
                  ["paused", "pause", "Paused tasks"],
                  ["completed", "check", "Completed tasks"],
                  ["cancelled", "close", "Cancelled tasks"],
                ] as const
              ).map(([value, icon, label]) => (
                <button
                  type="button"
                  key={value}
                  aria-label={label}
                  title={label}
                  aria-pressed={filter === value}
                  className={filter === value ? "selected" : ""}
                  onClick={() => setFilter(value)}
                >
                  <Icon name={icon} />
                </button>
              ))}
              {onStartTask && (
                <button type="button" aria-label="New task" title="New task" onClick={onStartTask}>
                  <Icon name="plus" />
                </button>
              )}
            </div>
            <div className="inline-tool-list">
              {tasks.length ? (
                tasks.map((task) => <TaskCard key={task.id} task={task} refresh={refresh} />)
              ) : (
                <Empty title="Clear runway">Describe a task in the message field.</Empty>
              )}
            </div>
            {embedded && outcomes.length > 0 && <details className="workspace-history"><summary>Completed actions</summary><div className="inline-action-list">{outcomes.slice(0, 12).map((event) => <article key={event.id} className="inline-action"><Icon name={event.ok ? "check" : "close"} /><p>{event.summary}</p></article>)}</div></details>}
          </>
        )}
        {active === "notes" && (
          <>
            <div className="inline-tool-search">
              <Icon name="search" />
              <input
                aria-label="Search saved notes"
                placeholder="Find a note…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="inline-tool-list">
              {notes.length ? (
                notes.map((note) => <NoteCard key={note.id} note={note} refresh={refresh} />)
              ) : (
                <Empty title={search ? "No matches" : "Nothing pinned"}>
                  Select text on a webpage and pin it.
                </Empty>
              )}
            </div>
          </>
        )}
        {active === "activity" && (
          <div className="inline-tool-list inline-action-list">
            {outcomes.length ? (
              outcomes.map((event) => (
                <article key={event.id} className="inline-action">
                  <Icon
                    name={event.ok ? "check" : "close"}
                    aria-label={event.ok ? "Verified" : "Failed"}
                  />
                  <div>
                    <p>{event.summary}</p>
                    <details>
                      <summary aria-label="Action details" title="Action details">
                        <Icon name="plus" />
                        <time>{relativeTime(event.at)}</time>
                      </summary>
                      <span>{event.action.replaceAll("_", " ")}</span>
                      {event.url && (
                        <a href={event.url} target="_blank" rel="noreferrer">
                          {host(event.url)} <Icon name="external" />
                        </a>
                      )}
                      <small>
                        {workspace.tasks.find((task) => task.id === event.taskId)?.goal}
                      </small>
                    </details>
                  </div>
                </article>
              ))
            ) : (
              <Empty title="Fresh track">Verified actions appear here.</Empty>
            )}
          </div>
        )}
        {active === "settings" && (
          <>
            <div className="inline-capabilities" role="group" aria-label="Capability permissions">
              {toggle(
                "camera",
                "Page screenshots",
                settings.screenshotEnabled,
                (value) => void setScreenshotAccess(value, patch).catch(fail),
              )}
              {toggle("folder", "Other tab context", settings.tabContextEnabled, (value) =>
                edit({ tabContextEnabled: value }),
              )}
              {toggle(
                "shield",
                "Trusted browser actions",
                settings.trustedInput,
                (value) => void permission(value),
              )}
              {toggle("hint", "Automatic hints", settings.proactiveEnabled, (value) =>
                edit({ proactiveEnabled: value }),
              )}
              {toggle("learn", "Learning mode", settings.learningEnabled, (value) =>
                edit({ learningEnabled: value }),
              )}
            </div>
            <div className="inline-setting-fields">
              <label title="Companion name">
                <Icon name="chat" />
                <input
                  aria-label="Companion name"
                  maxLength={60}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() =>
                    name.trim()
                      ? edit({ characterName: name.trim() })
                      : setName(settings.characterName)
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                />
              </label>
              <label title="Motion">
                <Icon name="activity" />
                <select
                  aria-label="Motion"
                  value={settings.reducedMotion}
                  onChange={(e) =>
                    edit({ reducedMotion: e.target.value as Settings["reducedMotion"] })
                  }
                >
                  <option value="auto">System motion</option>
                  <option value="on">Reduced motion</option>
                  <option value="off">Full animation</option>
                </select>
              </label>
              <label title="Video companion">
                <Icon name="video" />
                <select
                  aria-label="Video companion"
                  value={settings.videoCompanion}
                  onChange={(e) =>
                    edit({ videoCompanion: e.target.value as Settings["videoCompanion"] })
                  }
                >
                  <option value="ask">Ask before video help</option>
                  <option value="on">Video help on</option>
                  <option value="off">Video help off</option>
                </select>
              </label>
            </div>
            <div className="inline-setting-shortcuts">
              <button
                type="button"
                aria-label="Customize companion"
                title="Customize companion"
                onClick={() =>
                  onOpenTool ? onOpenTool("customize") : void request({ type: "control.open", section: "customize" }).catch(fail)
                }
              >
                <Icon name="customize" />
              </button>
              <button
                type="button"
                aria-label="Connection settings"
                title="Connection settings"
                onClick={() => {
                  if (onOpenTool) { onOpenTool("connection"); return; }
                  if (extensionPage) setConnectionOpen(!connectionOpen);
                  else
                    void chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html#settings") });
                }}
                aria-expanded={extensionPage ? connectionOpen : undefined}
              >
                <Icon name="link" />
              </button>
            </div>
            {health && (
              <div
                className="inline-provider-status"
                role="group"
                aria-label="Provider availability"
              >
                {Object.entries(health.capabilities).map(([key, value]) => (
                  <span
                    key={key}
                    className={value.available ? "available" : "unavailable"}
                    title={`${key}: ${value.available ? value.mode : value.reason || "Unavailable"}`}
                    aria-label={`${key}: ${value.available ? value.mode : "Unavailable"}`}
                  >
                    <Icon
                      name={
                        key === "agent"
                          ? "bolt"
                          : key === "video"
                            ? "video"
                            : key === "notebook"
                              ? "notebook"
                              : "sketch"
                      }
                    />
                    <i />
                  </span>
                ))}
              </div>
            )}
            {extensionPage && connectionOpen && (
              <ChatGPTConnection
                connectionKey={settings.serverUrl}
                onConnectionChange={setHealth}
              />
            )}
            {!!settings.hiddenOnHosts.length && (
              <details className="inline-paused-sites">
                <summary>
                  <Icon name="pause" />
                  <span className="sr-only">Paused sites</span>
                  <span>{settings.hiddenOnHosts.length}</span>
                </summary>
                {settings.hiddenOnHosts.map((hostname) => (
                  <div key={hostname}>
                    <span>{hostname}</span>
                    <button
                      type="button"
                      aria-label={`Allow again: ${hostname}`}
                      title="Allow again"
                      onClick={() =>
                        edit({
                          hiddenOnHosts: settings.hiddenOnHosts.filter((item) => item !== hostname),
                        })
                      }
                    >
                      <Icon name="play" />
                    </button>
                  </div>
                ))}
              </details>
            )}
          </>
        )}
        {active === "learning" && (
          <>
            <div className="inline-capabilities">
              {toggle("learn", "Learning mode", settings.learningEnabled, (value) =>
                edit({ learningEnabled: value }),
              )}
              {toggle("hint", "Automatic hints", settings.proactiveEnabled, (value) =>
                edit({ proactiveEnabled: value }),
              )}
            </div>
            <LearningCollection enabled={settings.learningEnabled} />
          </>
        )}
        {embedded && <div className="workspace-export"><button type="button" aria-label="Export workspace" title="Export notes, tasks, and history" onClick={() => exportWorkspace(workspace)}><Icon name="download" /></button></div>}
      </div>
    </section>
  );
}

function LearningCollection({ enabled }: { enabled: boolean }) {
  const [graph, setGraph] = useState<LearningGraph | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void request<LearningGraph>({ type: "graph.get" }, controller.signal)
      .then(setGraph)
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [enabled]);
  const nodes = graph ? Object.values(graph.nodes) : [];
  const active = nodes.find((node) => node.id === selected);
  const estimate = active ? learningEstimate(active) : null;
  return (
    <div className="inline-learning">
      <Notice tone="error">{error}</Notice>
      {nodes.length ? (
        <>
          <svg
            className="inline-concept-graph"
            viewBox="0 0 320 200"
            role="group"
            aria-label="Practiced concept graph"
          >
            {nodes.slice(0, 20).map((node, index, all) => {
              const angle = (index / all.length) * Math.PI * 2 - Math.PI / 2;
              const x = 160 + Math.cos(angle) * 112,
                y = 100 + Math.sin(angle) * 72;
              return (
                <g
                  key={node.id}
                  role="button"
                  tabIndex={0}
                  aria-label={node.label}
                  onClick={() => setSelected(node.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(node.id);
                    }
                  }}
                >
                  <line x1="160" y1="100" x2={x} y2={y} stroke="#C9CEDB" />
                  <circle
                    cx={x}
                    cy={y}
                    r={9 + Math.min(node.attempts, 8)}
                    fill={node.id === selected ? "#FF5FD2" : "#00E5FF"}
                    stroke="#1B1F3B"
                    strokeWidth="2"
                  />
                  <title>{node.label}</title>
                </g>
              );
            })}
            <circle cx="160" cy="100" r="16" fill="#7B5CFF" />
          </svg>
          <select
            aria-label="Concept"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Choose a concept</option>
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label}
              </option>
            ))}
          </select>
          {active && (
            <div className="inline-learning-detail">
              <strong>{active.label}</strong>
              <div className="inline-learning-metrics">
                <span title="Practice attempts" aria-label={`${active.attempts} practice attempts`}>
                  <Icon name="task" />
                  {active.attempts}
                </span>
                <span title="Accuracy" aria-label="Accuracy">
                  <Icon name="check" />
                  {estimate?.precision == null ? "—" : `${Math.round(estimate.precision * 100)}%`}
                </span>
                <span
                  title="Successful recalls"
                  aria-label={`${active.recalls} successful recalls`}
                >
                  <Icon name="rewind" />
                  {active.recalls}
                </span>
                <span title="Estimated retention" aria-label="Estimated retention">
                  <Icon name="learn" />
                  {estimate?.retention == null ? "—" : `${Math.round(estimate.retention * 100)}%`}
                </span>
              </div>
              <details>
                <summary>
                  <Icon name="notes" />
                  Evidence
                </summary>
                <p>
                  {active.correct} correct · {active.hints} hints · {active.explanations}{" "}
                  explanations
                </p>
                <p>
                  {active.exposures} page exposures · {relativeTime(active.lastSeen)}
                </p>
                {active.evidence.slice(-4).map((item, i) => (
                  <p key={i}>{item}</p>
                ))}
              </details>
            </div>
          )}
        </>
      ) : (
        <Empty title="No concepts yet">
          {enabled ? "Practice on any webpage." : "Turn on learning to keep practice evidence."}
        </Empty>
      )}
    </div>
  );
}
