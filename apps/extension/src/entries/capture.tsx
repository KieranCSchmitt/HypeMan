import { createRoot } from "react-dom/client";
import { Notebook } from "../ui/Notebook";
import { bindOverlayFrame } from "./utility-frame";
bindOverlayFrame();
createRoot(document.getElementById("root")!).render(<Notebook />);
