import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { CharacterAsset } from "@core";
import { request } from "../bridge";
import { Notice } from "./common";
import { Icon } from "./Icon";
import { ToolHeader, WindowBar } from "./ToolChrome";
import { message, useSettings } from "./hooks";
import { Pet } from "./Pet";
import { ArtSprite } from "./ArtSprite";

export function Customize({ embedded = false, active = true }: { embedded?: boolean; active?: boolean } = {}) {
  const { settings, patch } = useSettings();
  const [name, setName] = useState("");
  const [source, setSource] = useState<HTMLImageElement | null>(null);
  const [preview, setPreview] = useState("");
  const [sourcePreview, setSourcePreview] = useState("");
  const [threshold, setThreshold] = useState(35);
  const [removeBackground, setRemoveBackground] = useState(true);
  const [colors, setColors] = useState(8);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [library, setLibrary] = useState<CharacterAsset[]>([]);
  const [palette, setPalette] = useState<string[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { if (!active) abort.current?.abort(); }, [active]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    setName(settings.characterName);
  }, [settings.characterName]);
  const loadLibrary = () =>
    void chrome.storage.local
      .get("burrow.characters")
      .then((data) =>
        setLibrary(Array.isArray(data["burrow.characters"]) ? data["burrow.characters"] : []),
      );
  useEffect(loadLibrary, []);
  useEffect(() => {
    if (!source || !canvas.current) return;
    const output = canvas.current;
    const ctx = output.getContext("2d", { willReadFrequently: true })!;
    ctx.clearRect(0, 0, 64, 58);
    ctx.imageSmoothingEnabled = false;
    const scale = Math.min(58 / source.naturalWidth, 52 / source.naturalHeight) * zoom;
    const w = source.naturalWidth * scale,
      h = source.naturalHeight * scale;
    ctx.drawImage(source, (64 - w) / 2, (58 - h) / 2, w, h);
    const pixels = ctx.getImageData(0, 0, 64, 58),
      d = pixels.data;
    // Flood from the border, so a matching color inside the subject is preserved.
    if (removeBackground) {
      const candidates: number[] = [];
      for (let x = 0; x < 64; x++) candidates.push(x, 57 * 64 + x);
      for (let y = 1; y < 57; y++) candidates.push(y * 64, y * 64 + 63);
      const corner =
        (Math.max(0, Math.floor((58 - h) / 2)) * 64 + Math.max(0, Math.floor((64 - w) / 2))) * 4;
      const bg = [d[corner], d[corner + 1], d[corner + 2]];
      const seen = new Uint8Array(64 * 58);
      let at = 0;
      while (at < candidates.length) {
        const index = candidates[at++];
        if (index < 0 || index >= seen.length || seen[index]) continue;
        seen[index] = 1;
        const p = index * 4;
        if (
          d[p + 3] > 0 &&
          Math.hypot(d[p] - bg[0], d[p + 1] - bg[1], d[p + 2] - bg[2]) > threshold * 2.5
        )
          continue;
        d[p + 3] = 0;
        const x = index % 64,
          y = Math.floor(index / 64);
        if (x > 0) candidates.push(index - 1);
        if (x < 63) candidates.push(index + 1);
        if (y > 0) candidates.push(index - 64);
        if (y < 57) candidates.push(index + 64);
      }
    }
    const step = 255 / Math.max(2, colors - 1);
    for (let p = 0; p < d.length; p += 4)
      for (let c = 0; c < 3; c++) d[p + c] = Math.round(d[p + c] / step) * step;
    ctx.putImageData(pixels, 0, 0);
    setPreview(output.toDataURL("image/png"));
    setStatus("");
  }, [source, threshold, removeBackground, colors, zoom]);
  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) {
      setError("Choose a PNG, JPEG, or WebP image under 10 MB.");
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      setSource(image);
      const thumbnail = document.createElement("canvas");
      const scale = Math.min(1, 480 / Math.max(image.naturalWidth, image.naturalHeight));
      thumbnail.width = Math.max(1, Math.round(image.naturalWidth * scale));
      thumbnail.height = Math.max(1, Math.round(image.naturalHeight * scale));
      thumbnail.getContext("2d")!.drawImage(image, 0, 0, thumbnail.width, thumbnail.height);
      setSourcePreview(thumbnail.toDataURL("image/png"));
      setPalette([]);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setError("That image could not be opened.");
    };
    image.src = url;
  };
  const save = async () => {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const id = crypto.randomUUID();
      await request({
        type: "character.save",
        character: { id, name: name.trim() || "My companion", image: preview },
      });
      await patch({ character: `custom:${id}`, characterName: name.trim() || "My companion" });
      loadLibrary();
      setStatus("Saved. Looking good.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const suggest = async () => {
    const controller = new AbortController(); abort.current?.abort(); abort.current = controller;
    setBusy(true);
    setError("");
    try {
      const result = await request<{
        name: string;
        palette: string[];
        description: string;
        provider: string;
      }>({ type: "api", path: "/api/character", body: { image: preview, description: name } }, controller.signal);
      if (controller.signal.aborted) return;
      if (result.name) setName(result.name);
      setPalette(result.palette.filter((c) => /^#[0-9a-f]{6}$/i.test(c)));
      setStatus(
        `${result.description}${result.provider === "demo" ? " · Demonstration suggestion" : ""}`,
      );
    } catch (e) {
      if (!controller.signal.aborted) setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`tool-page studio customize-studio ${embedded ? "embedded-studio" : ""}`}>
      {!embedded && <ToolHeader title="Mascot maker" icon="spark" />}
      <main className="tool-main">
        <div className="studio-heading">
          <div>
            <span className="eyebrow">PERSONALIZE / 03</span>
            <h1>Very you.</h1>
          </div>
          <span className="studio-keyhint">MAKE YOUR OWN ICON</span>
        </div>
        <div className="customize-grid">
          <section className="surface studio-window customize-source">
            <WindowBar title="Source.image" icon="image" />
            <div className="studio-window-body">
              <label className={`upload-area ${source ? "has-source" : ""}`}>
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} />
                {source ? (
                  <img src={sourcePreview} alt="Uploaded source" />
                ) : (
                  <div className="upload-symbol">
                    <Icon name="image" />
                    <Icon name="plus" />
                  </div>
                )}
                <strong>{source ? "Replace image" : "Bring your own face"}</strong>
                <small>PNG · JPEG · WEBP / 10 MB</small>
              </label>
              <label className="field">
                Companion name
                <input
                  maxLength={60}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Give it a name"
                />
              </label>
              <details className="studio-details character-adjust">
                <summary>
                  <Icon name="settings" />
                  Fine-tune
                  <Icon name="plus" />
                </summary>
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={removeBackground}
                    onChange={(e) => setRemoveBackground(e.target.checked)}
                  />
                  Remove background
                </label>
                <label className="slider-field">
                  Cutout <output>{threshold}</output>
                  <input
                    aria-label="Background tolerance"
                    type="range"
                    min="0"
                    max="100"
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    disabled={!removeBackground || !source}
                  />
                </label>
                <label className="slider-field">
                  Palette <output>{colors}</output>
                  <input
                    aria-label="Color detail"
                    type="range"
                    min="3"
                    max="16"
                    value={colors}
                    onChange={(e) => setColors(Number(e.target.value))}
                    disabled={!source}
                  />
                </label>
                <label className="slider-field">
                  Scale <output>{Math.round(zoom * 100)}%</output>
                  <input
                    aria-label="Character size"
                    type="range"
                    min=".5"
                    max="1.8"
                    step=".05"
                    value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))}
                    disabled={!source}
                  />
                </label>
              </details>
              <div className="reset-character">
                <button
                  className="text-button"
                  onClick={() =>
                    void patch({ character: "hypeman" })
                      .then(() => setStatus("Default mascot restored."))
                      .catch((e) => setError(message(e)))
                  }
                >
                  <Icon name="rewind" />
                  Reset mascot
                </button>
              </div>
            </div>
          </section>
          <section className="surface studio-window preview-surface">
            <WindowBar title="Preview.exe" icon="monitor" />
            <div className="character-preview">
              <div className="preview-orbit" aria-hidden="true" />
              <canvas
                ref={canvas}
                width="64"
                height="58"
                style={{ display: source ? "block" : "none" }}
                aria-label="Pixel companion preview"
              />
              {!source && <Pet settings={settings} scale={3} />}
              <ArtSprite name="sparkle" width={45} className="preview-spark" />
              <span className="preview-stamp" aria-hidden="true">
                100% YOU
              </span>
            </div>
            <div className="studio-window-body">
              <div className="character-save-row">
                <button
                  className="button primary"
                  aria-label="Save & use companion"
                  disabled={!preview || busy}
                  onClick={() => void save()}
                >
                  <Icon name="check" />
                  {busy ? "Saving…" : "Use this"}
                </button>
                <button
                  className="icon-button"
                  aria-label="Suggest a name & palette"
                  title="Ask your paired service for a name and palette. Sends this preview only."
                  disabled={!preview || busy}
                  onClick={() => void suggest()}
                >
                  <Icon name="spark" />
                </button>
                {preview && (
                  <a
                    className="icon-button"
                    href={preview}
                    download={`${name || "companion"}.png`}
                    aria-label="Download pixel PNG"
                    title="Download PNG"
                  >
                    <Icon name="download" />
                  </a>
                )}
              </div>
              <span className="studio-privacy">
                <Icon name="shield" />
                Made & saved locally
              </span>
              {palette.length > 0 && (
                <div className="palette" aria-label="Suggested palette">
                  {palette.map((color) => (
                    <span key={color} title={color} style={{ background: color }} />
                  ))}
                </div>
              )}
              <Notice tone="error">{error}</Notice>
              <Notice tone="success">{status}</Notice>
            </div>
          </section>
        </div>
        {library.length > 0 && (
          <section className="surface studio-window character-library">
            <WindowBar title="Your collection" icon="image" />
            <div className="character-shelf">
              {library.map((character) => (
                <button
                  key={character.id}
                  className={settings.character === `custom:${character.id}` ? "selected" : ""}
                  aria-label={`Use ${character.name}`}
                  aria-pressed={settings.character === `custom:${character.id}`}
                  onClick={() =>
                    void patch({
                      character: `custom:${character.id}`,
                      characterName: character.name,
                    }).catch((e) => setError(message(e)))
                  }
                >
                  <img src={character.image} alt="" width="128" height="116" />
                  <strong>{character.name}</strong>
                  {settings.character === `custom:${character.id}` && <Icon name="check" />}
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
