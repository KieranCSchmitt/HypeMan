import type { CSSProperties } from "react";
import props from "../../public/assets/y2k/props.json";

export type ArtName = keyof typeof props;
export const artURL = (file: string) => chrome.runtime.getURL(`assets/y2k/${file}`);

/** Transparent artwork exported at its authored resolution, never a screenshot crop. */
export function ArtSprite({
  name,
  scale = 2,
  width,
  className = "",
  alt = "",
  style,
}: {
  name: ArtName;
  scale?: number;
  width?: number;
  className?: string;
  alt?: string;
  style?: CSSProperties;
}) {
  const prop = props[name];
  const w = width ?? prop.width * scale;
  return (
    <img
      src={artURL(prop.file)}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      className={`art-sprite art-${name} ${className}`}
      width={w}
      height={(w / prop.width) * prop.height}
      draggable={false}
      style={{ imageRendering: "pixelated", objectFit: "contain", ...style }}
    />
  );
}
