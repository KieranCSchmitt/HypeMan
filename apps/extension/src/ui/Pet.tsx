import { useEffect, useRef, useState } from "react";
import type { Settings } from "@core";
import atlas from "../../public/assets/y2k/hypeman-atlas.json";
import { useReducedMotion } from "./hooks";
import { artURL } from "./ArtSprite";
import type { AvatarAnimation } from "./useAvatarAnimation";
import { avatarAsset } from "./avatar-skins";

export function Pet({
  state = "idle",
  scale = 2,
  settings,
  still = false,
  animationKey = 0,
  once = false,
  onComplete,
}: {
  state?: AvatarAnimation;
  scale?: number;
  settings?: Settings;
  still?: boolean;
  animationKey?: number;
  once?: boolean;
  onComplete?: () => void;
}) {
  const request = `${state}:${animationKey}:${once}`;
  const [view, setView] = useState({ request, state, frame: 0 });
  const complete = useRef(onComplete); complete.current = onComplete;
  const motionPreference = useReducedMotion(settings?.reducedMotion);
  const reduced = still || motionPreference;
  useEffect(() => {
    let playing = state, animation = atlas.animations[playing], index = 0;
    let single = once || !animation.loop;
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;
    let remaining = reduced ? animation.frames.reduce((sum, tile) => sum + tile.duration, 0) : animation.frames[0].duration;
    let started = 0;
    setView({ request, state: playing, frame: 0 });
    const advance = () => {
      if (disposed || document.hidden || (reduced && !single)) return;
      started = performance.now();
      timer = setTimeout(() => {
        if (disposed) return;
        if (!reduced && index < animation.frames.length - 1) index++;
        else if (!single) index = 0;
        else {
          playing = "idle"; animation = atlas.animations.idle; index = 0; single = false;
          complete.current?.();
        }
        setView({ request, state: playing, frame: index });
        remaining = animation.frames[index].duration;
        advance();
      }, remaining);
    };
    const visibility = () => {
      clearTimeout(timer);
      if (document.hidden) remaining = Math.max(0, remaining - (performance.now() - started));
      else advance();
    };
    document.addEventListener("visibilitychange", visibility);
    advance();
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [state, request, reduced, once]);
  const current = view.request === request ? view : { state, frame: 0 };
  const tile = atlas.animations[current.state].frames[current.frame];
  const pixel = scale;
  return (
    <span
      role="img"
      aria-label="HypeMan"
      className="hypeman-pet"
      data-state={current.state}
      data-frame={current.frame}
      data-skin={settings?.avatarSkin ?? "hypeman"}
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
          backgroundImage: `url(${artURL(avatarAsset(settings?.avatarSkin))})`,
          backgroundSize: `${atlas.meta.sheetWidth * pixel}px ${atlas.meta.sheetHeight * pixel}px`,
          backgroundPosition: `${-tile.x * pixel}px ${-tile.y * pixel}px`,
          backgroundRepeat: "no-repeat",
          imageRendering: "pixelated",
        }}
      />
    </span>
  );
}
