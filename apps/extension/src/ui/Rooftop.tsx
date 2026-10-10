import { useEffect, useRef, useState } from "react";
import type { Settings } from "@core";
import { Wallpaper, WALLPAPER_ACTIONS, type WallpaperAction, type WallpaperActivity } from "../art/wallpaper";
import { artURL } from "./ArtSprite";

export interface RooftopProps {
  reduced?: boolean;
  activity?: WallpaperActivity;
  settings?: Settings;
  onCompanion?: () => void;
  onCustomize?: () => void;
  onNotes?: () => void;
}

/** The authored city is interactive without adding more desktop chrome. */
export function Rooftop({ reduced = false, activity = "idle", settings, onCompanion, onCustomize, onNotes }: RooftopProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<Wallpaper | null>(null);
  const buttons = useRef(new Map<WallpaperAction, HTMLButtonElement>());
  const callbacks = useRef({ onCompanion, onCustomize, onNotes });
  callbacks.current = { onCompanion, onCustomize, onNotes };
  const [dancing, setDancing] = useState(false);
  const [phase, setPhase] = useState("");
  useEffect(() => {
    const wallpaper = new Wallpaper(canvas.current!, {
      reduced,
      spriteURL: artURL("hypeman.png"),
      onLayout: (viewport, avatar) => {
        for (const action of WALLPAPER_ACTIONS) {
          const element = buttons.current.get(action.id);
          if (!element) continue;
          const rect = action.id === "hypeman" ? avatar : action.rect;
          Object.assign(element.style, {
            left: `${viewport.x + rect.x * viewport.scale}px`,
            top: `${viewport.y + rect.y * viewport.scaleY}px`,
            width: `${rect.w * viewport.scale}px`,
            height: `${rect.h * viewport.scaleY}px`,
          });
        }
      },
      onAction: (action) => {
        if (action === "hypeman") callbacks.current.onCompanion?.();
        if (action === "graffiti") callbacks.current.onCustomize?.();
        if (action === "crt") callbacks.current.onNotes?.();
        setDancing(wallpaper.dancing);
        setPhase(wallpaper.timeOfDay);
      },
    });
    engine.current = wallpaper;
    return () => { engine.current = null; wallpaper.destroy(); };
    // One engine survives settings changes; no canvas or animation state resets.
  }, []);
  useEffect(() => engine.current?.setReducedMotion(reduced), [reduced]);
  useEffect(() => engine.current?.setActivity(activity), [activity]);
  useEffect(() => {
    let disposed = false;
    let version = 0;
    const selected = settings?.character;
    const load = async () => {
      const current = ++version;
      engine.current?.setCustomSprite(null);
      if (!selected?.startsWith("custom:")) return;
      try {
        const data = await chrome.storage.local.get("burrow.characters");
        if (disposed || current !== version) return;
        const raw: unknown = data["burrow.characters"];
        const valid = Array.isArray(raw) ? raw.filter((value): value is { id: string; name: string; image: string } =>
          Boolean(value) && typeof value === "object" &&
          typeof value.id === "string" && typeof value.name === "string" &&
          typeof value.image === "string" && value.image.length <= 2_000_000 &&
          /^data:image\/(png|webp);base64,/.test(value.image),
        ).slice(-8) : [];
        engine.current?.setCustomSprite(valid.find((character) => `custom:${character.id}` === selected)?.image ?? null);
      } catch {
        // Invalid or unavailable local artwork falls back to the packaged character.
      }
    };
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes["burrow.characters"]) void load();
    };
    void load();
    chrome.storage.onChanged.addListener(changed);
    return () => { disposed = true; chrome.storage.onChanged.removeListener(changed); };
  }, [settings?.character]);
  return (
    <div
      className="rooftop-wallpaper"
      data-time-of-day={phase || undefined}
      style={{ position: "fixed", inset: 0, zIndex: -1, overflow: "hidden", pointerEvents: "auto" }}
      onPointerMove={(event) => engine.current?.pointerMove(event.clientX, event.clientY)}
      onPointerLeave={() => engine.current?.pointerLeave()}
      onClick={(event) => {
        if (event.target === event.currentTarget || event.target === canvas.current) engine.current?.walkAt(event.clientX, event.clientY);
      }}
    >
      <canvas
        ref={canvas}
        className="rooftop-canvas"
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0, pointerEvents: "auto", imageRendering: "pixelated" }}
      />
      {WALLPAPER_ACTIONS.map((action) => (
        <button
          key={action.id}
          type="button"
          ref={(element) => { if (element) buttons.current.set(action.id, element); else buttons.current.delete(action.id); }}
          className="wallpaper-hotspot"
          aria-label={action.label}
          title={action.label}
          aria-pressed={action.id === "boombox" ? dancing : undefined}
          style={{ position: "absolute", zIndex: 1, padding: 0, border: 0, borderRadius: 0, outlineOffset: 3, background: "transparent", boxShadow: "none", cursor: "pointer" }}
          onPointerEnter={() => engine.current?.highlight(action.id)}
          onPointerLeave={() => engine.current?.highlight(null)}
          onFocus={() => engine.current?.highlight(action.id, true)}
          onBlur={() => engine.current?.highlight(null, true)}
          onClick={() => engine.current?.activate(action.id)}
          onKeyDown={(event) => {
            if (action.id !== "hypeman" || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
            event.preventDefault();
            engine.current?.walk(event.key === "ArrowLeft" ? -1 : 1);
          }}
        />
      ))}
    </div>
  );
}
