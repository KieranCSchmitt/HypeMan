import { useEffect, useState } from "react";
import type { Health } from "@core";
import { request } from "../bridge";
import { Notice, Toggle } from "./common";
import { Icon } from "./Icon";
import { ToolHeader, WindowBar } from "./ToolChrome";
import { message, setScreenshotAccess, useSettings } from "./hooks";
import { Pet } from "./Pet";
import { ChatGPTConnection } from "./ChatGPTConnection";
import { ArtSprite } from "./ArtSprite";

export function Onboarding() {
  const { settings, patch } = useSettings();
  const [url, setUrl] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatgptReady, setChatgptReady] = useState(false);
  useEffect(() => setUrl(settings.serverUrl), [settings.serverUrl]);
  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const address = new URL(url);
      if (
        !/^https?:$/.test(address.protocol) ||
        !["localhost", "127.0.0.1", "[::1]"].includes(address.hostname)
      )
        throw new Error("Use localhost, 127.0.0.1, or [::1].");
      await patch({ serverUrl: url });
      setHealth(await request<Health>({ type: "connection.ensure" }));
    } catch (e) {
      setError(message(e));
      setHealth(null);
    } finally {
      setBusy(false);
    }
  };
  const enter = async () => {
    setBusy(true);
    setError("");
    try {
      await patch({ onboarded: true });
      location.href = "newtab.html";
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };
  return (
    <div className="setup-page studio setup-studio">
      <ToolHeader title="Connection" icon="link" />
      <main className="setup-main">
        <div className="setup-intro">
          <span className="eyebrow">HypeMan / CONNECT</span>
          <h1>
            Your internet.
            <br />
            With a sidekick.
          </h1>
          <p>Your ChatGPT. Your sidekick.</p>
          <div className="setup-mascot">
            <div className="setup-orbit" aria-hidden="true" />
            <ArtSprite name="boombox" width={110} className="setup-boombox" />
            <Pet settings={settings} scale={3} />
            <ArtSprite name="sparkle" width={52} className="setup-spark" />
          </div>
          <span className="studio-privacy">
            <Icon name="shield" />
            Your sign-in stays on your machine
          </span>
        </div>
        <div className="setup-content">
          <section className="surface studio-window connection-window">
            <WindowBar title="Connect.exe" icon="link" />
            {!health?.demoMode && (
              <ChatGPTConnection
                connectionKey={settings.serverUrl}
                onConnectionChange={(result) => {
                  setHealth(result);
                  setChatgptReady(false);
                }}
                onStatusChange={(status) =>
                  setChatgptReady(status.connected && status.sharing && !status.error)
                }
                onSignedIn={() => void enter()}
              />
            )}
            {health?.demoMode && (
              <div className="studio-window-body">
                <h2>Your sidekick is ready.</h2>
                <p>Demo mode · No sign-in needed</p>
              </div>
            )}
            {(health || chatgptReady) && (
              <div className="studio-window-body setup-continue">
                <button
                  className={`button ${chatgptReady || health?.demoMode ? "setup-launch" : "setup-explore"}`}
                  disabled={busy}
                  onClick={() => void enter()}
                >
                  {chatgptReady
                    ? "Open HypeMan"
                    : health?.demoMode
                      ? "Explore demo"
                      : health?.capabilities.agent?.mode === "local"
                        ? "Use local model"
                        : "Explore HypeMan"}
                  <Icon name="arrow" />
                </button>
              </div>
            )}
            <div className="studio-window-body setup-advanced">
              <Notice tone="error">{error}</Notice>
              <details className="studio-details">
                <summary>
                  <Icon name="settings" />
                  Advanced
                </summary>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void connect();
                  }}
                >
                  <label className="field">
                    Server address
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="http://localhost:8787"
                      required
                    />
                  </label>
                  <button className="button" disabled={busy}>
                    <Icon name="link" />
                    Reconnect
                  </button>
                </form>
                {health && (
                  <details className="studio-details">
                    <summary>
                      Capabilities
                      <span>
                        {Object.values(health.capabilities).filter((c) => c.available).length} ready
                      </span>
                    </summary>
                    <div className="capability-list">
                      {Object.entries(health.capabilities).map(([key, capability]) => (
                        <div className="capability" key={key}>
                          <span>
                            <strong>{key.replaceAll("_", " ")}</strong>
                            {capability.reason && <small>{capability.reason}</small>}
                          </span>
                          <span
                            className={`capability-state ${capability.available ? "available" : ""}`}
                          >
                            {capability.available ? capability.mode : "Unavailable"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </details>
            </div>
          </section>
          <details className="surface studio-window setup-options">
            <summary>
              <Icon name="shield" />
              <span>Your permissions</span>
              <Icon name="plus" />
            </summary>
            <div className="studio-window-body">
              <Toggle
                label="Screenshots"
                description="Chrome requests optional capture access. Every capture remains explicit."
                checked={settings.screenshotEnabled}
                onChange={(v) =>
                  void setScreenshotAccess(v, patch).catch((e) => setError(message(e)))
                }
              />
              <Toggle
                label="Other tab titles"
                description="Share titles and links from other tabs."
                checked={settings.tabContextEnabled}
                onChange={(v) =>
                  void patch({ tabContextEnabled: v }).catch((e) => setError(message(e)))
                }
              />
              <Toggle
                label="Learning mode"
                description="Keep a local concept graph from practice sessions."
                checked={settings.learningEnabled}
                onChange={(v) =>
                  void patch({ learningEnabled: v }).catch((e) => setError(message(e)))
                }
              />
            </div>
          </details>
          <p className="setup-footer">
            Open any website to meet your companion.{" "}
            <a href="customize.html" title="Customize companion">
              Make it yours <Icon name="external" />
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
