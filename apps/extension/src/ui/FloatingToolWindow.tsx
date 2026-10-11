import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Icon } from "./Icon";
import { overlaySections, type OverlaySection } from "./overlay-sections";
import { clampWindow, initialWindow, nextWindowLayer, resizeWindow, windowViewport, type WindowRect } from "./window-layout";

export function FloatingToolWindow({ section, open, focused, cascade, onFocus, onClose, children }: {
  section: OverlaySection; open: boolean; focused: boolean; cascade: number;
  onFocus: (section: OverlaySection) => void; onClose: (section: OverlaySection) => void; children: ReactNode;
}) {
  const host = useRef<HTMLElement>(null), initialized = useRef(false);
  const [rect, setRect] = useState(() => initialWindow(section, windowViewport()));
  const [layer, setLayer] = useState(nextWindowLayer);
  const geometry = useRef(rect); geometry.current = rect;
  const callbacks = useRef({ onFocus, onClose }); callbacks.current = { onFocus, onClose };
  const gesture = useRef<{ pointerId: number; x: number; y: number; rect: WindowRect; resize: boolean } | null>(null);
  const focus = () => { setLayer(nextWindowLayer()); callbacks.current.onFocus(section); };
  useLayoutEffect(() => {
    if (!open || initialized.current) return;
    const root = host.current?.getRootNode() as Document | ShadowRoot | undefined;
    const chat = root?.querySelector(".conversation-pane")?.getBoundingClientRect();
    setRect(initialWindow(section, windowViewport(), chat, cascade)); initialized.current = true;
  }, [open, section, cascade]);
  useEffect(() => { if (open && focused) setLayer(nextWindowLayer()); }, [open, focused]);
  useEffect(() => {
    const resize = () => setRect((current) => clampWindow(current, windowViewport()));
    window.addEventListener("resize", resize); window.visualViewport?.addEventListener("resize", resize); window.visualViewport?.addEventListener("scroll", resize);
    return () => { window.removeEventListener("resize", resize); window.visualViewport?.removeEventListener("resize", resize); window.visualViewport?.removeEventListener("scroll", resize); };
  }, []);
  useEffect(() => { if (!open) gesture.current = null; }, [open]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Pointer events inside a trusted iframe do not bubble through its parent window.
    const childFocus = () => { timer = setTimeout(() => {
      const root = host.current?.getRootNode() as Document | ShadowRoot | undefined;
      if (open && root?.activeElement?.tagName === "IFRAME" && host.current?.contains(root.activeElement)) focus();
    }, 0); };
    window.addEventListener("blur", childFocus); return () => { clearTimeout(timer); window.removeEventListener("blur", childFocus); };
  }, [open, section]);
  const start = (event: PointerEvent<HTMLElement>, resizing = false) => {
    if (event.button !== 0 || event.isPrimary === false || gesture.current || (!resizing && (event.target as Element).closest("button,a,input,textarea,select,[contenteditable]"))) return;
    focus(); event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, rect: geometry.current, resize: resizing };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* A disposed pointer cannot begin a drag. */ }
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current; if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    setRect(current.resize ? resizeWindow(current.rect, current.rect.width + dx, current.rect.height + dy, windowViewport()) :
      clampWindow({ ...current.rect, x: current.rect.x + dx, y: current.rect.y + dy }, windowViewport()));
  };
  const finish = (event: PointerEvent<HTMLElement>) => {
    if (gesture.current?.pointerId !== event.pointerId) return;
    gesture.current = null;
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* The browser already released capture. */ }
  };
  const key = (event: KeyboardEvent<HTMLElement>, resizing = false) => {
    if (event.target !== event.currentTarget) return;
    const step = event.shiftKey ? 50 : 10, delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!delta[event.key]) return;
    event.preventDefault(); event.stopPropagation(); focus(); const [x, y] = delta[event.key];
    setRect((current) => resizing ? resizeWindow(current, current.width + x, current.height + y, windowViewport()) : clampWindow({ ...current, x: current.x + x, y: current.y + y }, windowViewport()));
  };
  const title = overlaySections[section].title, help = `tool-window-help-${section}`;
  return <section ref={host} hidden={!open} className={`pixel-workspace workspace-${section}`} role="region" aria-label={title} data-window-tool={section}
    onPointerDownCapture={focus} onFocusCapture={focus} style={{ position: "fixed", transform: "none", left: rect.x, top: rect.y, width: rect.width, height: rect.height, maxWidth: "none", maxHeight: "none", zIndex: layer, boxSizing: "border-box" }}>
    <header className="pixel-workspace-bar" tabIndex={0} aria-label={`Move ${title} window`} aria-describedby={help} aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
      onKeyDown={(event) => key(event)} onPointerDown={(event) => start(event)} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { gesture.current = null; }}>
      <span><Icon name={overlaySections[section].icon} /><strong>{title}</strong></span><span className="pixel-window-grip" aria-hidden="true" />
      <button data-essential="close" type="button" className="pixel-window-close" aria-label={`Close ${title} window`} onClick={() => callbacks.current.onClose(section)}><Icon name="close" /></button>
    </header>
    <span id={help} className="sr-only">Arrow keys move this window. Hold Shift for larger steps. Use the corner grip to resize.</span>
    <div className="pixel-workspace-content">{children}</div>
    <div className="pixel-window-resize" role="group" tabIndex={0} aria-label={`Resize ${title} window`} aria-describedby={help} aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
      style={{ position: "absolute", right: 0, bottom: 0, width: 18, height: 18, cursor: "nwse-resize", touchAction: "none" }}
      onKeyDown={(event) => key(event, true)} onPointerDown={(event) => start(event, true)} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { gesture.current = null; }} />
  </section>;
}
