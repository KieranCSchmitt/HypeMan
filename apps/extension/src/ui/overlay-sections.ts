import type { IconName } from "./Icon";
export type OverlaySection = "tasks" | "notes" | "board" | "video" | "documents" | "settings" | "learning" | "activity" | "connection" | "phone";
export const overlaySections: Record<OverlaySection, { title: string; icon: IconName }> = {
  tasks: { title: "Projects", icon: "task" }, notes: { title: "Notes", icon: "notes" },
  board: { title: "Whiteboard", icon: "sketch" }, video: { title: "Video", icon: "video" },
  documents: { title: "Documents", icon: "documents" }, settings: { title: "Preferences", icon: "settings" },
  learning: { title: "Practice", icon: "learn" }, activity: { title: "Completed actions", icon: "check" },
  connection: { title: "Connection", icon: "link" }, phone: { title: "Phone companion", icon: "chat" },
};
export const isOverlaySection = (value: unknown): value is OverlaySection => typeof value === "string" && Object.hasOwn(overlaySections, value);
