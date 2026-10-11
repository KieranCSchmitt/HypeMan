import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { WindowGeometrySnapshot, WorkbenchWindowId } from "@core";
import { clampWindow, maximizedWindow, nextWindowLayer, resizeEdges, resizeWindowEdge, windowViewport, type ResizeEdge, type WindowRect, type WindowSize, type WindowViewport } from "./window-layout";
import { isOverlaySection } from "./overlay-sections";
import { useWindowGeometryPersistence, type WindowGeometryPersistence } from "./WindowGeometryPersistence";

const fallbackCollapsedHeight = 46;
const sameRect = (left: WindowRect, right: WindowRect) => left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
const snapshotKey = ({ rect, minimized, maximized, restoreRect, userResized }: WindowGeometrySnapshot) => JSON.stringify([
  rect.x, rect.y, rect.width, rect.height, minimized, maximized,
  restoreRect && [restoreRect.x, restoreRect.y, restoreRect.width, restoreRect.height], userResized,
]);
type Gesture = { pointerId: number; x: number; y: number; rect: WindowRect; userResized: boolean; edge?: ResizeEdge; target: HTMLElement };
interface WindowGeometryOptions {
  id: string;
  open?: boolean;
  minSize?: WindowSize;
  initialRect: (viewport: WindowViewport, host: HTMLElement | null) => WindowRect;
  preferredHeight?: number;
  onFocus?: () => void;
  persistence?: WindowGeometryPersistence;
}

