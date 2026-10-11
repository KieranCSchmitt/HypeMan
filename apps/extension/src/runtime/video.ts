import type { Action, VideoState } from "@core";
/** Exact user media controls are local and deterministic; understanding narration remains explicit. */
export function videoIntent(
  text: string,
  video?: VideoState | null,
): Extract<Action, { type: "video" }> | null {
  if (!video) return null;
  if (/^pause(?: the)?(?: video| player)?[.!]?$/i.test(text.trim()))
    return { type: "video", command: "pause" };
  if (/^(?:play|resume)(?: the)?(?: video| player)?[.!]?$/i.test(text.trim()))
    return { type: "video", command: "play" };
  const relative = text.match(
    /\b(rewind|back|forward|ahead)\b.*?\b(\d+(?:\.\d+)?)\s*(seconds?|minutes?)\b/i,
  );
  if (relative) {
    const amount = Number(relative[2]) * (/minute/i.test(relative[3]) ? 60 : 1);
    return {
      type: "video",
      command: "seek",
      value: Math.max(0, video.time + (/rewind|back/i.test(relative[1]) ? -amount : amount)),
    };
  }
  const seek = text.match(
    /\b(?:seek|jump|go)\b.*?\bto\s+(?:(\d+):(\d{2})(?::(\d{2}))?|(\d+(?:\.\d+)?)\s*(seconds?|minutes?)?)/i,
  );
  if (seek) {
    const value = seek[1]
      ? seek[3]
        ? Number(seek[1]) * 3600 + Number(seek[2]) * 60 + Number(seek[3])
        : Number(seek[1]) * 60 + Number(seek[2])
      : Number(seek[4]) * (/minute/i.test(seek[5] ?? "") ? 60 : 1);
    return { type: "video", command: "seek", value };
  }
  const speed = text.match(/\b(?:speed|rate)\b.*?(\d+(?:\.\d+)?)\s*x?\b/i);
  if (speed)
    return {
      type: "video",
      command: "speed",
      value: Math.max(0.25, Math.min(4, Number(speed[1]))),
    };
  if (/\bchapter\b/i.test(text)) {
    const chapter = video.chapters?.find(
      (chapter) =>
        chapter.title.length > 3 && text.toLowerCase().includes(chapter.title.toLowerCase()),
    );
    if (chapter) return { type: "video", command: "seek", value: chapter.start };
  }
  return null;
}
