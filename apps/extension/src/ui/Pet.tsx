import { useEffect, useState } from "react";
import type { Settings, CharacterAsset } from "@core";
import atlas from "../../public/assets/y2k/hypeman-atlas.json";
import { useReducedMotion } from "./hooks";
import { artURL } from "./ArtSprite";
import { CHARACTER_FRAME } from "./character-art";

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
  const [custom, setCustom] = useState("");
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
  useEffect(() => {
    let disposed = false;
    setCustom("");
    const character = settings?.character;
    if (character?.startsWith("custom:"))
      void chrome.storage.local.get("hypeman.characters").then((data) => {
        if (disposed) return;
        const all = Array.isArray(data["hypeman.characters"])
          ? (data["hypeman.characters"] as CharacterAsset[])
          : [];
        setCustom(all.find((c) => `custom:${c.id}` === character)?.image || "");
      });
    return () => {
      disposed = true;
    };
  }, [settings?.character]);
  const label = settings?.characterName || "HypeMan";
  if (custom)
    return (
      <img
        className="hypeman-pet custom-pet"
        src={custom}
        width={CHARACTER_FRAME.width * scale}
        height={CHARACTER_FRAME.height * scale}
        style={{ objectFit: "contain", imageRendering: "pixelated" }}
        alt={label}
        draggable={false}
      />
    );
  const tile = animation.frames[Math.min(frame, animation.frames.length - 1)];
  const pixel = scale;
  return (
    <span
      role="img"
      aria-label={label}
      className="hypeman-pet"
      data-state={state}
      style={{
        width: CHARACTER_FRAME.width * scale,
        height: CHARACTER_FRAME.height * scale,
        position: "relative",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "block",
          position: "absolute",
          left: (CHARACTER_FRAME.width * scale - tile.w * pixel) / 2,
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
