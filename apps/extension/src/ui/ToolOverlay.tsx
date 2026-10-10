import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { Board } from "./Board";
import { Video } from "./Video";
import { Customize } from "./Customize";
import { CompanionTools, type CompanionSection } from "./CompanionTools";
import { Icon } from "./Icon";
import { overlaySections, type OverlaySection } from "./overlay-sections";

/** Tools share a window, never another browser tab. Hidden studios keep unfinished work. */
export function ToolOverlay({ section, onClose, onOpen, onError, onStartTask, videoContent, learningContent, boardContent, notesActions }: {
  section: OverlaySection | null;
  onClose: () => void;
  onOpen: (section: OverlaySection) => void;
  onError?: (message: string) => void;
  onStartTask?: () => void;
  videoContent?: ReactNode;
  learningContent?: ReactNode;
  boardContent?: ReactNode;
  notesActions?: ReactNode;
}) {
  const windowRef = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const [studios, setStudios] = useState<Set<string>>(new Set());
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  useEffect(() => {
    if (!section) return;
    setStudios((current) => new Set([...current, section]));
    const root = windowRef.current?.getRootNode() as Document | ShadowRoot;
    previous.current = root?.activeElement as HTMLElement;
    close.current?.focus();
    return () => { if (previous.current?.isConnected) previous.current.focus(); };
  }, [section]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== chrome.runtime.getURL("").replace(/\/$/, "")) return;
      const frame = windowRef.current?.querySelector<HTMLIFrameElement>("iframe");
      if (!frame || event.source !== frame.contentWindow) return;
      if (event.data?.type === "hypeman.close-overlay") onClose();
      else if (event.data?.type === "hypeman.open-overlay" && ["customize", "connection"].includes(event.data.section)) onOpen(event.data.section);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [onClose, onOpen]);
  const down = (event: PointerEvent<HTMLElement>) => {
    if ((event.target as Element).closest("button")) return;
    drag.current = { x: event.clientX, y: event.clientY, px: offset.x, py: offset.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    const bounds = windowRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const x = drag.current.px + event.clientX - drag.current.x;
    const y = drag.current.py + event.clientY - drag.current.y;
    setOffset({
      x: Math.max(-(innerWidth - bounds.width) / 2, Math.min((innerWidth - bounds.width) / 2, x)),
      y: Math.max(-16, Math.min(innerHeight - 92, y)),
    });
  };
  const active = section ? overlaySections[section] : null;
  const framedSettings = section === "settings" && location.protocol !== "chrome-extension:";
  const collection = section && !framedSettings && ["tasks", "notes", "settings", "learning", "activity"].includes(section);
  return (
    <section ref={windowRef} hidden={!section} className={`pixel-workspace workspace-${section || "closed"}`}
      role="dialog" aria-modal="false" aria-label={active?.title || "HypeMan tool"}
      style={{ "--workspace-x": `${offset.x}px`, "--workspace-y": `${offset.y}px` } as CSSProperties}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex='0']"))
          .filter((element) => element.getClientRects().length);
        const focused = (event.currentTarget.getRootNode() as Document | ShadowRoot).activeElement;
        if (event.shiftKey && focused === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && focused === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
      }}>
      <header className="pixel-workspace-bar" onPointerDown={down} onPointerMove={move}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <span><Icon name={active?.icon || "spark"} /><strong>{active?.title}</strong></span>
        <i className="pixel-window-grip" aria-hidden="true" />
        <button ref={close} type="button" className="pixel-window-close" aria-label="Close tools" title="Close" onClick={onClose}><Icon name="close" /></button>
      </header>
      <div className="pixel-workspace-content">
        {section === "notes" && <div className="workspace-note-actions">{notesActions}</div>}
        {section === "learning" && learningContent}
        {collection && <CompanionTools embedded section={section as CompanionSection} onClose={onClose}
          onError={onError} onStartTask={onStartTask} onOpenTool={onOpen} />}
        {framedSettings && <iframe className="workspace-preferences-frame" title="Preferences" src={chrome.runtime.getURL("preferences.html")} />}
        {studios.has("board") && <div hidden={section !== "board"}>{boardContent}<Board embedded active={section === "board"} /></div>}
        {studios.has("video") && <div hidden={section !== "video"}>{videoContent || <Video embedded active={section === "video"} />}</div>}
        {studios.has("customize") && <div hidden={section !== "customize"}><Customize embedded active={section === "customize"} /></div>}
        {section === "notebook" && <iframe className="workspace-capture-frame" title="Paper camera"
          src={`${chrome.runtime.getURL("capture.html")}?${new URLSearchParams({ source: location.href, title: document.title })}`} allow="camera" />}
        {section === "connection" && <iframe className="workspace-connection-frame" title="ChatGPT connection"
          src={chrome.runtime.getURL("connection.html")} />}
      </div>
    </section>
  );
}
