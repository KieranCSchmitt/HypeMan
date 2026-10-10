import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatGPTStatus, Health } from "@core";
import { request } from "../bridge";
import { Notice } from "./common";
import { message } from "./hooks";
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

  return (
    <div className="studio-window-body chatgpt-connection" aria-busy={busy}>
      <h2>{connected ? "ChatGPT connected" : "Your ChatGPT. Your HypeMan."}</h2>
      {!connected && <p>Your plan. One sign-in.</p>}
      {connected && (
        <Notice tone="success">
          Using ChatGPT plan{active ? ` · ${active.email || active.label}` : ""}
        </Notice>
      )}
      {status?.connected && (!status.sharing || status.error) && (
        <p role="status">
          Signed in{active ? ` as ${active.email || active.label}` : ""}. ChatGPT access needs
          attention.
        </p>
      )}
      {pending ? (
        <>
          <p role="status">Finish sign-in in the opened tab.</p>
          <button className="button" disabled={busy} onClick={() => void act("chatgpt.cancel")}>
            Cancel sign-in
          </button>
        </>
      ) : (
        !connected && (
          <button
            className="button primary chatgpt-signin"
            disabled={busy}
            onClick={() =>
              void act(
                "chatgpt.login",
                status?.activeProfileId ? { profileId: status.activeProfileId } : {},
              )
            }
          >
            <Icon name="external" />
            {busy ? "Opening ChatGPT…" : "Continue with ChatGPT"}
          </button>
        )
      )}
      <Notice tone="error">{error || status?.error}</Notice>
      <Notice>{status?.warning}</Notice>
      {!!status?.profiles.length && (
        <details className="studio-details chatgpt-account-options">
          <summary>
            <Icon name="settings" /> Account settings
          </summary>
          <label className="field">
            ChatGPT account
            <select
              aria-label="ChatGPT account"
              value={status.activeProfileId ?? ""}
              disabled={busy || pending}
              onChange={(event) => void act("chatgpt.select", { profileId: event.target.value })}
            >
              {!status.activeProfileId && (
                <option value="" disabled>
                  Choose a saved account
                </option>
              )}
              {status.profiles.map((profile, index) => (
                <option key={profile.id} value={profile.id}>
                  {labels[index]}
                  {labels.filter((label) => label === labels[index]).length > 1
                    ? ` (${index + 1})`
                    : ""}
                  {profile.connected ? "" : " · Reconnect"}
                </option>
              ))}
            </select>
          </label>
          {status?.sharing && !!status.models?.length && (
            <label className="field">
              ChatGPT model
              <select
                aria-label="ChatGPT model"
                value={status.model ?? status.models[0]!.slug}
                disabled={busy || pending}
                onChange={(event) => void act("chatgpt.model", { model: event.target.value })}
              >
                {status.models.map((model) => (
                  <option key={model.slug} value={model.slug}>
                    {model.displayName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {!!status?.profiles.length && (
              <button
                className="button"
                disabled={busy || pending}
                onClick={() => void act("chatgpt.login", { newProfile: true })}
              >
                <Icon name="plus" />
                Add account
              </button>
            )}
            {status?.activeProfileId && (
              <button
                className="button"
                disabled={busy || pending}
                onClick={() => void act("chatgpt.logout")}
              >
                Sign out
              </button>
            )}
          </div>
          <p className="muted">
            <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">
              Manage usage <Icon name="external" />
            </a>
          </p>
        </details>
      )}
    </div>
  );
}
