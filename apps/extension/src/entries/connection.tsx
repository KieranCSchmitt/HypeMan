import { createRoot } from "react-dom/client";
import { ChatGPTConnection } from "../ui/ChatGPTConnection";
import { useSettings } from "../ui/hooks";
import { FrameToolProvider } from "../ui/WorkbenchContext";
import { bindOverlayFrame } from "./utility-frame";
bindOverlayFrame();
function Connection() { const { settings } = useSettings(); return <FrameToolProvider><ChatGPTConnection connectionKey={settings.serverUrl} /></FrameToolProvider>; }
createRoot(document.getElementById("root")!).render(<Connection />);
