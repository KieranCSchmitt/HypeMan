import { useEffect } from "react";
import { request } from "../bridge";
import { NewTab } from "./NewTab";
export function Onboarding() {
  useEffect(() => { void request<{ demoMode?: boolean }>({ type: "health" }).then((health) => {
    if (health.demoMode) return request({ type: "settings.patch", patch: { onboarded: true } });
  }).catch(() => {}); }, []);
  return <NewTab initialTool="connection" />;
}
