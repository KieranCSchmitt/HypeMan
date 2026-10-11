import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatGPTStatus, Health } from "@core";
import { request } from "../bridge";
import { Notice, ToolButton } from "./common";
import { message, useSettings } from "./hooks";
import { useToolHandler } from "./WorkbenchContext";
import { Icon } from "./Icon";

export function ChatGPTConnection({
  connectionKey,
  onStatusChange,
  onConnectionChange,
  onSignedIn,
}: {
  connectionKey: string;
  onStatusChange?: (status: ChatGPTStatus) => void;
  onConnectionChange?: (health: Health | null) => void;
  onSignedIn?: () => void;
}) {
  const [status, setStatus] = useState<ChatGPTStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { settings, patch } = useSettings();
  const [loginChoice, setLoginChoice] = useState<Record<string, unknown> | null>(null);
  const callbacks = useRef({ onStatusChange, onConnectionChange, onSignedIn });
  callbacks.current = { onStatusChange, onConnectionChange, onSignedIn };
  const signingIn = useRef(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const next = await request<ChatGPTStatus>({ type: "chatgpt.status" }, signal);
    setStatus(next);
    setError("");
    return next;
  }, []);

  useEffect(() => {
    setStatus(null);
    setError("");
    signingIn.current = false;
    callbacks.current.onConnectionChange?.(null);
    const controller = new AbortController();
    void request<Health>({ type: "connection.ensure" }, controller.signal)
      .then((health) => {
        if (controller.signal.aborted) return;
        callbacks.current.onConnectionChange?.(health);
        return refresh(controller.signal);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [connectionKey, refresh]);

  useEffect(() => {
    if (!status) return;
    callbacks.current.onStatusChange?.(status);
    if (
      signingIn.current &&
      status.connected &&
      status.sharing &&
      !status.pending &&
      !status.error
    ) {
      signingIn.current = false;
      callbacks.current.onSignedIn?.();
    }
  }, [status?.connected, status?.sharing, status?.pending, status?.activeProfileId, status?.error]);

  useEffect(() => {
    if (!status?.pending) return;
    const controller = new AbortController();
    let polling = false;
    const poll = async () => {
      if (document.visibilityState !== "visible" || polling) return;
      polling = true;
      try {
        await refresh(controller.signal);
      } catch (e) {
        if (!controller.signal.aborted) setError(message(e));
      } finally {
        polling = false;
      }
    };
    const timer = setInterval(() => void poll(), 1500);
    const visible = () => void poll();
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      controller.abort();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [status?.pending, refresh]);

  const act = async (type: string, values: Record<string, unknown> = {}) => {
    setBusy(true);
    setError("");
    if (type === "chatgpt.login") signingIn.current = true;
    if (type === "chatgpt.cancel") signingIn.current = false;
    try {
      if (type !== "chatgpt.status") await request({ type, ...values });
      await refresh();
    } catch (e) {
      signingIn.current = false;
      if (type !== "chatgpt.status") await refresh().catch(() => {});
      setError(message(e));
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const active = status?.profiles.find((profile) => profile.id === status.activeProfileId);
  const labels =
    status?.profiles.map((profile) =>
      profile.email ? `${profile.label} · ${profile.email}` : profile.label,
    ) ?? [];
  const pending = status?.pending ?? false;
  const connected = status?.sharing && !status.error;

  useToolHandler("connection", async (operation, args) => {
    if (operation === "open" || operation === "status") { const current = await refresh(); return current.sharing ? "ChatGPT is connected." : "Use Continue with ChatGPT to finish sign-in."; }
    if (operation === "login") { setLoginChoice({ ...(args.newProfile ? { newProfile: true } : {}), ...(args.profileId ? { profileId: args.profileId } : {}) }); return "Use Continue with ChatGPT below to open sign-in."; }
    if (operation === "cancel" || operation === "logout") { await act(`chatgpt.${operation}`); setLoginChoice(null); return operation === "cancel" ? "Sign-in cancelled." : "Signed out."; }
    if (operation === "account") {
      const choice = String(args.profileId || args.id || args.account || "");
      const profile = status?.profiles.find((item) => item.id === choice || item.email === choice || item.label === choice);
      if (!profile) throw new Error("Choose one of the saved accounts shown below.");
      await act("chatgpt.select", { profileId: profile.id }); return "Account selected.";
    }
    if (operation === "model") {
      const choice = String(args.model || args.id || args.name || "");
      const model = status?.models?.find((item) => item.slug === choice || item.displayName === choice);
      if (!model) throw new Error("Choose one of the available models shown below.");
      await act("chatgpt.model", { model: model.slug }); return "Model selected.";
    }
    if (operation === "reconnect") {
      const address = String(args.url || args.serverUrl || settings.serverUrl);
      const target = new URL(address);
      if (!/^https?:$/.test(target.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) throw new Error("Use a local server address: localhost, 127.0.0.1, or [::1].");
      await patch({ serverUrl: target.origin });
      await request({ type: "connection.ensure" }); await refresh(); return "Connection refreshed.";
    }
    if (operation === "usage") { await chrome.tabs.create({ url: "https://chatgpt.com/settings/usage" }); return "Opened ChatGPT usage."; }
    throw new Error("That connection action is unavailable.");
  });
  return <div className="studio-window-body chatgpt-connection" aria-busy={busy}>
    <div className="tool-toolbar connection-state"><span className={`connection-dot ${connected ? "connected" : ""}`} aria-hidden="true" /><span role="status">{pending ? "Signing in…" : connected ? "Connected" : "Disconnected"}</span><ToolButton icon="rewind" label="Refresh connection" disabled={busy} onClick={() => void act("chatgpt.status").catch(() => {})} /></div>
    {status?.connected && !connected && <p className="tool-status">Reconnect your account.</p>}
    {pending ? <div className="tool-actions"><span className="tool-status">Finish sign-in in the opened tab.</span><button className="button" disabled={busy} onClick={() => void act("chatgpt.cancel").catch(() => {})}>Cancel</button></div> : (!connected || loginChoice) && <button data-essential="sign-in" className="button primary chatgpt-signin" disabled={busy} onClick={() => void act("chatgpt.login", loginChoice || (status?.activeProfileId ? { profileId: status.activeProfileId } : {})).then(() => setLoginChoice(null)).catch(() => {})}><Icon name="external" />{busy ? "Opening…" : "Continue with ChatGPT"}</button>}
    <Notice tone="error">{error || status?.error}</Notice><Notice>{status?.warning}</Notice>
    {!!status?.profiles.length && <div className="chatgpt-account-options">
      <label className="field">Account<select aria-label="ChatGPT account" value={status.activeProfileId || ""} disabled={busy || pending} onChange={(event) => void act("chatgpt.select", { profileId: event.target.value }).catch(() => {})}>{!status.activeProfileId && <option value="" disabled>Choose a saved account</option>}{status.profiles.map((profile, index) => <option key={profile.id} value={profile.id}>{labels[index]}{labels.filter((label) => label === labels[index]).length > 1 ? ` (${index + 1})` : ""}{profile.connected ? "" : " · reconnect"}</option>)}</select></label>
      {status.sharing && !!status.models?.length && <label className="field">Model<select aria-label="ChatGPT model" value={status.model || status.models[0]!.slug} disabled={busy || pending} onChange={(event) => void act("chatgpt.model", { model: event.target.value }).catch(() => {})}>{status.models.map((model) => <option key={model.slug} value={model.slug}>{model.displayName}</option>)}</select></label>}
      <div className="tool-toolbar"><ToolButton icon="plus" label="Add account" disabled={busy || pending} onClick={() => setLoginChoice({ newProfile: true })} /><ToolButton icon="activity" label="View usage" onClick={() => void chrome.tabs.create({ url: "https://chatgpt.com/settings/usage" }).catch((cause) => setError(message(cause)))} />{connected && <button className="button" disabled={busy || pending} onClick={() => void act("chatgpt.logout").catch(() => {})}>Disconnect</button>}</div>
    </div>}
    <details className="connection-advanced"><summary>Advanced</summary><label className="field">Local server<input aria-label="Local server address" type="url" defaultValue={settings.serverUrl} key={settings.serverUrl} onBlur={(event) => {
      try { const target = new URL(event.target.value); if (!/^https?:$/.test(target.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) throw new Error("Use a localhost address."); void patch({ serverUrl: target.origin }).catch((cause) => setError(message(cause))); }
      catch (cause) { setError(message(cause)); }
    }} /></label><span className="tool-status" title="Using your ChatGPT plan">{active?.email || active?.label || "Local connection"}</span></details>
  </div>;
}
