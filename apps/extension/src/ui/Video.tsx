import { useEffect, useRef, useState } from "react";
import type { TranscriptSegment } from "@core";
import { request } from "../bridge";
import { Notice } from "./common";
import { Icon } from "./Icon";
import { ToolHeader, WindowBar } from "./ToolChrome";
import { message, useSettings } from "./hooks";
import { ArtSprite } from "./ArtSprite";

interface VideoReply {
  segments: TranscriptSegment[];
  chapters: { start: number; title: string }[];
  notes: { start: number; end: number; text: string }[];
  summary?: string;
  available?: boolean;
  source: string;
  provider: string;
}
const timestamp = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
function parseCaptions(text: string): TranscriptSegment[] {
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
export function Video({ embedded = false, active = true, page, onSeek }: { embedded?: boolean; active?: boolean; page?: { url: string; title: string }; onSeek?: (seconds: number) => void } = {}) {
  const { settings } = useSettings();
  const video = useRef<HTMLVideoElement>(null);
  const objectUrl = useRef("");
  const abort = useRef<AbortController | null>(null);
  const [url, setUrl] = useState("");
  const [src, setSrc] = useState(page?.url || "");
  const [title, setTitle] = useState(page?.title || "Your video");
  const [captions, setCaptions] = useState<TranscriptSegment[]>([]);
  const [captionText, setCaptionText] = useState("");
  const [time, setTime] = useState(0);
  const [reply, setReply] = useState<VideoReply | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      abort.current?.abort();
    },
    [],
  );
  useEffect(() => { if (!active) { video.current?.pause(); abort.current?.abort(); } }, [active]);
  const analyze = async () => {
    setBusy(true);
    setError("");
    abort.current?.abort();
    abort.current = new AbortController();
    try {
      const raw = captions.length
        ? captions
        : captionText
            .trim()
            .split(/\n+/)
            .filter(Boolean)
            .flatMap((line) => line.match(/[\s\S]{1,1800}/g) || [])
            .map((text) => ({ start: 0, end: 0, text }));
      const result = await request<VideoReply>(
        {
          type: "api",
          path: "/api/video",
          body: {
            url: /^https?:/.test(src) ? src : `${settings.serverUrl}/demo/video/`,
            title,
            segments: raw,
            question,
          },
        },
        abort.current.signal,
      );
      setReply(result);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const seek = (seconds: number) => {
    if (onSeek) { onSeek(seconds); setTime(seconds); return; }
    if (video.current) {
      video.current.currentTime = seconds;
      setTime(seconds);
    }
  };
  const shown = captions.length ? captions : reply?.segments || [];
  const timed = shown.some((segment) => segment.end > segment.start);
  const available = reply
    ? (reply.available ?? (reply.segments.length > 0 && reply.source !== "none"))
    : false;
  return (
    <div className={`tool-page studio video-studio ${embedded ? "embedded-studio" : ""} ${page ? "page-video" : ""}`}>
      {!embedded && <ToolHeader title="Video lab" icon="video" />}
      <main className="tool-main">
        <div className="studio-heading">
          <div>
            <span className="eyebrow">WATCH / 02</span>
            <h1>Keep the good parts.</h1>
          </div>
          <a
            className="button small"
            href={`${settings.serverUrl}/demo/video/`}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="play" />
            Try demo
          </a>
        </div>
        <div className="video-layout">
          <section>
            <div className="studio-window video-stage">
              <WindowBar title={src ? title : "Player.webm"} icon="video" />
              <div className="video-source">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setSrc(url);
                    setTitle("Linked video");
                    setReply(null);
                    setError("");
                  }}
                >
                  <div className="inline-input">
                    <Icon name="link" />
                    <input
                      aria-label="Direct video URL"
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="Paste a video link"
                      required
                    />
                    <button className="icon-button" aria-label="Open video" title="Open video">
                      <Icon name="arrow" />
                    </button>
                  </div>
                </form>
                <label className="file-button icon-button" title="Choose a local video">
                  <Icon name="plus" />
                  <span className="sr-only">Choose a local video</span>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
                      objectUrl.current = URL.createObjectURL(file);
                      setSrc(objectUrl.current);
                      setTitle(file.name);
                      setReply(null);
                      setError("");
                    }}
                  />
                </label>
              </div>
              <div className="video-player">
                {src ? (
                  <video
                    ref={video}
                    src={src}
                    controls
                    onTimeUpdate={() => setTime(video.current?.currentTime || 0)}
                    onError={() =>
                      setError(
                        "Could not play this file. Try a local video or direct MP4/WebM link.",
                      )
                    }
                  />
                ) : (
                  <div className="video-empty">
                    <ArtSprite name="crt" width={180} className="video-empty-crt" />
                    <h2>Press play on an idea.</h2>
                    <p>Drop in a link or open a video file.</p>
                    <span>MP4 · WEBM · LOCAL FILES</span>
                  </div>
                )}
              </div>
              <div className="canvas-status">
                <span>
                  <i />
                  {src ? "PLAYER READY" : "STANDING BY"}
                </span>
                <span>{src ? timestamp(time) : "00:00"}</span>
              </div>
            </div>
            {reply?.chapters?.length ? (
              <section className="surface studio-window video-chapters">
                <WindowBar title={timed ? "Chapters" : "Transcript outline"} icon="rewind" />
                <div className="chapter-list">
                  {reply.chapters.map((chapter, i) => (
                    <button key={i} disabled={!timed} onClick={() => seek(chapter.start)}>
                      <span>
                        {timed ? timestamp(chapter.start) : String(i + 1).padStart(2, "0")}
                      </span>
                      {chapter.title}
                      {timed && <Icon name="play" />}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
            {shown.length > 0 && (
              <details className="surface studio-window transcript-window">
                <summary>
                  <Icon name="notes" />
                  Transcript<span>{shown.length} lines</span>
                </summary>
                <div className="transcript">
                  {shown.map((segment, i) => (
                    <button
                      key={i}
                      disabled={!timed}
                      className={time >= segment.start && time < segment.end ? "current" : ""}
                      onClick={() => seek(segment.start)}
                    >
                      <time>{timed ? timestamp(segment.start) : "—"}</time>
                      <span>{segment.text}</span>
                    </button>
                  ))}
                </div>
              </details>
            )}
          </section>
          <aside>
            <section className="surface studio-window video-caption-window">
              <WindowBar title="Caption co-pilot" icon="spark" />
              <div className="studio-window-body">
                <div className="caption-header">
                  <h2>What’s the story?</h2>
                  <label className="file-button icon-button" title="Load VTT or SRT captions">
                    <Icon name="plus" />
                    <span className="sr-only">Load VTT or SRT captions</span>
                    <input
                      type="file"
                      accept=".vtt,.srt,text/vtt,text/plain"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 2 * 1024 * 1024) {
                          setError("Choose captions under 2 MB.");
                          return;
                        }
                        const parsed = parseCaptions(await file.text());
                        setCaptions(parsed);
                        setReply(null);
                        setError(
                          parsed.length
                            ? ""
                            : "No timed captions found. Try VTT/SRT, or paste a transcript.",
                        );
                      }}
                    />
                  </label>
                </div>
                {captions.length ? (
                  <div className="captions-loaded">
                    <Icon name="check" />
                    <span>{captions.length} captions loaded</span>
                    <button
                      className="icon-button"
                      aria-label="Remove captions"
                      title="Remove captions"
                      onClick={() => setCaptions([])}
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                ) : (
                  <label className="field">
                    <span className="sr-only">Or paste a transcript</span>
                    <textarea
                      rows={7}
                      maxLength={50000}
                      value={captionText}
                      onChange={(e) => {
                        setCaptionText(e.target.value);
                        setCaptions([]);
                        setReply(null);
                      }}
                      placeholder="Paste captions or a transcript…"
                    />
                  </label>
                )}
                {captionText && (
                  <span className="transcript-timing">
                    Untimed transcript · upload VTT/SRT to seek
                  </span>
                )}
                <label className="field">
                  <span className="sr-only">Ask about the video</span>
                  <input
                    value={question}
                    maxLength={2000}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Ask a question (optional)"
                  />
                </label>
                <div className="row">
                  <button
                    className="button primary"
                    aria-label="Find the thread"
                    disabled={busy}
                    onClick={() => void analyze()}
                  >
                    <Icon name="spark" />
                    {busy ? "Reading…" : question.trim() ? "Ask" : "Summarize"}
                  </button>
                  {busy && (
                    <button
                      className="icon-button"
                      aria-label="Cancel"
                      title="Cancel"
                      onClick={() => abort.current?.abort()}
                    >
                      <Icon name="stop" />
                    </button>
                  )}
                </div>
                <span
                  className="studio-privacy"
                  title="Video files stay local. Only supplied captions are sent to your paired service. Hosted players work through the companion on their original page."
                >
                  <Icon name="shield" />
                  Video stays local
                </span>
                <Notice tone="error">{error}</Notice>
                {reply && (
                  <div className="video-summary" aria-live="polite">
                    <span className="eyebrow">
                      {reply.provider === "demo"
                        ? "Demonstration response"
                        : available
                          ? "From your captions"
                          : "Captions unavailable"}
                    </span>
                    <p>
                      {reply.summary ||
                        (available
                          ? "Your chapters and notes are ready."
                          : "Add captions or a transcript to continue.")}
                    </p>
                    {reply.notes.map((note, i) => (
                      <article key={i}>
                        <div className="row between">
                          <button
                            className="text-button"
                            disabled={!timed}
                            onClick={() => seek(note.start)}
                          >
                            {timed ? timestamp(note.start) : "Untimed note"}
                            {timed && <Icon name="play" />}
                          </button>
                          <button
                            className="icon-button"
                            aria-label="Pin note"
                            title={
                              /^https?:/.test(src) ? "Pin note" : "Pinning needs a web video URL"
                            }
                            disabled={!/^https?:/.test(src)}
                            onClick={() =>
                              void request({
                                type: "note.save",
                                note: {
                                  text: note.text,
                                  excerpt: note.text,
                                  url: src,
                                  title: `${title} · ${timed ? timestamp(note.start) : "transcript note"}`,
                                },
                              })
                                .then(() => setError(""))
                                .catch((e) => setError(message(e)))
                            }
                          >
                            <Icon name="pin" />
                          </button>
                        </div>
                        <p>{note.text}</p>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
