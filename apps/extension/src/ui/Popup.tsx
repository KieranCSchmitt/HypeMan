import { useEffect, useState } from "react";
import { request } from "../bridge";
import { Notice } from "./common";
import { message, openPage, useSettings, useWorkspace } from "./hooks";
import { Pet } from "./Pet";
import { Icon } from "./Icon";
import type { OverlaySection } from "./overlay-sections";

export function Popup() {
  const { settings, patch } = useSettings();
  const { workspace } = useWorkspace();
  const [hostname, setHostname] = useState("");
  const [tabId, setTabId] = useState<number | null>(null);
  const [protectedPage, setProtectedPage] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => {
        setTabId(tab?.id ?? null);
        try {
          const url = new URL(tab?.url || "");
          setHostname(url.hostname);
          setProtectedPage(
            !/^https?:$/.test(url.protocol) || url.hostname === "chromewebstore.google.com",
          );
        } catch {
          setProtectedPage(true);
        }
      })
      .catch((e) => setError(message(e)));
  }, []);
  const paused = settings.hiddenOnHosts.includes(hostname);
  const task = workspace.tasks.find((item) => item.id === workspace.activeTaskId);
  const openSection = async (section: OverlaySection) => {
    try {
      await request({ type: "control.open", section });
      window.close();
    } catch (e) {
      setError(message(e));
    }
  };
  const openCompanion = async () => {
    try {
      if (protectedPage || paused || tabId === null) {
        openPage("newtab");
      } else {
        await chrome.tabs.sendMessage(
          tabId,
          { type: "hypeman.command", name: "open-chat" },
          { frameId: 0 },
        );
      }
      window.close();
    } catch {
      openPage("newtab");
      window.close();
    }
  };
  return (
    <main className="popup studio popup-studio popup-minimal">
      <button
        className="popup-mascot"
        aria-label="Open companion"
        title="Open companion"
        onClick={() => void openCompanion()}
      >
        <Pet settings={settings} scale={1.6} />
      </button>
      <div className="site-control">
        <Icon name={protectedPage ? "shield" : "monitor"} />
        <strong title={hostname}>{protectedPage ? "Open a website" : hostname}</strong>
        {!protectedPage && (
          <button
            className={`icon-button ${paused ? "selected" : ""}`}
            aria-pressed={paused}
            aria-label={paused ? "Show HypeMan on this site" : "Pause HypeMan on this site"}
            title={paused ? "Resume on this site" : "Pause on this site"}
            onClick={() =>
              void patch({
                hiddenOnHosts: paused
                  ? settings.hiddenOnHosts.filter((item) => item !== hostname)
                  : [...settings.hiddenOnHosts, hostname],
              }).catch((e) => setError(message(e)))
            }
          >
            <Icon name={paused ? "play" : "pause"} />
          </button>
        )}
      </div>
      {task && (
        <div className="popup-task">
          <Icon name="task" />
          <p>{task.goal}</p>
          <button
            className="icon-button"
            aria-label="Pause task"
            title="Pause task"
            onClick={() =>
              void request({ type: "task.pause", id: task.id }).catch((e) => setError(message(e)))
            }
          >
            <Icon name="pause" />
          </button>
        </div>
      )}
      <nav className="popup-iconbar" aria-label="Companion shortcuts">
        <button aria-label="Open chat" title="Open chat" onClick={() => void openCompanion()}>
          <Icon name="chat" />
        </button>
        <button aria-label="Tasks" title="Tasks" onClick={() => void openSection("tasks")}>
          <Icon name="task" />
        </button>
        <button aria-label="Notes" title="Notes" onClick={() => void openSection("notes")}>
          <Icon name="notes" />
        </button>
        <button
          aria-label="Whiteboard"
          title="Whiteboard"
          onClick={() => void openSection("board")}
        >
          <Icon name="sketch" />
        </button>
      </nav>
      <details className="popup-extras">
        <summary aria-label="More tools" title="More tools">
          <Icon name="plus" />
        </summary>
        <nav className="popup-iconbar" aria-label="Specialist tools">
          <button
            aria-label="Video"
            title="Video"
            onClick={() => void openSection("video")}
          >
            <Icon name="video" />
          </button>
          <button
            aria-label="Notebook camera"
            title="Notebook camera"
            onClick={() => void openSection("notebook")}
          >
            <Icon name="camera" />
          </button>
          <button
            aria-label="Customize companion"
            title="Customize companion"
            onClick={() => void openSection("customize")}
          >
            <Icon name="customize" />
          </button>
          <button
            aria-label="Learning"
            title="Learning"
            onClick={() => void openSection("learning")}
          >
            <Icon name="learn" />
          </button>
          <button aria-label="Preferences" title="Preferences" onClick={() => void openSection("settings")}><Icon name="settings" /></button>
        </nav>
      </details>
      <Notice tone="error">{error}</Notice>
    </main>
  );
}
