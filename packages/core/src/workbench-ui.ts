/** Temporary window state follows a conversation within the current browser session. */
export const WORKBENCH_TOOLS = ["tasks", "notes", "board", "video", "documents", "settings", "learning", "activity", "connection", "phone"] as const;
export type WorkbenchToolId = typeof WORKBENCH_TOOLS[number];
export type WorkbenchWindowId = "chat" | WorkbenchToolId;
export interface WorkbenchWindowRect { x: number; y: number; width: number; height: number }
export interface WindowGeometrySnapshot {
  rect: WorkbenchWindowRect;
  minimized: boolean;
  maximized: boolean;
  restoreRect: WorkbenchWindowRect | null;
  userResized: boolean;
}
export interface ConversationUIState {
  open: boolean;
  tools: WorkbenchToolId[];
  active: WorkbenchToolId | null;
  geometry: Partial<Record<WorkbenchWindowId, WindowGeometrySnapshot>>;
}
export interface ConversationUIPatch {
  open?: boolean;
  tools?: WorkbenchToolId[];
  active?: WorkbenchToolId | null;
  /** Entries merge independently; null removes only that window's saved geometry. */
  geometry?: Partial<Record<WorkbenchWindowId, WindowGeometrySnapshot | null>>;
}
