// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserTask } from "@core";
import atlas from "../../public/assets/y2k/hypeman-atlas.json";
import { Pet } from "./Pet";
import { useAvatarAnimation, type AvatarActivity, type AvatarAnimation } from "./useAvatarAnimation";

let root: Root, container: HTMLDivElement;
let controller: ReturnType<typeof useAvatarAnimation>;
const duration = (state: AvatarAnimation) => atlas.animations[state].frames.reduce((sum, frame) => sum + frame.duration, 0);
const pet = () => container.querySelector<HTMLElement>(".hypeman-pet")!;
const state = () => pet().dataset.state;
const frame = () => Number(pet().dataset.frame);
const tick = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
const renderPet = (props: Parameters<typeof Pet>[0] = {}) => act(async () => root.render(createElement(Pet, props)));
function Avatar(props: Parameters<typeof useAvatarAnimation>[0]) {
  controller = useAvatarAnimation(props);
  return createElement(Pet, controller);
}
const renderAvatar = (activity: AvatarActivity = { phase: "idle" }, open = false, dragging = false) =>
  act(async () => root.render(createElement(Avatar, { activity, open, dragging })));
const task = (changes: Partial<BrowserTask> = {}): BrowserTask => ({
  id: "project", goal: "Learn", status: "running", steps: [{ id: "one", title: "Read", status: "doing" }],
  lastPage: null, nextStep: "Read", createdAt: 1, updatedAt: 1, tabId: 1, ...changes,
});
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("chrome", { runtime: { getURL: (path: string) => `chrome-extension://test/${path}` } });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("sprite playback", () => {
  it.each(Object.keys(atlas.animations) as AvatarAnimation[])("plays every authored frame of %s at its own duration", async (animation) => {
    await renderPet({ state: animation });
    expect(state()).toBe(animation); expect(frame()).toBe(0);
    const frames = atlas.animations[animation].frames;
    for (let index = 0; index < frames.length - 1; index++) {
      await tick(frames[index].duration - 1); expect(frame()).toBe(index);
      await tick(1); expect(frame()).toBe(index + 1);
      expect(pet().firstElementChild?.getAttribute("style")).toContain(`background-position: ${-frames[index + 1].x * 2}px ${-frames[index + 1].y * 2}px`);
    }
    await tick(frames.at(-1)!.duration);
    expect(frame()).toBe(0);
    expect(state()).toBe(atlas.animations[animation].loop ? animation : "idle");
  });
  it("completes once and restarts the same reaction with a fresh key", async () => {
    const onComplete = vi.fn();
    await renderPet({ state: "greet", animationKey: 1, onComplete });
    await tick(duration("greet")); expect(onComplete).toHaveBeenCalledTimes(1); expect(state()).toBe("idle");
    await tick(10_000); expect(onComplete).toHaveBeenCalledTimes(1);
    await renderPet({ state: "greet", animationKey: 2, onComplete });
    expect(state()).toBe("greet"); expect(frame()).toBe(0);
    await tick(duration("greet")); expect(onComplete).toHaveBeenCalledTimes(2);
  });
  it("pauses in a hidden tab and resumes the remaining frame time", async () => {
    const onComplete = vi.fn();
    await renderPet({ state: "greet", onComplete }); await tick(50);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await tick(10_000); expect(frame()).toBe(0); expect(onComplete).not.toHaveBeenCalled();
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await tick(69); expect(frame()).toBe(0);
    await tick(1); expect(frame()).toBe(1);
    await tick(duration("greet") - 120); expect(onComplete).toHaveBeenCalledOnce();
  });
  it("keeps reduced-motion poses static and still finishes one-time reactions", async () => {
    const onComplete = vi.fn();
    await renderPet({ state: "thinking", still: true }); await tick(10_000); expect(frame()).toBe(0);
    await renderPet({ state: "point", still: true, once: true, onComplete });
    await tick(duration("point") - 1); expect(frame()).toBe(0); expect(state()).toBe("point");
    await tick(1); expect(state()).toBe("idle"); expect(onComplete).toHaveBeenCalledOnce();
  });
  it("respects the system and explicit reduced-motion preferences", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    await renderPet({ state: "walk" }); await tick(1000); expect(frame()).toBe(0);
    const { DEFAULT_SETTINGS } = await import("@core");
    await renderPet({ state: "walk", settings: { ...DEFAULT_SETTINGS, reducedMotion: "off" } });
    await tick(120); expect(frame()).toBe(1);
  });
});

