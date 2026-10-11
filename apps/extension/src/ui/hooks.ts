import { useCallback, useEffect, useState } from "react";
import { DEFAULT_SETTINGS, emptyWorkspace, type Settings, type WorkspaceSnapshot } from "@core";
import { readSettings, request, subscribe, writeSettings } from "../bridge";

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>(emptyWorkspace);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      setWorkspace(await request<WorkspaceSnapshot>({ type: "workspace.get" }));
      setError("");
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const remove = subscribe((event) => {
      if (
        event.type.includes("workspace") ||
        event.type.includes("task") ||
        event.type.includes("note")
      )
        void refresh();
    });
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes["hypeman.workspace"]) void refresh();
    };
    chrome.storage.onChanged.addListener(changed);
    return () => {
      remove();
      chrome.storage.onChanged.removeListener(changed);
    };
  }, [refresh]);
  return { workspace, loading, error, refresh };
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [error, setError] = useState("");
  useEffect(() => {
    void readSettings()
      .then(setSettings)
      .catch((e) => setError(message(e)));
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes["hypeman.settings"]) void readSettings().then(setSettings);
    };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, []);
  const patch = async (changes: Partial<Settings>) => {
    try {
      const next = await writeSettings(changes);
      setSettings(next);
      setError("");
      return next;
    } catch (e) {
      setError(message(e));
      throw e;
    }
  };
  return { settings, patch, error };
}

export function useReducedMotion(setting: Settings["reducedMotion"] = "auto") {
  const [system, setSystem] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setSystem(preference.matches);
    preference.addEventListener("change", changed);
    changed();
    return () => preference.removeEventListener("change", changed);
  }, []);
  return setting === "on" || (setting === "auto" && system);
}

export const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
export function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Saved source";
  }
}
export function relativeTime(at: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
export function openPage(page: string) {
  if (["board", "video", "documents", "notes", "settings", "tasks"].includes(page)) {
    void request({ type: "control.open", section: page });
    return;
  }
  void chrome.tabs.create({ url: chrome.runtime.getURL(`${page}.html`) });
}
/** Call directly from a click/change handler so Chrome can show its permission prompt. */
export async function setScreenshotAccess(
  enabled: boolean,
  patch: (changes: Partial<Settings>) => Promise<Settings>,
) {
  if (enabled && !(await chrome.permissions.request({ origins: ["<all_urls>"] })))
    throw new Error("Screenshot access was not granted. You can keep using text assistance.");
  return patch({ screenshotEnabled: enabled });
}
export function exportWorkspace(workspace: WorkspaceSnapshot) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(workspace, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `hypeman-workspace-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
