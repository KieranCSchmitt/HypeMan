import { useEffect, type ReactNode } from "react";
import { Icon } from "./Icon";
import { overlaySections, type OverlaySection } from "./overlay-sections";
import { initialWindow, windowMinimum } from "./window-layout";
import { useWindowGeometry, WindowControls, WindowResizeHandles } from "./useWindowGeometry";

export function FloatingToolWindow({ section, open, focused, cascade, onFocus, onClose, children }: {
  section: OverlaySection; open: boolean; focused: boolean; cascade: number;
  onFocus: (section: OverlaySection) => void; onClose: (section: OverlaySection) => void; children: ReactNode;
}) {
  const geometry = useWindowGeometry({ id: section, open, minSize: windowMinimum(section), onFocus: () => onFocus(section),
    initialRect: (viewport, host) => {
      const root = host?.getRootNode() as Document | ShadowRoot | undefined;
      const chat = root?.querySelector(".conversation-pane")?.getBoundingClientRect();
      const compactChat = chat && viewport.width < 760 ? { left: chat.left, width: chat.width, top: chat.bottom - Math.min(chat.height, 180), height: Math.min(chat.height, 180) } : chat;
      return initialWindow(section, viewport, compactChat, cascade);
    } });
  useEffect(() => { if (open && focused) geometry.focus(); }, [open, focused]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const childFocus = () => { timer = setTimeout(() => {
      const host = geometry.hostRef.current, root = host?.getRootNode() as Document | ShadowRoot | undefined;
      if (open && root?.activeElement?.tagName === "IFRAME" && host?.contains(root.activeElement)) geometry.focus();
    }, 0); };
    window.addEventListener("blur", childFocus); return () => { clearTimeout(timer); window.removeEventListener("blur", childFocus); };
  }, [open, section]);
  const title = overlaySections[section].title, help = `tool-window-help-${section}`;
  return <section ref={geometry.hostRef} hidden={!open || !geometry.hydrated} className={`pixel-workspace workspace-${section}`} role="region" aria-label={title} data-window-tool={section}
    {...geometry.shellProps} style={geometry.style}>
    <header className="pixel-workspace-bar" tabIndex={0} aria-label={`Move ${title} window`} aria-describedby={help} aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown" {...geometry.titleProps}>
      <span><Icon name={overlaySections[section].icon} /><strong>{title}</strong></span><span className="pixel-window-grip" aria-hidden="true" />
      <WindowControls geometry={geometry} title={title} onClose={() => onClose(section)} />
    </header>
    <span id={help} className="sr-only">Arrow keys move this window. Hold Shift for larger steps. Focus the corner grip and use arrow keys to resize.</span>
    <div className="pixel-workspace-content" hidden={geometry.minimized}>{children}</div>
    <WindowResizeHandles geometry={geometry} title={title} />
  </section>;
}
