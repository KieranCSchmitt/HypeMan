// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execute, type ExecuteContext } from "../apps/extension/src/runtime/executor";
import { PageObserver } from "../apps/extension/src/runtime/page";
import { Highlight } from "../apps/extension/src/runtime/overlay";
import type { RuntimeApi } from "../apps/extension/src/runtime/types";

const originalHitTest = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
let highlights: Highlight[] = [];
beforeEach(() => { document.body.innerHTML = '<button id="target">Compare options</button>'; });
afterEach(() => {
  for (const highlight of highlights.splice(0)) highlight.dispose();
  if (originalHitTest) Object.defineProperty(document, "elementFromPoint", originalHitTest);
  else Reflect.deleteProperty(document, "elementFromPoint");
  vi.restoreAllMocks();
});
function fixture() {
  const host = document.createElement("div"); host.id = "hypeman-companion-v2";
  host.style.setProperty("display", "flex", "important"); document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const composer = document.createElement("textarea"); composer.value = "Keep my draft"; shadow.append(composer);
  const observer = new PageObserver(document, host), highlight = new Highlight(shadow); highlights.push(highlight);
  const request = vi.fn(async () => ({ ok: true }));
  const controller = new AbortController();
  const context: ExecuteContext = { api: { request: request as RuntimeApi["request"], subscribe: () => () => {} }, observer,
    highlight, page: observer.snapshot(), signal: controller.signal, allowed: () => true, reducedMotion: true, trustedInput: true,
    companionHost: host, sketch: vi.fn(), plan: vi.fn(), note: vi.fn(async () => {}) };
  const target = document.getElementById("target")!;
  const hit = vi.fn(() => host.style.display === "none" ? target : host);
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hit });
  return { host, composer, target, request, controller, context, hit };
}
describe("page actions beside the companion", () => {
  it("clicks the observed page control beneath its own panel and restores the panel immediately", async () => {
    const { host, composer, target, context, hit } = fixture();
    composer.focus();
    const clicked = vi.fn(() => {
      expect(host.style.display).toBe("none");
      document.body.dataset.clicked = "yes";
    });
    target.addEventListener("click", clicked);
    const result = await execute({ type: "click", target: context.page.elements[0].id }, context);
    expect(result.ok).toBe(true); expect(clicked).toHaveBeenCalledOnce(); expect(hit).toHaveBeenCalled();
    expect(document.activeElement).toBe(target); expect(composer.value).toBe("Keep my draft");
    expect(host.style.display).toBe("flex"); expect(host.style.getPropertyPriority("display")).toBe("important");
  });
  it.each([false, true])("still rejects a webpage overlay, including an imitated host ID (%s)", async (imitated) => {
    const { host, target, context, hit, request } = fixture();
    const overlay = document.createElement("div"); if (imitated) overlay.id = host.id;
    overlay.style.display = "block"; document.body.append(overlay);
    hit.mockImplementation(() => host.style.display === "none" ? overlay : host);
    const clicked = vi.fn(); target.addEventListener("click", clicked);
    const result = await execute({ type: "click", target: context.page.elements[0].id }, context);
    expect(result).toMatchObject({ ok: false, message: "Another control covers the target. Close it first." });
    expect(clicked).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
    expect(host.style.display).toBe("flex"); expect(overlay.style.display).toBe("block");
  });
  it.each(["success", "abort", "failure"])("restores the host after trusted transport %s", async (outcome) => {
    const { host, target, context, request, controller } = fixture();
    request.mockImplementation(async (...args: unknown[]) => {
      const message = args[0] as { type: string };
      if (message.type === "input") expect(host.style.display).toBe("none");
      if (message.type === "input" && outcome === "abort") { controller.abort(); throw new DOMException("Cancelled", "AbortError"); }
      if (message.type === "input" && outcome === "failure") throw new Error("Input unavailable");
      return { ok: true };
    });
    const clicked = vi.fn(); target.addEventListener("click", clicked);
    const pending = execute({ type: "click", target: context.page.elements[0].id, trusted: true }, context);
    if (outcome === "success") expect((await pending).ok).toBe(true);
    else await expect(pending).rejects.toThrow(outcome === "abort" ? "Cancelled" : "Input unavailable");
    expect(clicked).not.toHaveBeenCalled(); expect(host.style.display).toBe("flex");
    expect(host.style.getPropertyPriority("display")).toBe("important");
  });
  it("does not dispatch untargeted browser keys into the conversation composer", async () => {
    const { composer, context, request } = fixture(); composer.focus();
    const key = vi.fn(); composer.addEventListener("keydown", key);
    const result = await execute({ type: "key", key: "Enter" }, context);
    expect(result.ok).toBe(false); expect(key).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
    expect(composer.value).toBe("Keep my draft");
  });
});
