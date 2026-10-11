import type { IconName } from "./Icon";
export type OverlaySection = "tasks" | "notes" | "board" | "video" | "notebook" | "customize" | "settings" | "learning" | "activity" | "connection";
export const overlaySections: Record<OverlaySection, { title: string; icon: IconName }> = {
  tasks: { title: "Missions", icon: "task" },
  notes: { title: "Notes", icon: "notes" },
  board: { title: "Whiteboard", icon: "sketch" },
  video: { title: "Video", icon: "video" },
  notebook: { title: "Paper camera", icon: "camera" },
  customize: { title: "Dressing room", icon: "customize" },
  settings: { title: "Preferences", icon: "settings" },
  learning: { title: "Practice", icon: "learn" },
  activity: { title: "Completed actions", icon: "check" },
  connection: { title: "Connection", icon: "link" },
};
export const isOverlaySection = (value: unknown): value is OverlaySection =>
  typeof value === "string" && Object.hasOwn(overlaySections, value);