export function useWindowGeometry({ id, open = true, minSize = { width: 320, height: 220 }, initialRect, preferredHeight, onFocus, persistence: suppliedPersistence }: WindowGeometryOptions) {
  const contextPersistence = useWindowGeometryPersistence(), persistence = suppliedPersistence || contextPersistence;
  const persistenceKey = `${persistence?.conversationId || "local"}:${id}`, ready = persistence?.ready ?? true;
  const activePersistenceKey = useRef(persistenceKey); activePersistenceKey.current = persistenceKey;
  const geometryRevision = useRef(0);
  const hostRef = useRef<HTMLElement>(null);
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  const options = useRef({ minSize, initialRect, onFocus }); options.current = { minSize, initialRect, onFocus };
  const [rect, setRect] = useState(() => clampWindow(initialRect(windowViewport(), null), windowViewport(), minSize));
  const [layer, setLayer] = useState(nextWindowLayer);
  const [minimized, setMinimized] = useState(false), [maximized, setMaximized] = useState(false);
  const [collapsedHeight, setCollapsedHeight] = useState(fallbackCollapsedHeight);
  const [interacting, setInteracting] = useState(false), [userResized, setUserResized] = useState(false);
  const state = useRef({ rect, minimized, maximized, userResized, collapsedHeight }); state.current = { rect, minimized, maximized, userResized, collapsedHeight };
  const temporaryHeight = useRef<{ before: WindowRect; expanded: WindowRect; owner: string; revision: number } | null>(null);
  const restoreRect = useRef<WindowRect | null>(null), gesture = useRef<Gesture | null>(null);
  const preferred = useRef<{ key: string; height: number | undefined } | null>(null);
  type SavedWindow = { owner: WindowGeometryPersistence; id: WorkbenchWindowId; snapshot: WindowGeometrySnapshot };
  const latestSnapshots = useRef(new Map<string, SavedWindow>()), emitted = useRef(new Map<string, string>());
  const pendingSave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const captureSnapshot = () => {
    if (persistence && ready && open && hydratedFor === persistenceKey && (id === "chat" || isOverlaySection(id))) {
      const current = state.current;
      const temporary = temporaryHeight.current;
      const savedRect = temporary && temporary.owner === persistenceKey && temporary.revision === geometryRevision.current && sameRect(current.rect, temporary.expanded) ? temporary.before : current.rect;
      latestSnapshots.current.set(persistenceKey, { owner: persistence, id, snapshot: { rect: savedRect, minimized: current.minimized, maximized: current.maximized, restoreRect: restoreRect.current, userResized: current.userResized } });
    }
  };
  captureSnapshot();
  const emit = (key: string) => {
    const saved = latestSnapshots.current.get(key); if (!saved) return;
    const serialized = snapshotKey(saved.snapshot); if (emitted.current.get(key) === serialized) return;
    emitted.current.set(key, serialized); saved.owner.onGeometryChange(saved.id, saved.snapshot);
  };
  const removeGestureListeners = useRef<(() => void) | null>(null);
  const focus = () => { setLayer(nextWindowLayer()); options.current.onFocus?.(); };
  const endGesture = () => {
    const current = gesture.current; gesture.current = null;
    removeGestureListeners.current?.(); removeGestureListeners.current = null;
    if (current) {
      try { if (current.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId); } catch { /* The browser may already have released capture. */ }
    }
    setInteracting(false);
    if (current) emit(persistenceKey);
  };
  useLayoutEffect(() => {
    if (!open || !ready || hydratedFor === persistenceKey) return;
    endGesture();
    temporaryHeight.current = null;
    const saved = persistence && (id === "chat" || isOverlaySection(id)) ? persistence.geometry[id] : undefined;
    const viewport = windowViewport(), minimum = options.current.minSize;
    let next = clampWindow(saved?.rect || options.current.initialRect(viewport, hostRef.current), viewport, minimum);
    if (saved?.maximized) next = maximizedWindow(viewport);
    else if (saved?.minimized) {
      const position = clampWindow({ ...next, x: saved.rect.x, y: saved.rect.y, height: fallbackCollapsedHeight }, viewport, { ...minimum, height: fallbackCollapsedHeight });
      next = { ...next, x: position.x, y: position.y };
    } else if (!saved && preferredHeight !== undefined) next = clampWindow({ ...next, y: next.y + next.height - preferredHeight, height: preferredHeight }, viewport, minimum);
    restoreRect.current = saved?.restoreRect ? clampWindow(saved.restoreRect, viewport, minimum) : null;
    setRect(next); setMinimized(saved?.minimized || false); setMaximized(saved?.maximized || false); setUserResized(saved?.userResized || false);
    preferred.current = { key: persistenceKey, height: preferredHeight };
    if (saved) emitted.current.set(persistenceKey, snapshotKey(saved)); else emitted.current.delete(persistenceKey);
    setHydratedFor(persistenceKey);
  }, [open, ready, id, persistenceKey, hydratedFor]);
  useLayoutEffect(() => {
    if (!open || !ready || hydratedFor !== persistenceKey || preferred.current?.key !== persistenceKey || preferred.current.height === preferredHeight) return;
    preferred.current.height = preferredHeight;
    if (preferredHeight === undefined || state.current.userResized || state.current.maximized) return;
    setRect((current) => clampWindow({ ...current, y: current.y + current.height - preferredHeight, height: preferredHeight }, windowViewport(), options.current.minSize));
  }, [preferredHeight, hydratedFor, persistenceKey, ready, open]);
  useEffect(() => {
    if (!persistence || !ready || !open || hydratedFor !== persistenceKey || interacting) return;
    pendingSave.current = setTimeout(() => { pendingSave.current = undefined; emit(persistenceKey); }, 120);
    return () => { clearTimeout(pendingSave.current); pendingSave.current = undefined; };
  }, [rect, minimized, maximized, userResized, interacting, open, ready, hydratedFor, persistenceKey]);
  useEffect(() => {
    const flush = () => emit(persistenceKey);
    window.addEventListener("pagehide", flush);
    window.addEventListener("hypeman.flush-window-geometry", flush);
    return () => { window.removeEventListener("pagehide", flush); window.removeEventListener("hypeman.flush-window-geometry", flush); flush(); };
  }, [persistenceKey]);
  useLayoutEffect(() => {
    if (!minimized) return;
    const host = hostRef.current, titleHeight = host?.querySelector("header")?.getBoundingClientRect().height || 0;
    if (!host || !titleHeight) return;
    const css = getComputedStyle(host), pixels = (value: string) => Number.parseFloat(value) || 0;
    setCollapsedHeight(Math.ceil(titleHeight + pixels(css.paddingTop) + pixels(css.paddingBottom) + pixels(css.borderTopWidth) + pixels(css.borderBottomWidth)));
  }, [minimized, hydratedFor]);
  useEffect(() => {
    const resize = () => setRect((current) => state.current.maximized ? maximizedWindow(windowViewport()) : clampWindow(current, windowViewport(), options.current.minSize));
    window.addEventListener("resize", resize); window.visualViewport?.addEventListener("resize", resize); window.visualViewport?.addEventListener("scroll", resize);
    return () => { window.removeEventListener("resize", resize); window.visualViewport?.removeEventListener("resize", resize); window.visualViewport?.removeEventListener("scroll", resize); };
  }, []);
  useEffect(() => { if (!open) endGesture(); }, [open]);
  useEffect(() => () => { removeGestureListeners.current?.(); }, []);
  const moveGesture = (event: globalThis.PointerEvent) => {
    const current = gesture.current; if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    let next: WindowRect;
    if (current.edge) next = resizeWindowEdge(current.rect, current.edge, dx, dy, windowViewport(), options.current.minSize);
    else {
      const height = state.current.minimized ? state.current.collapsedHeight : current.rect.height;
      const position = clampWindow({ ...current.rect, x: current.rect.x + dx, y: current.rect.y + dy, height }, windowViewport(), { ...options.current.minSize, height: state.current.minimized ? state.current.collapsedHeight : options.current.minSize.height });
      next = { ...position, height: current.rect.height };
    }
    state.current.rect = next; captureSnapshot(); setRect(next);
  };
  const startGesture = (event: PointerEvent<HTMLElement>, edge?: ResizeEdge) => {
    if (!ready || hydratedFor !== persistenceKey || event.button !== 0 || event.isPrimary === false || gesture.current || state.current.maximized || (!edge && (event.target as Element).closest("button,a,input,textarea,select,[contenteditable]"))) return;
    geometryRevision.current++;
    focus(); event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true });
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, rect: state.current.rect, userResized: state.current.userResized, edge, target: event.currentTarget };
    if (edge) { state.current.userResized = true; setUserResized(true); }
    setInteracting(true);
    const finish = (pointer: globalThis.PointerEvent) => { if (pointer.pointerId === gesture.current?.pointerId) endGesture(); };
    const cancel = (key: globalThis.KeyboardEvent) => {
      if (key.key !== "Escape" || !gesture.current) return;
      state.current.rect = gesture.current.rect; state.current.userResized = gesture.current.userResized;
      captureSnapshot(); setRect(gesture.current.rect); setUserResized(gesture.current.userResized); endGesture(); key.preventDefault(); key.stopPropagation();
    };
    window.addEventListener("pointermove", moveGesture); window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", endGesture); window.addEventListener("keydown", cancel, true);
    removeGestureListeners.current = () => {
      window.removeEventListener("pointermove", moveGesture); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", endGesture); window.removeEventListener("keydown", cancel, true);
    };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Window listeners and the gesture shield also support uncaptured pointers. */ }
  };
  const key = (event: KeyboardEvent<HTMLElement>, edge?: ResizeEdge) => {
    if (!ready || hydratedFor !== persistenceKey || event.target !== event.currentTarget || state.current.maximized) return;
    const step = event.shiftKey ? 50 : 10;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!delta[event.key]) return;
    geometryRevision.current++;
    event.preventDefault(); event.stopPropagation(); focus(); const [dx, dy] = delta[event.key];
    if (edge) { state.current.userResized = true; setUserResized(true); setRect((current) => resizeWindowEdge(current, edge, dx, dy, windowViewport(), options.current.minSize)); }
    else setRect((current) => {
      const height = state.current.minimized ? state.current.collapsedHeight : current.height;
      const next = clampWindow({ ...current, x: current.x + dx, y: current.y + dy, height }, windowViewport(), { ...options.current.minSize, height: state.current.minimized ? state.current.collapsedHeight : options.current.minSize.height });
      return { ...next, height: current.height };
    });
  };
  const toggleMinimized = () => {
    endGesture(); focus();
    const host = hostRef.current, titleHeight = host?.querySelector("header")?.getBoundingClientRect().height || 0;
    if (!state.current.minimized && host && titleHeight) {
      const css = getComputedStyle(host), pixels = (value: string) => Number.parseFloat(value) || 0;
      setCollapsedHeight(Math.ceil(titleHeight + pixels(css.paddingTop) + pixels(css.paddingBottom) + pixels(css.borderTopWidth) + pixels(css.borderBottomWidth)));
    }
    if (state.current.minimized) setRect((current) => clampWindow(current, windowViewport(), options.current.minSize));
    setMinimized((value) => !value);
  };
  const toggleMaximized = () => {
    geometryRevision.current++;
    endGesture(); focus(); setMinimized(false);
    if (state.current.maximized) {
      setRect(clampWindow(restoreRect.current || state.current.rect, windowViewport(), options.current.minSize)); setMaximized(false);
    } else {
      restoreRect.current = state.current.rect; setRect(maximizedWindow(windowViewport())); setMaximized(true);
    }
  };
  const ensureMinHeight = useCallback((height: number) => {
    const current = state.current;
    if (current.maximized || current.rect.height >= height) return () => {};
    const before = current.rect;
    const expanded = clampWindow({ ...before, y: before.y + before.height - height, height }, windowViewport(), options.current.minSize);
    if (expanded.height <= before.height) return () => {};
    const temporary = { before, expanded, owner: activePersistenceKey.current, revision: geometryRevision.current }; temporaryHeight.current = temporary;
    state.current.rect = expanded; setRect(expanded);
    return () => {
      const latest = state.current;
      if (temporaryHeight.current === temporary) temporaryHeight.current = null;
      // A user's move, resize, or maximize takes precedence over restoring the compact window.
      if (activePersistenceKey.current !== temporary.owner || geometryRevision.current !== temporary.revision || latest.maximized || !sameRect(latest.rect, expanded)) return;
      const restored = clampWindow(before, windowViewport(), options.current.minSize);
      state.current.rect = restored; setRect(restored);
    };
  }, []);
  const lostCapture = (event: PointerEvent<HTMLElement>) => { if (gesture.current?.pointerId === event.pointerId) endGesture(); };
  const titleProps = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => startGesture(event),
    onLostPointerCapture: lostCapture,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => key(event),
    onDoubleClick: (event: MouseEvent<HTMLElement>) => { if (!(event.target as Element).closest("button,a,input,textarea,select")) toggleMaximized(); },
  };
  const getResizeProps = (edge: ResizeEdge) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => startGesture(event, edge),
    onLostPointerCapture: lostCapture,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => key(event, edge),
  });
  const style: CSSProperties = { position: "fixed", transform: "none", left: rect.x, top: rect.y, width: rect.width, height: minimized ? collapsedHeight : rect.height, maxWidth: "none", maxHeight: "none", minWidth: 0, minHeight: 0, zIndex: layer, boxSizing: "border-box" };
  return { hostRef, rect, style, minimized, maximized, interacting, userResized, hydrated: ready && hydratedFor === persistenceKey, focus, titleProps, getResizeProps, toggleMinimized, toggleMaximized, ensureMinHeight,
    shellProps: { onPointerDownCapture: focus, onFocusCapture: focus, "data-minimized": minimized || undefined, "data-maximized": maximized || undefined, "data-interacting": interacting || undefined } };
}

