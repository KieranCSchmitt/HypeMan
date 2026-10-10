import { useEffect, useRef, useState } from "react";
import { request } from "../bridge";
import { Icon } from "./Icon";
import { Notice } from "./common";
import { message } from "./hooks";

export function Notebook() {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const epoch = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const [image, setImage] = useState("");
  const [live, setLive] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const query = new URLSearchParams(location.search);
  const source = query.get("source") || "";
  const sourceTitle = query.get("title") || "Paper notes";
  const stop = () => {
    epoch.current++;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setLive(false);
  };
  useEffect(() => {
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", hidden);
    const leave = () => { stop(); abort.current?.abort(); };
    window.addEventListener("pagehide", leave);
    return () => { leave(); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", leave); };
  }, []);
  const camera = async () => {
    setError("");
    const attempt = ++epoch.current;
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1400 } }, audio: false });
      if (attempt !== epoch.current || document.hidden) { media.getTracks().forEach((track) => track.stop()); return; }
      stream.current = media;
      video.current!.srcObject = media;
      await video.current!.play();
      setLive(true);
    } catch (e) { stop(); setError(message(e)); }
  };
  const snapshot = () => {
    const source = video.current;
    if (!source?.videoWidth) return;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1400 / Math.max(source.videoWidth, source.videoHeight));
    canvas.width = Math.round(source.videoWidth * scale);
    canvas.height = Math.round(source.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
    setImage(canvas.toDataURL("image/jpeg", .85));
    setText(""); setStatus(""); stop();
  };
  const upload = async (file?: File) => {
    if (!file) return;
    setError("");
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) {
      setError("Choose a PNG, JPEG, or WebP image under 10 MB."); return;
    }
    const url = URL.createObjectURL(file);
    try {
      const bitmap = new Image(); bitmap.src = url; await bitmap.decode();
      if (bitmap.naturalWidth * bitmap.naturalHeight > 50_000_000) throw new Error("Choose a smaller image.");
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1400 / Math.max(bitmap.naturalWidth, bitmap.naturalHeight));
      canvas.width = Math.round(bitmap.naturalWidth * scale); canvas.height = Math.round(bitmap.naturalHeight * scale);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      stop(); setImage(canvas.toDataURL("image/jpeg", .85)); setText(""); setStatus("");
    } catch (e) { setError(message(e)); }
    finally { URL.revokeObjectURL(url); }
  };
  const transcribe = async () => {
    const controller = new AbortController(); abort.current?.abort(); abort.current = controller;
    setBusy(true); setError(""); setStatus("");
    try {
      const result = await request<{ lines: string[]; uncertain: boolean; provider: string }>({ type: "api", path: "/api/notebook", body: { image } }, controller.signal);
      if (controller.signal.aborted) return;
      setText(result.lines.join("\n"));
      setStatus(result.provider === "demo" ? "Demo fixture · this is not a transcription of your image." : result.uncertain ? "Some writing is uncertain. Review and edit it." : "Review the transcription before saving.");
    } catch (e) { if (!controller.signal.aborted) setError(message(e)); }
    finally { if (abort.current === controller) setBusy(false); }
  };
  return <main className="paper-camera">
    <div className="paper-camera-stage">
      <video ref={video} muted playsInline hidden={!live} aria-label="Notebook camera preview" />
      {image && !live && <img src={image} alt="Your paper notes" />}
      {!image && !live && <div className="paper-camera-empty"><Icon name="camera" /><p>Bring your paper notes.</p></div>}
    </div>
    <div className="paper-camera-controls" role="toolbar" aria-label="Paper camera tools">
      <button className="icon-button" aria-label={live ? "Take photo" : "Start camera"} title={live ? "Take photo" : "Start camera"} onClick={() => live ? snapshot() : void camera()}><Icon name="camera" /></button>
      {live && <button className="icon-button" aria-label="Stop camera" title="Stop camera" onClick={stop}><Icon name="stop" /></button>}
      <label className="icon-button file-button" title="Choose a photo"><Icon name="image" /><span className="sr-only">Choose a photo</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void upload(e.target.files?.[0])} /></label>
      <button className="icon-button" aria-label={busy ? "Cancel transcription" : "Read handwriting"} title={busy ? "Cancel transcription" : "Read handwriting"} disabled={!image} onClick={() => busy ? abort.current?.abort() : void transcribe()}><Icon name={busy ? "stop" : "spark"} /></button>
      {text && <button className="icon-button" aria-label="Save transcription to notes" title="Save transcription to notes" disabled={!/^https?:\/\//.test(source)} onClick={() => void request({ type: "note.save", note: { text, excerpt: text, url: source, title: sourceTitle } }).then(() => setStatus("Saved to Notes.")).catch((e) => setError(message(e)))}><Icon name="pin" /></button>}
    </div>
    <Notice tone="error">{error}</Notice><Notice>{status}</Notice>
    {text && <textarea className="paper-transcription" aria-label="Editable transcription" value={text} maxLength={10000} rows={6} onChange={(e) => setText(e.target.value)} />}
    <small className="paper-camera-privacy">Photos stay local until you choose Read handwriting.</small>
  </main>;
}
