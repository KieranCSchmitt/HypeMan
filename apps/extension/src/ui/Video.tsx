import { useEffect, useRef, useState } from "react";
import type { TranscriptSegment, VideoState } from "@core";
import { request } from "../bridge";
import { Notice } from "./common";
import { message, useSettings } from "./hooks";
import { useToolHandler, useWorkbench } from "./WorkbenchContext";
interface VideoReply { segments: TranscriptSegment[]; chapters: { start: number; title: string }[]; notes: { start: number; end: number; text: string }[]; summary?: string; available?: boolean; source: string; provider: string }
const timestamp = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
export function parseCaptions(text: string): TranscriptSegment[] {
  const seconds = (value: string) => {
    const parts = value.replace(",", ".").split(":").map(Number);
    return parts.reduce((n, p) => n * 60 + p, 0);
  };
  const segments: TranscriptSegment[] = [];
  for (const block of text.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const timing = lines.findIndex((line) => line.includes("-->"));
    if (timing < 0) continue;
    const match = lines[timing].match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/);
    if (!match) continue;
    const start = seconds(match[1]),
      end = seconds(match[2]),
      content = lines
        .slice(timing + 1)
        .join(" ")
        .replace(/<[^>]*>/g, "")
        .trim();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && content)
      segments.push({ start, end, text: content });
  }
  return segments.slice(0, 3000);
}
export type NativeVideoState = VideoState & { available?: boolean; summary?: string };
export function Video({ embedded = false, active = true, page, onSeek, nativeState, onNativeCommand, onCaptionsChange }: { embedded?: boolean; active?: boolean; page?: { url: string; title: string }; onSeek?: (seconds: number) => void; nativeState?: NativeVideoState | null; onNativeCommand?: (operation: string, args: Record<string, unknown>) => Promise<string | void> | string | void; onCaptionsChange?: (text: string) => Promise<void> | void } = {}) {
  const { settings } = useSettings();
  const workbench = useWorkbench();
  const video = useRef<HTMLVideoElement>(null), objectUrl = useRef(""), abort = useRef<AbortController | null>(null);
  const [src, setSrc] = useState(page?.url || ""), [title, setTitle] = useState(page?.title || "Your video");
  const [captions, setCaptions] = useState<TranscriptSegment[]>([]), [captionText, setCaptionText] = useState("");
  const [time, setTime] = useState(0), [reply, setReply] = useState<VideoReply | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [hydrated, setHydrated] = useState(false), [localFile, setLocalFile] = useState("");
  const key = workbench.conversationId;
  const loadedKey = useRef("");
  const revisions = useRef(new Map<string, number>());
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve()), pendingSave = useRef<(() => void) | null>(null);
  useEffect(() => {
    let disposed = false; loadedKey.current = ""; setHydrated(false); setReply(null); setCaptions([]); setCaptionText(""); setLocalFile(""); setSrc(page?.url || "");
    void request<Record<string, any> | null>({ type: "artifact.get", conversationId: key, kind: "video" }).then((saved) => {
      if (disposed) return; revisions.current.set(key, typeof saved?.revision === "number" ? saved.revision : 0);
      if (saved && typeof saved === "object") {
        if (typeof saved.src === "string" && /^https?:/.test(saved.src)) setSrc(saved.src);
        if (typeof saved.title === "string") setTitle(saved.title);
        if (typeof saved.captionText === "string") setCaptionText(saved.captionText.slice(0, 50000));
        if (Array.isArray(saved.captions)) setCaptions(saved.captions.filter((segment: TranscriptSegment) => segment && typeof segment.text === "string" && Number.isFinite(segment.start) && Number.isFinite(segment.end)).slice(0, 3000));
        if (saved.reply && Array.isArray(saved.reply.notes) && Array.isArray(saved.reply.chapters) && Array.isArray(saved.reply.segments)) setReply(saved.reply);
        if (typeof saved.localFile === "string") setLocalFile(saved.localFile);
      }
      loadedKey.current = key; setHydrated(true);
    }).catch((cause) => { if (!disposed) setError(message(cause)); });
    return () => { disposed = true; abort.current?.abort(); };
  }, [key]);
  useEffect(() => {
    if (!hydrated || loadedKey.current !== key) return;
    pendingSave.current = () => {
      pendingSave.current = null;
      saveQueue.current = saveQueue.current.then(async () => {
        const revision = revisions.current.get(key) || 0;
        await request({ type: "artifact.put", conversationId: key, kind: "video", expectedRevision: revision, value: { revision: revision + 1, src: /^https?:/.test(src) ? src : "", title, captions, captionText, reply, localFile } });
        revisions.current.set(key, revision + 1);
      }).catch((cause) => setError(message(cause)));
    };
    const timer = setTimeout(() => pendingSave.current?.(), 200);
    return () => clearTimeout(timer);
  }, [key, hydrated, src, title, captions, captionText, reply, localFile]);
  useEffect(() => { const cancel = () => { abort.current?.abort(); video.current?.pause(); }; window.addEventListener("hypeman.cancel-tools", cancel); return () => { pendingSave.current?.(); cancel(); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); window.removeEventListener("hypeman.cancel-tools", cancel); }; }, []);
  useEffect(() => { if (!active) { video.current?.pause(); abort.current?.abort(); } }, [active]);
  const analyze = async (question = "") => {
    const controller = new AbortController(); abort.current?.abort(); abort.current = controller; setBusy(true); setError("");
    try {
      const segments = captions.length ? captions : captionText.trim().split(/\n+/).filter(Boolean).flatMap((line) => line.match(/[\s\S]{1,1800}/g) || []).map((text) => ({ start: 0, end: 0, text }));
      const result = await request<VideoReply>({ type: "api", path: "/api/video", body: { url: /^https?:/.test(src) ? src : `${settings.serverUrl}/demo/video/`, title, segments, question } }, controller.signal);
      if (controller.signal.aborted) return;
      setReply(result); return result.summary || "Your chapters and notes are ready.";
    } catch (cause) { if (!controller.signal.aborted) setError(message(cause)); throw cause; }
    finally { if (abort.current === controller) setBusy(false); }
  };
  const seek = (seconds: number) => { const value = Math.max(0, seconds); if (onSeek) onSeek(value); else if (nativeState && onNativeCommand) void Promise.resolve(onNativeCommand("seek", { seconds: value })).catch((cause) => setError(message(cause))); else if (video.current) video.current.currentTime = value; setTime(value); };
  const changeCaptions = async (text: string) => { const parsed = parseCaptions(text); setCaptions(parsed); setCaptionText(parsed.length ? "" : text.slice(0, 50000)); setReply(null); if (nativeState) await onCaptionsChange?.(text); };
  const upload = async (file?: File) => {
    if (!file) return;
    if (/\.(?:srt|vtt|txt)$/i.test(file.name) || /^text\//.test(file.type)) {
      if (file.size > 2 * 1024 * 1024) throw new Error("Choose captions under 2 MB.");
      const text = await file.text();
      await changeCaptions(text); return;
    }
    if (!/^video\//.test(file.type)) throw new Error("Drop a video, VTT/SRT caption file, or transcript.");
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file); setSrc(objectUrl.current); setTitle(file.name); setLocalFile(file.name); setReply(null);
  };
  useToolHandler("video", async (operation, args) => {
    if (operation === "open") {
      if (typeof args.url === "string") { if (!/^https?:/.test(args.url)) throw new Error("Use an ordinary web video URL."); setSrc(args.url); setTitle(String(args.title || "Linked video")); setLocalFile(""); }
      return "Drop a video or captions here. Ask to summarize or explain a point.";
    }
    if (nativeState && onNativeCommand && ["summarize", "ask", "play", "pause", "seek", "speed"].includes(operation)) return onNativeCommand(operation, args);
    if (operation === "summarize" || operation === "ask") return analyze(String(args.question || args.text || ""));
    if (operation === "captions" && args.file instanceof File) { await upload(args.file); return "Captions added."; }
    if (operation === "captions") { await changeCaptions(String(args.text || args.captions || "")); return "Captions added. Ask to summarize when ready."; }
    if (operation === "remove-captions") { await changeCaptions(""); return "Captions removed."; }
    if (operation === "seek") { seek(Number(args.seconds ?? args.value ?? 0)); return `Moved to ${timestamp(Number(args.seconds ?? args.value ?? 0))}.`; }
    if (operation === "play" || operation === "pause") { if (!video.current) throw new Error("Open a local or direct video first, or control the original page’s player."); if (operation === "play") await video.current.play(); else video.current.pause(); return `Video ${operation === "play" ? "playing" : "paused"}.`; }
    if (operation === "speed") { if (!video.current) throw new Error("Open a video first."); video.current.playbackRate = Math.max(.25, Math.min(4, Number(args.rate || args.value || 1))); return "Playback speed changed."; }
    if (operation === "save") {
      const text = String(args.text || workbench.selected?.text || reply?.summary || ""); if (!text) throw new Error("Select a video finding to save.");
      await request({ type: "note.save", note: { text, excerpt: text, url: /^https?:/.test(src) ? src : "", title, origin: { kind: "conversation", conversationId: workbench.conversationId } } }); return "Video note saved.";
    }
    throw new Error("That video action is unavailable.");
  });
  const shownReply = nativeState ? nativeState.summary || nativeState.available === false ? { summary: nativeState.summary, available: nativeState.available, chapters: nativeState.chapters || [], notes: [], provider: "page" } : null : reply;
  const segments = nativeState ? nativeState.segments || captions : captions.length ? captions : reply?.segments || [];
  const chapters = nativeState?.chapters || shownReply?.chapters || [];
  const shownTitle = nativeState?.title || title, shownTime = nativeState?.time ?? time;
  const timed = segments.some((segment) => segment.end > segment.start);
  const select = (text: string, id: string) => workbench.selectContent({ kind: "video", id, title, text, url: /^https?:/.test(src) ? src : undefined });
  return <section className={`video-studio ${embedded ? "embedded-studio" : ""}`} aria-label="Video" aria-busy={busy} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void upload(event.dataTransfer.files[0]).catch((cause) => setError(message(cause))); }}>
    <h2>{shownTitle}</h2><p>{nativeState ? "Playing on this page. Select a chapter or transcript line to seek there; ask to pause, change speed, or explain." : "Drop a video, captions, or transcript. Ask questions in the conversation."}</p><label className="file-button">Choose video or captions<input data-essential="file-picker" type="file" accept="video/*,.vtt,.srt,.txt" onChange={(event) => void upload(event.target.files?.[0]).catch((cause) => setError(message(cause)))} /></label>
    {localFile && !src.startsWith("blob:") && <p>Reattach {localFile} to play it. Its captions and saved analysis are still here.</p>}
    {src && !page && !nativeState && <video ref={video} src={src} controls onTimeUpdate={() => setTime(video.current?.currentTime || 0)} onError={() => setError("This player needs a direct MP4/WebM link or local video. Hosted videos use their original webpage.")} />}
    <label className="field">Captions or transcript<textarea aria-label="Video transcript" rows={5} maxLength={50000} value={captionText || (nativeState?.segments || captions).map((segment) => segment.text).join("\n")} onChange={(event) => { void changeCaptions(event.target.value).catch((cause) => setError(message(cause))); }} /></label>
    {busy && <p role="status">Reading supplied captions…</p>}<Notice tone="error">{error}</Notice><small>Video files stay local. Only supplied captions are sent when you ask for analysis.</small>
    {shownReply && <article className="video-summary" tabIndex={0} onFocus={() => select(shownReply.summary || "", "summary")} onClick={() => select(shownReply.summary || "", "summary")}><h3>{shownReply.provider === "demo" ? "Demonstration response" : "From your captions"}</h3><p>{shownReply.summary || (shownReply.available === false ? "Add captions or a transcript to continue." : "Your chapters and notes are ready.")}</p></article>}
    {!!chapters.length && <div className="chapter-list">{chapters.map((chapter, index) => <button key={index} data-content-action="seek" disabled={!timed} onClick={() => { select(chapter.title, `chapter-${index}`); seek(chapter.start); }}>{timed ? timestamp(chapter.start) : index + 1} · {chapter.title}</button>)}</div>}
    {!!segments.length && <details><summary>Transcript · {segments.length} lines</summary><div className="transcript">{segments.map((segment, index) => <button key={index} data-content-action="seek" disabled={!timed} className={shownTime >= segment.start && shownTime < segment.end ? "current" : ""} onClick={() => { select(segment.text, `segment-${index}`); seek(segment.start); }}><time>{timed ? timestamp(segment.start) : "—"}</time> {segment.text}</button>)}</div></details>}
    {shownReply?.notes.map((note, index) => <article key={index} tabIndex={0} onClick={() => { select(note.text, `note-${index}`); if (timed) seek(note.start); }} onFocus={() => select(note.text, `note-${index}`)}><time>{timed ? timestamp(note.start) : "Untimed note"}</time><p>{note.text}</p></article>)}
  </section>;
}
