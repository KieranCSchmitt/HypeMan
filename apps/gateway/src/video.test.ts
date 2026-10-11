import { describe, expect, it, vi } from "vitest";
import type { GatewayConfig } from "./config";
import type { Providers } from "./providers";
import { validateRoute } from "./validation";
import { VIDEO_CAPTION_BYTES, VIDEO_CONTEXT_BYTES, video, youtubeId } from "./video";

const id = "aB3dE5gH7_j";
const url = `https://www.youtube.com/watch?v=${id}`;
const config: GatewayConfig = {
  port: 0, demo: false, model: "test", transcriptKey: "transcript-test-key", deadlineMs: 12_345,
};
const providers = (live = false) => ({
  hasTextProvider: live,
  provider: "openai",
  json: vi.fn(async () => ({ summary: "A summary of the supplied words.", notes: [] })),
}) as unknown as Providers;
const noNetwork = () => vi.fn<typeof fetch>(async () => { throw new Error("Unexpected network request"); });
const run = (input: Record<string, unknown>, fetcher = noNetwork(), settings = config, model = providers()) =>
  video(input, model, settings, new AbortController().signal, fetcher);

describe("video URL validation", () => {
  it.each([
    url,
    `https://m.youtube.com/watch?v=${id}&t=10`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?t=20`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `https://youtube.com/shorts/${id}/`,
    `https://youtube.com/live/${id}`,
  ])("recognizes a video at %s", (value) => expect(youtubeId(value)).toBe(id));

  it.each([
    undefined, null, "", "not a URL", "https://youtube.com/watch", "https://youtu.be/short",
    `ftp://youtube.com/watch?v=${id}`, `https://youtube.com.evil.test/watch?v=${id}`,
    `https://user:password@youtube.com/watch?v=${id}`, `https://youtube.com:8080/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&v=aaaaaaaaaaa`, `https://youtu.be/${id}/extra`,
    `https://youtube.com/embed/${id}!`,
  ])("rejects an unsupported or malformed URL %s without throwing", (value) =>
    expect(youtubeId(value)).toBeNull());
});

describe("caption ingestion", () => {
  it("uses validated native captions before any transcript service", async () => {
    const fetcher = noNetwork();
    const result = await run({ url, segments: [
      { start: 4, end: 6, text: "  <b>Later</b>   caption. " },
      { start: 0, end: 3, text: "Opening caption." },
      { start: 0, end: 3, text: "Opening caption." },
      { start: 1, end: 0, text: "Backwards timing" },
      { start: -1, end: 3, text: "Negative timing" },
      { start: 0, end: 3, text: 42 },
      null,
    ] }, fetcher);
    expect(result).toMatchObject({ available: true, source: "page", provider: "local" });
    expect(result.segments).toEqual([
      { start: 0, end: 3, text: "Opening caption." },
      { start: 4, end: 6, text: "Later caption." },
    ]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("adapts service data and discards malformed cues without inventing captions", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ content: [
      { text: "Second cue.", offset: 2500, duration: 1500 },
      { text: "First cue.", offset: 0, duration: 2000 },
      { text: "Missing duration", offset: 100 },
      { text: "Negative", offset: -1, duration: 10 },
      { text: "String offset", offset: "100", duration: 10 },
      { text: 123, offset: 0, duration: 10 },
      { text: "<i></i>", offset: 0, duration: 10 },
      null,
    ] }));
    const result = await run({ url }, fetcher);
    expect(result.source).toBe("service");
    expect(result.segments).toEqual([
      { start: 0, end: 2, text: "First cue." },
      { start: 2.5, end: 4, text: "Second cue." },
    ]);
    const [target, options] = fetcher.mock.calls[0];
    expect(String(target)).toBe(`https://api.supadata.ai/v1/youtube/transcript?videoId=${id}&lang=en`);
    expect(options?.headers).toEqual({ "x-api-key": config.transcriptKey });
  });

  it("keeps later captions available to the UI while bounding inference context, including Unicode and escaping", async () => {
    const model = providers(true);
    const context = { title: "A video title", question: "Explain the captured portion." };
    const input = { url, ...context, chapters: [{ start: 0, title: "Opening" }, { start: 499, title: "Later chapter" }], segments: Array.from({ length: 500 }, (_, start) => ({
      start, end: start + 1, text: 'A caption with "quotes", \\ and 🐸. '.repeat(10),
    })) };
    const result = await run(input, noNetwork(), config, model);
    expect(result.segments).toEqual(input.segments.map((cue) => ({ ...cue, text: cue.text.trim() })));
    expect(result.segments.at(-1)?.start).toBe(499);
    expect(result.chapters).toEqual(input.chapters);
    const supplied = vi.mocked(model.json).mock.calls[0][1];
    expect(supplied).toMatchObject(context);
    const modelCaptions = (supplied as { segments: { start: number; text: string }[] }).segments;
    expect(modelCaptions.length).toBeGreaterThan(0);
    expect(modelCaptions.length).toBeLessThan(result.segments.length);
    expect(modelCaptions.at(-1)?.start).toBeLessThan(499);
    for (const cue of modelCaptions)
      expect(result.segments.find((original) => original.start === cue.start)?.text.startsWith(cue.text)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(supplied))).toBeLessThanOrEqual(VIDEO_CONTEXT_BYTES);
  });

  it("retains a grounded excerpt when one service cue exceeds the retained transcript budget", async () => {
    const text = "Actual caption words. ".repeat(20_000);
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ content: [{ text, offset: 0, duration: 1000 }] }));
    const result = await run({ url }, fetcher);
    expect(result.available).toBe(true);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text.length).toBeLessThan(text.length);
    expect(text.startsWith(result.segments[0].text)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result.segments))).toBeLessThanOrEqual(VIDEO_CAPTION_BYTES);
  });

  it("limits incoming caption payload size rather than assuming a cue count", () => {
    const tinyCues = Array.from({ length: 6001 }, () => ({ start: 0, end: 1, text: "a" }));
    expect(() => validateRoute("/api/video", { url, segments: tinyCues })).not.toThrow();
    const oversized = Array.from({ length: 200 }, (_, start) => ({ start, end: start + 1, text: "x".repeat(2000) }));
    expect(() => validateRoute("/api/video", { url, segments: oversized })).toThrow();
  });
});

