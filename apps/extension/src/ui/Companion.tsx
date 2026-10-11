import { useEffect, useRef, useState } from "react";
import type { CompanionRuntime } from "../runtime/types";
import { subscribe } from "../bridge";
import { ConversationWorkbench } from "./ConversationWorkbench";
import { Pet } from "./Pet";
export function Companion({ runtime }: { runtime: CompanionRuntime }) {
  const [snapshot, setSnapshot] = useState(() => runtime.getSnapshot());
  const [open, setOpen] = useState(false);
  const [dismissedHint, setDismissedHint] = useState("");
  const [position, setPosition] = useState({ x: 20, y: 18 });
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const toggle = () => { if (open) window.dispatchEvent(new Event("hypeman.close-conversation")); setOpen(!open); };
  useEffect(() => runtime.subscribe(() => setSnapshot(runtime.getSnapshot())), [runtime]);
  useEffect(() => subscribe((event) => {
    if (event.type === "command") {
      if (event.name === "toggle-companion") toggle();
      else if (event.name === "open-chat" || event.name === "open-tools") setOpen(true);
    }
    if (event.type === "ask.selection" || event.type === "assistant.run") setOpen(true);
  }), [open]);
  useEffect(() => { if (snapshot.confirmation || snapshot.sketch) setOpen(true); }, [snapshot.confirmation, snapshot.sketch]);
  if (snapshot.settings.hiddenOnHosts.includes(location.hostname.toLowerCase())) return null;
  return <div className="companion-root conversational-companion" style={{ right: position.x, bottom: position.y }}>
    <div hidden={!open} className="companion-workbench-host"><ConversationWorkbench runtime={runtime} onClose={() => { window.dispatchEvent(new Event("hypeman.cancel-tools")); setOpen(false); }} /></div>
    {!open && snapshot.learning.autoHint && dismissedHint !== snapshot.learning.autoHint.id && <div className="pet-hint-preview" role="status" tabIndex={0}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => setOpen(true)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setOpen(true); if (event.key === "Escape") { event.stopPropagation(); setDismissedHint(snapshot.learning.autoHint!.id); } }}>
      {snapshot.learning.autoHint.text.slice(0, 280)}
    </div>}
    <button className="pet-handle" aria-label={`${open ? "Close" : "Open"} HypeMan. Drag to move.`} aria-expanded={open}
      onPointerDown={(event) => { drag.current = { x: event.clientX, y: event.clientY, px: position.x, py: position.y, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => { const d = drag.current; if (!d) return; const dx = d.x - event.clientX, dy = d.y - event.clientY; if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true; if (d.moved) setPosition({ x: Math.max(8, Math.min(innerWidth - 100, d.px + dx)), y: Math.max(8, Math.min(innerHeight - 100, d.py + dy)) }); }}
      onPointerUp={() => { if (!drag.current?.moved) toggle(); drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onClick={(event) => { if (event.detail === 0) toggle(); }}>
      <Pet settings={snapshot.settings} state={snapshot.phase === "thinking" || snapshot.phase === "acting" ? "thinking" : snapshot.phase === "error" ? "confused" : "idle"} scale={1.5} /><span className="pet-shadow" />
    </button>
  </div>;
}
