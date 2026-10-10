import { createRoot } from "react-dom/client";
import { ChatGPTConnection } from "../ui/ChatGPTConnection";
import { useSettings } from "../ui/hooks";
import { bindOverlayFrame } from "./utility-frame";
bindOverlayFrame();
function Connection() {
  const { settings } = useSettings();
  return <ChatGPTConnection connectionKey={settings.serverUrl} />;
}
createRoot(document.getElementById("root")!).render(<Connection />);
