import { createRoot } from "react-dom/client";
import { NewTab } from "../ui/NewTab";
createRoot(document.getElementById("root")!).render(<NewTab initialTool="video" />);
