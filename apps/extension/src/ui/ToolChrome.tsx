import type { ReactNode } from "react";
import { Brand } from "./common";
import { Icon, type IconName } from "./Icon";

export function ToolHeader({
  title,
  icon,
  children,
}: {
  title: string;
  icon: IconName;
  children?: ReactNode;
}) {
  return (
    <header className="simple-header studio-header">
      <Brand />
      <div className="studio-title">
        <Icon name={icon} />
        <span>{title}</span>
        <i aria-hidden="true" />
      </div>
      <nav aria-label="Workspace navigation">
        {children}
        <a className="icon-button" href="newtab.html" aria-label="Home" title="Home">
          <Icon name="home" />
        </a>
        <a
          className="icon-button"
          href="newtab.html#settings"
          aria-label="Companion settings"
          title="Companion settings"
        >
          <Icon name="settings" />
        </a>
      </nav>
    </header>
  );
}

export function WindowBar({
  title,
  icon,
  children,
}: {
  title: string;
  icon: IconName;
  children?: ReactNode;
}) {
  return (
    <div className="studio-window-bar">
      <span>
        <Icon name={icon} />
        {title}
      </span>
      {children || (
        <span className="window-signals" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  );
}