export type WindowGeometry = ReturnType<typeof useWindowGeometry>;

export function WindowControls({ geometry, title, onClose }: { geometry: WindowGeometry; title: string; onClose?: () => void }) {
  return <div className="pixel-window-controls" style={{ position: "relative", zIndex: 31 }}>
    <button type="button" className="pixel-window-control pixel-window-minimize" aria-label={`${geometry.minimized ? "Restore" : "Minimize"} ${title} window`} aria-pressed={geometry.minimized} onClick={geometry.toggleMinimized}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d={geometry.minimized ? "M3 5H13V12H3Z" : "M3 12H13"} fill="none" stroke="currentColor" strokeWidth="2" /></svg>
    </button>
    <button type="button" className="pixel-window-control pixel-window-maximize" aria-label={`${geometry.maximized ? "Restore" : "Maximize"} ${title} window`} aria-pressed={geometry.maximized} onClick={geometry.toggleMaximized}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d={geometry.maximized ? "M5 3H13V10M3 5H11V13H3Z" : "M3 3H13V13H3ZM3 6H13"} fill="none" stroke="currentColor" strokeWidth="2" /></svg>
    </button>
    {onClose && <button data-essential="close" type="button" className="pixel-window-control pixel-window-close" aria-label={`Close ${title} window`} onClick={onClose}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4L12 12M12 4L4 12" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
    </button>}
  </div>;
}

