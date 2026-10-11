// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@core";
import { Onboarding } from "../apps/extension/src/ui/Onboarding";
import { request } from "../apps/extension/src/bridge";
vi.mock("../apps/extension/src/bridge", () => ({ request: vi.fn(), subscribe: () => () => {} }));
vi.mock("../apps/extension/src/ui/hooks", () => ({ useSettings: () => ({ settings: DEFAULT_SETTINGS, patch: vi.fn(), error: "" }), useReducedMotion: () => true }));
vi.mock("../apps/extension/src/ui/ToolOverlay", () => ({ ToolOverlay: ({ section }: any) => createElement("section", { "data-section": section }, "Connection review") }));
vi.mock("../apps/extension/src/ui/Rooftop", () => ({ Rooftop: ({ onCompanion }: { onCompanion: () => void }) => createElement("div", { "data-rooftop": true }, createElement("button", { onClick: onCompanion }, "Avatar")) }));
vi.mock("../apps/extension/src/ui/Pet", () => ({ Pet: () => createElement("span", null, "Avatar") }));
let root: Root, container: HTMLDivElement, demo: boolean;
beforeEach(() => {
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("chrome", { tabs: {} }); demo = false;
 vi.mocked(request).mockReset().mockImplementation(async (m) => m.type === "conversation.resolve" ? { id: "setup", messages: [] } : m.type === "health" ? { demoMode: demo } : {});
 container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
describe("conversational onboarding", () => {
 it("opens account setup in the avatar conversation over the rooftop", async () => {
  await act(async () => root.render(createElement(Onboarding)));
  expect(container.querySelector("[data-rooftop]")).not.toBeNull();
  expect(container.querySelector<HTMLElement>(".companion-workbench-host")?.hidden).toBe(false);
  expect(container.querySelector('[data-section="connection"]')).not.toBeNull();
  expect(container.querySelectorAll("textarea")).toHaveLength(1);
  expect(container.querySelector('input[type="password"]')).toBeNull();
  expect(container.querySelector("nav")).toBeNull();
 });
 it("dismisses and reopens the same setup conversation through the avatar", async () => {
  await act(async () => root.render(createElement(Onboarding)));
  const host = container.querySelector<HTMLElement>(".companion-workbench-host")!, composer = container.querySelector("textarea");
  await act(async () => container.querySelector<HTMLButtonElement>("[data-rooftop] button")!.click());
  expect(host.hidden).toBe(true);
  await act(async () => container.querySelector<HTMLButtonElement>("[data-rooftop] button")!.click());
  expect(host.hidden).toBe(false); expect(container.querySelector("textarea")).toBe(composer);
 });
 it("keeps chat and PDF attachment available while signed out", async () => {
  await act(async () => root.render(createElement(Onboarding)));
  expect(container.querySelector("textarea")!.disabled).toBe(false);
  expect(container.querySelector('input[type="file"]')).not.toBeNull();
 });
 it("enables local demo operation without a sign-in requirement", async () => {
  demo = true; await act(async () => root.render(createElement(Onboarding)));
  expect(request).toHaveBeenCalledWith({ type: "settings.patch", patch: { onboarded: true } });
 });
 it("preserves real account onboarding until sign-in completes", async () => {
  await act(async () => root.render(createElement(Onboarding)));
  expect(request).toHaveBeenCalledWith({ type: "health" });
  expect(request).not.toHaveBeenCalledWith({ type: "settings.patch", patch: { onboarded: true } });
 });
});
