import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "../apps/extension/src/bridge";

afterEach(() => vi.unstubAllGlobals());
describe("background cancellation across the message boundary", () => {
  const respondWith = (response: unknown) => vi.stubGlobal("chrome", { runtime: {
    sendMessage: (_message: unknown, callback: (response: unknown) => void) => callback(response),
  } });
  it("keeps a stopped run distinguishable from a provider failure", async () => {
    respondWith({ ok: false, error: "Stopped request", cancelled: true });
    await expect(request({ type: "agent.decide", requestId: "stopped-test" })).rejects.toMatchObject({ name: "AbortError", message: "Stopped request" });
  });
  it("does not hide genuine gateway errors", async () => {
    respondWith({ ok: false, error: "The provider failed." });
    await expect(request({ type: "agent.decide", requestId: "failed-test" })).rejects.toMatchObject({ name: "Error", message: "The provider failed." });
  });
});
