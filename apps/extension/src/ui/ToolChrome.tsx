import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
export function ToolHeader({ title, icon }: { title: string; icon: IconName; children?: ReactNode }) {
  return <header className="simple-header studio-header"><div className="studio-title"><Icon name={icon} /><span>{title}</span></div></header>;
}
export function WindowBar({ title, icon, children }: { title: string; icon: IconName; children?: ReactNode }) {
  return <div className="studio-window-bar"><span><Icon name={icon} />{title}</span>{children}</div>;
}
