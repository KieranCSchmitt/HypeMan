// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DEFAULT_SETTINGS, type ChatGPTStatus, type Health } from "@core";
import { Onboarding } from "../apps/extension/src/ui/Onboarding";
import { request } from "../apps/extension/src/bridge";
import { useSettings } from "../apps/extension/src/ui/hooks";

vi.mock("../apps/extension/src/bridge", () => ({ request: vi.fn() }));
vi.mock("../apps/extension/src/ui/Pet", () => ({ Pet: () => null }));
vi.mock("../apps/extension/src/ui/hooks", () => ({
  useSettings: vi.fn(),
  setScreenshotAccess: vi.fn(),
  message: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));
let root: Root, container: HTMLDivElement, health: Health;
const patch = vi.fn();
const status: ChatGPTStatus = {
  connected: false,
  sharing: false,
  pending: false,
  activeProfileId: null,
  profiles: [],
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => `chrome-extension://hypeman/${path}` },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  health = {
    ok: true,
    version: "0.2.0",
    demoMode: false,
    authRequired: true,
    capabilities: { agent: { available: false, mode: "unavailable" } },
  };
  patch.mockReset().mockResolvedValue(DEFAULT_SETTINGS);
  vi.mocked(useSettings).mockReturnValue({ settings: DEFAULT_SETTINGS, patch, error: "" });
  vi.mocked(request)
    .mockReset()
    .mockImplementation(async (message) => {
      if (message.type === "connection.ensure") return health;
      if (message.type === "chatgpt.status") return status;
      return { ok: true };
    });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(createElement(Onboarding)));
}
function button(label: string) {
  return [...container.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
}
describe("HypeMan sign-in onboarding", () => {
  it("offers direct ChatGPT sign-in and keeps connection details collapsed with no secret fields", async () => {
    await render();
    expect(button("Continue with ChatGPT")?.disabled).toBe(false);
    expect(container.textContent).not.toMatch(/pairing|token|paste/i);
    expect(container.querySelector('input[type="password"]')).toBeNull();
    const serverAddress = container.querySelector('input[type="url"]')!;
    expect(serverAddress.closest("details")?.open).toBe(false);
    expect(serverAddress.closest("details")?.querySelector("summary")?.textContent).toContain(
      "Advanced",
    );
  });
  it("allows native tools to be explored without a ChatGPT account and labels local models accurately", async () => {
    await render();
    expect(button("Explore HypeMan")?.disabled).toBe(false);
    expect(button("Use local model")).toBeUndefined();
  });
  it("offers a local model only when the gateway reports one available", async () => {
    health.capabilities.agent = { available: true, mode: "local" };
    await render();
    expect(button("Use local model")?.disabled).toBe(false);
  });
  it("opens demo exploration without requiring ChatGPT sign-in", async () => {
    health.demoMode = true;
    await render();
    expect(button("Explore demo")?.disabled).toBe(false);
    expect(button("Continue with ChatGPT")).toBeUndefined();
  });
  it("reconnects a changed local address without asking for a key", async () => {
    await render();
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(patch).toHaveBeenCalledWith({ serverUrl: DEFAULT_SETTINGS.serverUrl });
    expect(request).toHaveBeenCalledWith({ type: "connection.ensure" });
  });
});
