import { createRoot } from "react-dom/client";
import { CompanionTools } from "../ui/CompanionTools";
import { bindOverlayFrame } from "./utility-frame";
bindOverlayFrame();
createRoot(document.getElementById("root")!).render(<div className="pixel-workspace embedded-preferences"><div className="pixel-workspace-content"><CompanionTools embedded section="settings" onClose={() => parent.postMessage({ type: "hypeman.close-overlay" }, "*")} onOpenTool={(section) => parent.postMessage({ type: "hypeman.open-overlay", section }, "*")} /></div></div>);