const handleStyle = (edge: ResizeEdge): CSSProperties => {
  const corner = edge.length === 2;
  const style: CSSProperties = { position: "absolute", zIndex: 30, touchAction: "none", pointerEvents: "auto", userSelect: "none", cursor: `${edge === "n" || edge === "s" ? "ns" : edge === "e" || edge === "w" ? "ew" : edge === "nw" || edge === "se" ? "nwse" : "nesw"}-resize` };
  // Straddle the outside border so a corner's center stays clear of title controls.
  if (corner) { style.width = 22; style.height = 22; style[edge.includes("n") ? "top" : "bottom"] = -5; style[edge.includes("w") ? "left" : "right"] = -5; }
  else if (edge === "n" || edge === "s") { style.left = 22; style.right = 22; style.height = 8; style[edge === "n" ? "top" : "bottom"] = -4; }
  else { style.top = 22; style.bottom = 22; style.width = 8; style[edge === "w" ? "left" : "right"] = -4; }
  return style;
};

export function WindowResizeHandles({ geometry, title }: { geometry: WindowGeometry; title: string }) {
  return <>
    {geometry.interacting && <div className="pixel-window-gesture-shield" aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 29, touchAction: "none" }} />}
    {!geometry.minimized && !geometry.maximized && resizeEdges.map((edge) => <div key={edge} className={`pixel-window-resize-handle pixel-window-resize-${edge}${edge === "se" ? " pixel-window-resize" : ""}`}
      data-resize-edge={edge} role="group" tabIndex={edge === "se" ? 0 : -1} aria-label={`Resize ${title} window${edge === "se" ? "" : ` ${edge}`}`} aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
      style={handleStyle(edge)} {...geometry.getResizeProps(edge)} />)}
  </>;
}
