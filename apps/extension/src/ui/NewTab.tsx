import { useEffect, useRef, useState } from "react";
import { wallpaperSearch } from "../art/wallpaper-layout";
import { ConversationWorkbench } from "./ConversationWorkbench";
import { Rooftop } from "./Rooftop";
import { Pet } from "./Pet";
import { Icon } from "./Icon";
import { SkinPicker } from "./SkinPicker";
import { useSettings, useReducedMotion } from "./hooks";
import { useAvatarAnimation, type AvatarActivity } from "./useAvatarAnimation";

/** A quiet rooftop. Work starts only when the avatar or an explicit continuation opens chat. */
export function NewTab({ initialTool }: { initialTool?: string }) {
  const search = useRef<HTMLFormElement>(null);
  const { settings, patch } = useSettings();
  const reduced = useReducedMotion(settings.reducedMotion);
  const explicit = !!initialTool || !!location.hash || new URLSearchParams(location.search).has("conversationId");
  const [open, setOpen] = useState(explicit), [mounted, setMounted] = useState(explicit);
  const [activity, setActivity] = useState<AvatarActivity>({ phase: "idle" });
  const avatar = useAvatarAnimation({ activity, open });
  const close = () => { window.dispatchEvent(new Event("hypeman.close-conversation")); setOpen(false); };
  const reveal = () => { setMounted(true); setOpen(true); };
  useEffect(() => {
    const continuation = () => { if (location.hash) reveal(); };
    window.addEventListener("hashchange", continuation);
    return () => window.removeEventListener("hashchange", continuation);
  }, []);
  return <div className="newtab-page conversational-desktop" data-reduced-motion={reduced}>
    <SkinPicker settings={settings} onSelect={avatarSkin => patch({ avatarSkin })} />
    {!initialTool && <form ref={search} className="newtab-web-search" role="search" aria-label="Web search" action="https://www.google.com/search" method="get">
      <Icon name="search" />
      <input type="search" name="q" aria-label="Search the web" placeholder="Search the web" autoComplete="off" required />
    </form>}
    {mounted && <div className="conversational-companion"><main id="newtab-companion-chat" aria-label="HypeMan avatar conversation" hidden={!open} className="companion-workbench-host">
      <ConversationWorkbench initialTool={initialTool} chatOpen={open} onRestoreChatOpen={() => open} onAvatarActivity={setActivity} onClose={close} />
    </main></div>}
    <Rooftop reduced={reduced} skin={settings.avatarSkin} activity={avatar.state} animationKey={avatar.animationKey}
      onLayout={(viewport) => {
        if (!search.current) return;
        const rect = wallpaperSearch(innerWidth, innerHeight, viewport);
        Object.assign(search.current.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px`, transform: "none", boxSizing: "border-box" });
      }}
      onCompanion={() => { if (open) close(); else reveal(); }} />
    <button type="button" className="pet-handle newtab-avatar-icon" aria-label={`${open ? "Close" : "Open"} HypeMan chat`}
      aria-expanded={open} aria-controls={mounted ? "newtab-companion-chat" : undefined} onClick={() => { if (open) close(); else reveal(); }}>
      <Pet settings={settings} {...avatar} scale={1.5} /><span className="pet-shadow" />
    </button>
  </div>;
}