describe("avatar reactions", () => {
  it("greets on open, waves on close, and returns to idle after each", async () => {
    const activity: AvatarActivity = { phase: "idle" };
    await renderAvatar(activity); expect(state()).toBe("idle");
    await renderAvatar(activity, true); expect(state()).toBe("greet");
    const oldComplete = controller.onComplete;
    await renderAvatar(activity, false); expect(state()).toBe("wave");
    await act(async () => oldComplete()); expect(state()).toBe("wave");
    await tick(duration("wave")); expect(state()).toBe("idle");
    await renderAvatar(activity, true); expect(state()).toBe("greet");
    await tick(duration("greet")); expect(state()).toBe("idle");
  });
  it("prioritizes work, confirmation, and errors without celebrating a stopped request", async () => {
    await renderAvatar({ phase: "idle" }, true); expect(state()).toBe("greet");
    await renderAvatar({ phase: "thinking" }, true); expect(state()).toBe("thinking");
    await renderAvatar({ phase: "point" }, true); await tick(10_000); expect(state()).toBe("point");
    await renderAvatar({ phase: "confused" }, true); expect(state()).toBe("confused");
    await renderAvatar({ phase: "idle" }, true); expect(state()).toBe("idle");
  });
  it("points once for a new hint, and walks only during a drag", async () => {
    await renderAvatar();
    const activity: AvatarActivity = { phase: "idle", hintId: "hint-one" };
    await renderAvatar(activity); expect(state()).toBe("point");
    await tick(duration("point")); expect(state()).toBe("idle");
    await renderAvatar({ ...activity }); expect(state()).toBe("idle");
    await renderAvatar(activity, false, true); expect(state()).toBe("walk");
    await renderAvatar(activity); expect(state()).toBe("idle");
  });
  it("hypes a new milestone and celebrates completed projects after active work settles", async () => {
    const original = task(), advanced = task({ steps: [{ ...original.steps[0], status: "done" }] });
    await renderAvatar({ phase: "idle", task: original });
    await renderAvatar({ phase: "idle", task: advanced }); expect(state()).toBe("hype");
    await tick(duration("hype")); expect(state()).toBe("idle");
    const completed = task({ ...advanced, status: "completed" });
    await renderAvatar({ phase: "thinking", task: completed }); expect(state()).toBe("thinking");
    await renderAvatar({ phase: "idle", task: completed }); expect(state()).toBe("celebrate");
    await tick(duration("celebrate")); expect(state()).toBe("idle");
  });
  it("does not celebrate restored history, a different conversation, or a cancelled project", async () => {
    const completed = task({ status: "completed" });
    await renderAvatar({ phase: "idle", conversationId: "old", task: completed }); expect(state()).toBe("idle");
    await renderAvatar({ phase: "idle", conversationId: "new", task: { ...completed, id: "other" } }); expect(state()).toBe("idle");
    await renderAvatar({ phase: "thinking", conversationId: "new", task: task() });
    await renderAvatar({ phase: "idle", conversationId: "new", task: task({ status: "cancelled" }) }); expect(state()).toBe("idle");
  });
  it("celebrates each successful finish token once", async () => {
    await renderAvatar();
    await renderAvatar({ phase: "idle", celebration: "first" }); expect(state()).toBe("celebrate");
    await tick(duration("celebrate"));
    await renderAvatar({ phase: "idle", celebration: "first" }); expect(state()).toBe("idle");
    await renderAvatar({ phase: "idle", celebration: "second" }); expect(state()).toBe("celebrate");
  });
  it("becomes sleepy, then AFK, and wakes immediately on user input", async () => {
    await renderAvatar();
    await tick(60_000); expect(state()).toBe("sleepy");
    await tick(60_000); expect(state()).toBe("afk");
    await act(async () => window.dispatchEvent(new Event("pointermove"))); expect(state()).toBe("idle");
    await tick(59_999); expect(state()).toBe("idle");
    await renderAvatar({ phase: "thinking" }); await tick(120_000); expect(state()).toBe("thinking");
  });
});