describe("transcript absence and cancellation", () => {
  it.each([206, 404])("reports missing service captions for HTTP %i", async (status) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("", { status }));
    expect(await run({ url }, fetcher)).toMatchObject({
      available: false, segments: [], notes: [], source: "none", provider: "local",
    });
  });

  it.each([{}, { content: "plain text without timestamps" }, { content: [null, { text: "Invalid" }] }])(
    "reports malformed service data as unavailable: %j", async (payload) => {
      const fetcher = vi.fn<typeof fetch>(async () => Response.json(payload));
      expect(await run({ url }, fetcher)).toMatchObject({ available: false, segments: [], source: "none" });
    },
  );

  it("keeps service errors distinct from caption absence", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("", { status: 503 }));
    await expect(run({ url }, fetcher)).rejects.toMatchObject({ status: 502 });
  });

  it("reports unreadable service responses as provider failures", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("not JSON"));
    await expect(run({ url }, fetcher)).rejects.toMatchObject({ status: 502 });
  });

  it.each([
    { url: "malformed" },
    { url: "https://example.com/video" },
  ])("does not contact a transcript service for %j", async (input) => {
    const fetcher = noNetwork();
    expect(await run(input, fetcher)).toMatchObject({ available: false, source: "none" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not use the service in demo mode or without a configured key", async () => {
    const fetcher = noNetwork();
    for (const settings of [{ ...config, demo: true }, { ...config, transcriptKey: "" }])
      expect(await run({ url }, fetcher, settings)).toMatchObject({ available: false, source: "none" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("honors cancellation before any work", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Cancelled by the user", "AbortError");
    controller.abort(reason);
    const fetcher = noNetwork();
    await expect(video({ url }, providers(), config, controller.signal, fetcher)).rejects.toBe(reason);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not publish a late service response after cancellation", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Cancelled by the user", "AbortError");
    const fetcher = vi.fn<typeof fetch>(async () => {
      controller.abort(reason);
      return Response.json({ content: [{ text: "Late caption", offset: 0, duration: 1000 }] });
    });
    await expect(video({ url }, providers(), config, controller.signal, fetcher)).rejects.toBe(reason);
  });

  it("does not publish a late model summary after cancellation", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Cancelled by the user", "AbortError");
    const model = providers(true);
    vi.mocked(model.json).mockImplementation(async () => {
      controller.abort(reason);
      return { summary: "Late summary", notes: [] };
    });
    await expect(video({ url, segments: [{ start: 0, end: 1, text: "Visible caption" }] },
      model, config, controller.signal, noNetwork())).rejects.toBe(reason);
  });

  it("uses the configured request deadline for transcript work", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      await run({ url }, vi.fn<typeof fetch>(async () => new Response("", { status: 404 })));
      expect(timeout).toHaveBeenCalledWith(config.deadlineMs);
    } finally {
      timeout.mockRestore();
    }
  });
});
