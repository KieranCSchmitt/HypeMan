// @vitest-environment jsdom
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@core";
import { Video, type NativeVideoState } from "../apps/extension/src/ui/Video";
import { request } from "../apps/extension/src/bridge";
const state = vi.hoisted(() => ({ handler: null as null | ((operation: string, args: Record<string, unknown>) => Promise<unknown>), select: vi.fn() }));
vi.mock("../apps/extension/src/bridge", () => ({ request: vi.fn() }));
vi.mock("../apps/extension/src/ui/hooks", () => ({ useSettings: () => ({ settings: DEFAULT_SETTINGS }), message: (error: unknown) => error instanceof Error ? error.message : String(error) }));
vi.mock("../apps/extension/src/ui/WorkbenchContext", () => ({ useWorkbench: () => ({ conversationId: "video-test", selected: null, selectContent: state.select }), useToolHandler: (_tool: string, handler: typeof state.handler) => { state.handler = handler; } }));
const VideoComponent = Video as ComponentType<NonNullable<Parameters<typeof Video>[0]>>;
let root: Root, container: HTMLDivElement;
const native: NativeVideoState = { id: "page-player", title: "Page lesson", time: 14, duration: 120, paused: false, rate: 1, available: true, summary: "Balance both sides of the equation.", chapters: [{ start: 12, title: "Balance the equation" }], segments: [{ start: 12, end: 18, text: "Apply the same operation to both sides." }] };
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.mocked(request).mockReset().mockResolvedValue(null); state.select.mockReset(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("native page video in the conversation workbench", () => {
  it("shows the native analysis and seeks the original player from selected content", async () => {
    const seek = vi.fn(); await act(async () => root.render(createElement(VideoComponent, { nativeState: native, onSeek: seek })));
    expect(container.textContent).toContain(native.title); expect(container.textContent).toContain(native.summary);
    expect(container.querySelector("video")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>(".chapter-list button")!.click());
    expect(seek).toHaveBeenCalledWith(12); expect(state.select).toHaveBeenCalledWith(expect.objectContaining({ kind: "video", text: "Balance the equation" }));
    expect(container.querySelector(".transcript .current")?.textContent).toContain("Apply the same operation");
  });
  it("routes native questions and playback commands to the page runtime", async () => {
    const command = vi.fn().mockResolvedValue("Page video paused."); await act(async () => root.render(createElement(VideoComponent, { nativeState: native, onNativeCommand: command })));
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Pause video"]')!.click(); await state.handler!("ask", { question: "Why both sides?" }); });
    expect(command.mock.calls).toEqual([["pause", {}], ["ask", { question: "Why both sides?" }]]);
    expect(vi.mocked(request).mock.calls.some(([input]) => input.type === "api")).toBe(false);
  });
  it("pauses local playback when the conversation is hidden or cancelled", async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    await act(async () => root.render(createElement(VideoComponent, {})));
    await act(async () => { await state.handler!("open", { url: "https://example.com/lesson.mp4" }); });
    expect(container.querySelector("video")).not.toBeNull();
    await act(async () => window.dispatchEvent(new Event("hypeman.cancel-tools")));
    expect(pause).toHaveBeenCalledOnce();
  });
  it("flushes pending caption edits when leaving the conversation before autosave runs", async () => {
    vi.useFakeTimers(); await act(async () => root.render(createElement(VideoComponent, {})));
    await act(async () => { await state.handler!("captions", { text: "The last edit before leaving." }); });
    await act(async () => root.unmount());
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: "artifact.put", kind: "video", value: expect.objectContaining({ captionText: "The last edit before leaving." }) }));
  });
  it("attaches and removes supplied captions through the native runtime", async () => {
    const captions = vi.fn(); await act(async () => root.render(createElement(VideoComponent, { nativeState: native, onCaptionsChange: captions })));
    const source = "WEBVTT\n\n00:00:12.000 --> 00:00:18.000\nApply the same operation to both sides.";
    await act(async () => { await state.handler!("captions", { text: source }); await state.handler!("remove-captions", {}); });
    expect(captions.mock.calls).toEqual([[source], [""]]);
  });
});
