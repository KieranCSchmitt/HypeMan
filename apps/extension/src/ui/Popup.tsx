import { useEffect, useState } from "react";
import { Notice } from "./common";
import { message, useSettings } from "./hooks";
import { Pet } from "./Pet";
export function Popup() {
  const { settings } = useSettings();
  const [error, setError] = useState("");
  const open = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id && /^https?:/.test(tab.url || "") && !settings.hiddenOnHosts.includes(new URL(tab.url!).hostname)) {
        await chrome.tabs.sendMessage(tab.id, { type: "hypeman.command", name: "open-chat" }, { frameId: 0 });
      } else await chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html#chat") });
      window.close();
    } catch {
      try { await chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html#chat") }); window.close(); }
      catch (cause) { setError(message(cause)); }
    }
  };
  useEffect(() => { void open(); }, []);
  return <main className="popup studio popup-minimal"><button className="popup-mascot" aria-label="Open HypeMan conversation" title="Open HypeMan" onClick={() => void open()}><Pet settings={settings} scale={1.6} /></button><span className="tool-status" role="status">Opening…</span><Notice tone="error">{error}</Notice></main>;
}
