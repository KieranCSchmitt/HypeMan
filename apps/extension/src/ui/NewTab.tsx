import { useEffect, useState } from "react";
import { ConversationWorkbench } from "./ConversationWorkbench";
import { Rooftop } from "./Rooftop";
import { Pet } from "./Pet";
import { Icon } from "./Icon";
import { useSettings, useReducedMotion } from "./hooks";

/** A quiet rooftop. Work starts only when the avatar or an explicit continuation opens chat. */
export function NewTab({ initialTool }: { initialTool?: string } = {}) {
  const { settings } = useSettings();
  const reduced = useReducedMotion(settings.reducedMotion);
  const explicit = !!initialTool || !!location.hash || new URLSearchParams(location.search).has("conversationId");
  const [open, setOpen] = useState(explicit), [mounted, setMounted] = useState(explicit);
  const [busy, setBusy] = useState(false);
  const close = () => { window.dispatchEvent(new Event("hypeman.close-conversation")); setOpen(false); };
  const reveal = () => { setMounted(true); setOpen(true); };
  useEffect(() => {
    const continuation = () => { if (location.hash) reveal(); };
    window.addEventListener("hashchange", continuation);
    return () => window.removeEventListener("hashchange", continuation);
  }, []);
  return <div className="newtab-page conversational-desktop" data-reduced-motion={reduced}>
    {!initialTool && <form className="newtab-web-search" role="search" aria-label="Web search" action="https://www.google.com/search" method="get">
      <Icon name="search" />
      <input type="search" name="q" aria-label="Search the web" placeholder="Search the web" autoComplete="off" required />
    </form>}
    {mounted && <div className="conversational-companion"><main id="newtab-companion-chat" aria-label="HypeMan avatar conversation" hidden={!open} className="companion-workbench-host">
      <ConversationWorkbench initialTool={initialTool} onActivity={setBusy} onClose={close} />
    </main></div>}
    <Rooftop reduced={reduced} activity={busy && open ? "thinking" : "idle"}
      onCompanion={() => { if (open) close(); else reveal(); }} />
    <button type="button" className="pet-handle newtab-avatar-icon" aria-label={`${open ? "Close" : "Open"} HypeMan chat`}
      aria-expanded={open} aria-controls={mounted ? "newtab-companion-chat" : undefined} onClick={() => { if (open) close(); else reveal(); }}>
      <Pet settings={settings} state={busy && open ? "thinking" : "idle"} scale={1.5} /><span className="pet-shadow" />
    </button>
  </div>;
}
