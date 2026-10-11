import { useEffect, useState } from "react";
import type { Settings } from "@core";
import atlas from "../../public/assets/y2k/hypeman-atlas.json";
import { useReducedMotion } from "./hooks";
import { artURL } from "./ArtSprite";

type PetState = "idle" | "thinking" | "confused" | "celebrate" | "wave" | "sleepy";

export function Pet({
  state = "idle",
  scale = 2,
  settings,
  still = false,
}: {
  state?: PetState;
  scale?: number;
  settings?: Settings;
  still?: boolean;
}) {
  const [frame, setFrame] = useState(0);
  const motionPreference = useReducedMotion(settings?.reducedMotion);
  const reduced = still || motionPreference;
  const animation = atlas.animations[state];
  useEffect(() => {
    setFrame(0);
    if (reduced) return;
    let index = 0;
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;
    const advance = () => {
      if (disposed || document.hidden) return;
      timer = setTimeout(() => {
        if (disposed) return;
        if (index < animation.frames.length - 1) index++;
        else if (animation.loop) index = 0;
        else return;
        setFrame(index);
        advance();
      }, animation.frames[index].duration);
    };
    const visibility = () => {
      clearTimeout(timer);
      if (!document.hidden) advance();
    };
    document.addEventListener("visibilitychange", visibility);
    advance();
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [animation, reduced]);
  const tile = animation.frames[Math.min(frame, animation.frames.length - 1)];
  const pixel = scale;
  return (
    <span
      role="img"
      aria-label="HypeMan"
      className="hypeman-pet"
      data-state={state}
      style={{
        width: atlas.meta.frameWidth * scale,
        height: atlas.meta.frameHeight * scale,
        position: "relative",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "block",
          position: "absolute",
          left: (atlas.meta.frameWidth * scale - tile.w * pixel) / 2,
          bottom: 0,
          width: tile.w * pixel,
          height: tile.h * pixel,
          backgroundImage: `url(${artURL("hypeman.png")})`,
          backgroundSize: `${atlas.meta.sheetWidth * pixel}px ${atlas.meta.sheetHeight * pixel}px`,
          backgroundPosition: `${-tile.x * pixel}px ${-tile.y * pixel}px`,
          backgroundRepeat: "no-repeat",
          imageRendering: "pixelated",
        }}
      />
    </span>
  );
}
