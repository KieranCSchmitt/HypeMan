import { useEffect, useRef, useState } from "react";
import { AVATAR_SKINS, type AvatarSkin, type Settings } from "@core";
import { Pet } from "./Pet";

const names: Record<AvatarSkin, string> = { hypeman: "HypeMan", glitch: "Glitch", rally: "Rally", orbit: "Orbit", breeze: "Breeze", spark: "Spark" };

export function SkinPicker({ settings, onSelect }: { settings: Settings; onSelect: (skin: AvatarSkin) => Promise<unknown> }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    root.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const select = async (skin: AvatarSkin) => {
    setBusy(true); setError("");
    try { await onSelect(skin); setOpen(false); trigger.current?.focus(); }
    catch { setError("Couldn't save your skin. Try again."); }
    finally { setBusy(false); }
  };
  return <div ref={root} className="skin-picker">
    {open && <div className="skin-picker-panel" role="dialog" aria-label="Choose HypeMan skin" id="hypeman-skin-picker">
      <strong>Choose your skin</strong>
      <div className="skin-picker-grid">{AVATAR_SKINS.map(skin => <button key={skin} type="button" aria-label={`Use ${names[skin]} skin`} aria-pressed={settings.avatarSkin === skin} disabled={busy} onClick={() => void select(skin)}>
        <Pet settings={{ ...settings, avatarSkin: skin }} still scale={0.75} /><span>{names[skin]}</span>
      </button>)}</div>
      {error && <p role="alert">{error}</p>}
    </div>}
    <button ref={trigger} className="skin-picker-trigger" type="button" aria-label="Change HypeMan skin" aria-expanded={open} aria-controls={open ? "hypeman-skin-picker" : undefined} onClick={() => setOpen(!open)}>Skins · {names[settings.avatarSkin]}</button>
  </div>;
}
