import { useEffect, useRef, useState } from "react";
import { Wallpaper, WALLPAPER_ACTIONS, type WallpaperAction, type WallpaperActivity } from "../art/wallpaper";
import { artURL } from "./ArtSprite";
import { wallpaperRect, type WallpaperViewport } from "../art/wallpaper-layout";
import type { AvatarSkin } from "@core";
import { avatarAsset } from "./avatar-skins";
import { CRT_SCREEN } from "../../../../scripts/art/scene/props";

export interface RooftopProps {
  reduced?: boolean;
  activity?: WallpaperActivity;
  animationKey?: number;
  onCompanion?: () => void;
  onLayout?: (viewport: WallpaperViewport) => void;
  skin?: AvatarSkin;
}

/** The authored city is interactive without adding more desktop chrome. */
export function Rooftop({ reduced = false, activity = "idle", animationKey = 0, onCompanion, onLayout, skin = "hypeman" }: RooftopProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const musicButton = useRef<HTMLButtonElement>(null);
  const television = useRef<HTMLDivElement>(null);
  const [tvOn, setTvOn] = useState(false);
  const engine = useRef<Wallpaper | null>(null);
  const buttons = useRef(new Map<WallpaperAction, HTMLButtonElement>());
  const callbacks = useRef({ onCompanion, onLayout });
  callbacks.current = { onCompanion, onLayout };
  const [dancing, setDancing] = useState(false);
  const [phase, setPhase] = useState("");
  const [musicError, setMusicError] = useState("");
  useEffect(() => {
    const music = audio.current;
    // Chrome omits extension-page Referer headers. Identify this app as
    // YouTube requires, only for this video's embed initiated by HypeMan.
    const tvReady = chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [8101],
      addRules: [{ id: 8101, priority: 1,
        action: { type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS, requestHeaders: [{ header: "Referer", operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: `https://hypeman.${chrome.runtime.id}/` }] },
        condition: { urlFilter: "|https://www.youtube.com/embed/GaXuCT3jOPk", initiatorDomains: [chrome.runtime.id], resourceTypes: [chrome.declarativeNetRequest.ResourceType.SUB_FRAME] },
      }],
    });
    // Keep an early setup failure handled until the user activates the TV.
    void tvReady.catch(() => {});
    const wallpaper = new Wallpaper(canvas.current!, {
      reduced,
      spriteURL: artURL("hypeman.png"),
      onLayout: (viewport, avatar) => {
        callbacks.current.onLayout?.(viewport);
        const screen = wallpaperRect(viewport, CRT_SCREEN);
        if (television.current) {
          Object.assign(television.current.style, {
            left: `${screen.x}px`, top: `${screen.y}px`, width: `${screen.w}px`, height: `${screen.h}px`,
          });
          television.current.style.setProperty("--tv-scale", `${screen.w / 640}`);
        }
        for (const action of WALLPAPER_ACTIONS) {
          const element = buttons.current.get(action.id);
          if (!element) continue;
          const target = action.id === "crt" ? { x: 110, y: 188, w: 12, h: 64 } : action.rect;
          const rect = wallpaperRect(viewport, action.id === "hypeman" ? avatar : target);
          if (action.id === "boombox" && musicButton.current) Object.assign(musicButton.current.style, {
            left: `${Math.max(8, Math.min(canvas.current!.getBoundingClientRect().width - 100, rect.x))}px`,
            top: `${Math.max(8, Math.min(rect.y - 34, canvas.current!.getBoundingClientRect().height - 140))}px`,
          });
          Object.assign(element.style, {
            left: `${rect.x}px`,
            top: `${rect.y}px`,
            width: `${rect.w}px`,
            height: `${rect.h}px`,
          });
        }
      },
      onAction: (action) => {
        if (action === "hypeman") callbacks.current.onCompanion?.();
        if (action === "crt") {
          const toggle = () => { if (engine.current === wallpaper) setTvOn(on => !on); };
          void tvReady.then(toggle, toggle);
        }
        if (action === "boombox" && audio.current) {
          const music = audio.current;
          setMusicError("");
          if (wallpaper.dancing) {
            music.volume = 0.45;
            void music.play().catch(() => {
              if (engine.current !== wallpaper || !wallpaper.dancing) return;
              wallpaper.setDancing(false); setDancing(false);
              setMusicError("Couldn't play the music. Click the boombox to try again.");
            });
          } else music.pause();
        }
        setDancing(wallpaper.dancing);
        setPhase(wallpaper.timeOfDay);
      },
    });
    engine.current = wallpaper;
    return () => { engine.current = null; music?.pause(); wallpaper.destroy(); };
    // One engine survives settings changes; no canvas or animation state resets.
  }, []);
  useEffect(() => engine.current?.setReducedMotion(reduced), [reduced]);
  useEffect(() => engine.current?.setActivity(activity, animationKey), [activity, animationKey]);
  useEffect(() => engine.current?.setSprite(artURL(avatarAsset(skin))), [skin]);
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
      <audio ref={audio} src={chrome.runtime.getURL("assets/audio/boombox.flac")} preload="none" loop aria-hidden="true" />
      <div ref={television} className="rooftop-tv-video" hidden={!tvOn}>
        {tvOn && <iframe title="HypeMan TV video" src={`https://www.youtube.com/embed/GaXuCT3jOPk?autoplay=1&mute=1&controls=0&disablekb=1&fs=0&playsinline=1&loop=1&playlist=GaXuCT3jOPk&rel=0&origin=${encodeURIComponent(`https://hypeman.${chrome.runtime.id}`)}`} width="640" height="366" allow="autoplay; encrypted-media" sandbox="allow-scripts allow-same-origin" tabIndex={-1} referrerPolicy="strict-origin-when-cross-origin" />}
      </div>
      <button ref={musicButton} type="button" className="boombox-control" aria-label={dancing ? "Pause boombox music" : "Play boombox music"} aria-pressed={dancing} onClick={() => engine.current?.activate("boombox")}>{dancing ? "Pause music" : "Play music"}</button>
      {musicError && <p className="boombox-error" role="alert">{musicError}</p>}
      <canvas
        ref={canvas}
        className="rooftop-canvas"
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0, pointerEvents: "auto", imageRendering: "pixelated" }}
      />
      {WALLPAPER_ACTIONS.filter((action) => action.id === "hypeman" || action.id === "boombox" || action.id === "crt").map((action) => (
        <button
          key={action.id}
          type="button"
          ref={(element) => { if (element) buttons.current.set(action.id, element); else buttons.current.delete(action.id); }}
          className="wallpaper-hotspot"
          aria-label={action.id === "crt" ? tvOn ? "Turn TV video off" : "Turn TV video on" : action.id === "boombox" ? dancing ? "Boombox: pause music" : "Boombox: play music" : action.label}
          title={action.id === "boombox" ? dancing ? "Pause music" : "Play music" : action.label}
          aria-pressed={action.id === "crt" ? tvOn : action.id === "boombox" ? dancing : undefined}
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
