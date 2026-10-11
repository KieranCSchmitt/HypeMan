import { useCallback, useEffect, useLayoutEffect, useRef, type UIEvent } from "react";

interface Options {
  conversationId: string;
  ready: boolean;
  open: boolean;
  lastMessage?: { id: string; role: string };
}

/** Restore the latest chat after its saved window has a visible, measurable layout. */
export function useChatScroll({ conversationId, ready, open, lastMessage }: Options) {
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const frame = useRef<number | null>(null);
  const state = useRef({ ready, open }); state.current = { ready, open };
  const latest = useCallback((force = false) => {
    if (!force && !following.current) return;
    if (force) following.current = true;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const element = ref.current;
      if (!state.current.ready || !state.current.open || document.visibilityState === "hidden" || !element?.clientHeight) return;
      // Scrolling the log directly leaves the host webpage and other windows in place.
      element.scrollTop = element.scrollHeight;
      following.current = true;
    });
  }, []);
  useLayoutEffect(() => { latest(true); }, [conversationId, ready, open, latest]);
  useLayoutEffect(() => { latest(lastMessage?.role === "user"); }, [lastMessage?.id, lastMessage?.role, latest]);
  useEffect(() => {
    let live = true;
    const activate = () => { if (document.visibilityState !== "hidden") latest(true); };
    const contentChanged = () => latest();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => latest());
    if (ref.current) resize?.observe(ref.current);
    document.addEventListener("visibilitychange", activate);
    window.addEventListener("focus", activate);
    window.addEventListener("pageshow", activate);
    document.fonts?.addEventListener("loadingdone", contentChanged);
    // Pixel fonts can finish loading after conversation and window hydration.
    void document.fonts?.ready.then(() => { if (live) latest(); });
    return () => {
      live = false; resize?.disconnect();
      document.removeEventListener("visibilitychange", activate);
      window.removeEventListener("focus", activate);
      window.removeEventListener("pageshow", activate);
      document.fonts?.removeEventListener("loadingdone", contentChanged);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [latest]);
  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    if (!state.current.ready || !state.current.open || document.visibilityState === "hidden" || !element.clientHeight) return;
    following.current = element.scrollHeight - element.clientHeight - element.scrollTop <= 32;
  }, []);
  return { ref, onScroll, latest };
}
