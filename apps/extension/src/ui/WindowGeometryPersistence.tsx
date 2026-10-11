import { createContext, useContext, type ReactNode } from "react";
import type { ConversationUIState, WindowGeometrySnapshot, WorkbenchWindowId } from "@core";

export interface WindowGeometryPersistence {
  conversationId: string;
  ready: boolean;
  geometry: ConversationUIState["geometry"];
  onGeometryChange: (id: WorkbenchWindowId, snapshot: WindowGeometrySnapshot) => void;
}

const WindowGeometryContext = createContext<WindowGeometryPersistence | undefined>(undefined);
export const useWindowGeometryPersistence = () => useContext(WindowGeometryContext);

export function WindowGeometryProvider({ children, ...value }: WindowGeometryPersistence & { children: ReactNode }) {
  return <WindowGeometryContext.Provider value={value}>{children}</WindowGeometryContext.Provider>;
}
