import { createRoot } from "react-dom/client";
import { createCompanion } from "../runtime";
import { request, subscribe } from "../bridge";
import { Companion } from "../ui/Companion";
import { loadCompanionFonts } from "./fonts";
import { isolateCompanionKeyboard } from "./keyboard";

const mountId = "hypeman-companion-v2";
if (!document.getElementById(mountId)) {
  loadCompanionFonts();
  const host = document.createElement("div");
  host.id = mountId;
  host.style.cssText =
    "position:fixed;inset:0;z-index:2147483646;pointer-events:none;contain:layout style;";
  const shadow = host.attachShadow({ mode: "open" });
  const releaseKeyboard = isolateCompanionKeyboard(shadow);
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = chrome.runtime.getURL("ui.css");
  shadow.append(css);
  const view = document.createElement("div");
  view.className = "hypeman-ui";
  shadow.append(view);
  document.documentElement.append(host);
  const runtime = createCompanion(shadow, { request, subscribe });
  const root = createRoot(view);
  let active = true;
  const guard = new MutationObserver(() => {
    if (active && !host.isConnected) document.documentElement?.append(host);
  });
  const documentGuard = new MutationObserver(() => {
    if (!active) return;
    guard.disconnect();
    if (document.documentElement) {
      document.documentElement.append(host);
      guard.observe(document.documentElement, { childList: true });
    }
  });
  const attach = () => {
    active = true;
    document.documentElement.append(host);
    guard.observe(document.documentElement, { childList: true });
    documentGuard.observe(document, { childList: true });
  };
  const hide = (event: PageTransitionEvent) => {
    active = false;
    guard.disconnect();
    documentGuard.disconnect();
    if (!event.persisted) {
      root.unmount();
      releaseKeyboard();
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
    }
  };
  const show = (event: PageTransitionEvent) => {
    if (event.persisted) attach();
  };
  attach();
  window.addEventListener("pagehide", hide);
  window.addEventListener("pageshow", show);
  void runtime.start().then(() => {
    if (active) root.render(<Companion runtime={runtime} />);
  });
}
