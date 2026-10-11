import { createRoot } from "react-dom/client";
import { CompanionTools } from "../ui/CompanionTools";
import { Messaging } from "../ui/Messaging";
import { FrameToolProvider } from "../ui/WorkbenchContext";
import { useSettings } from "../ui/hooks";
import { bindOverlayFrame } from "./utility-frame";
bindOverlayFrame();
function Preferences() {
  const { settings } = useSettings();
  const phone = new URLSearchParams(location.search).get("tool") === "phone";
  return <FrameToolProvider><div className="embedded-preferences"><div className="pixel-workspace-content">{phone ? <Messaging connectionKey={settings.serverUrl} /> : <CompanionTools embedded section="settings" onClose={() => {}} />}</div></div></FrameToolProvider>;
}
createRoot(document.getElementById("root")!).render(<Preferences />);
