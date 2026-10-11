import { createRoot } from "react-dom/client";
import { DocumentReader } from "../ui/DocumentReader";
import { FrameToolProvider } from "../ui/WorkbenchContext";
import { bindOverlayFrame } from "./utility-frame";

bindOverlayFrame();
createRoot(document.getElementById("root")!).render(<FrameToolProvider><DocumentReader /></FrameToolProvider>);
