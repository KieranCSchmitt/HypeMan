import { afterEach, describe, expect, it, vi } from "vitest";
import { unavailableMessagingStatus } from "@core";
import { createGateway } from "./index";
import { loadConfig } from "./config";
import { GatewayError } from "./errors";
import type { MessagingService } from "./messaging";
import type { ChatGPTAuth } from "./chatgpt-auth";

const token = "hypeman-messaging-gateway-test";
const running: ReturnType<typeof createGateway>[] = [];
afterEach(async () => { await Promise.all(running.splice(0).map((gateway) => gateway.close())); });
function fixture() {
  const state = { ...unavailableMessagingStatus(), configured: true, connected: true, paired: true, ownerPhone: "+12125550123", error: "private-owner-status" };
  return {
    status: vi.fn(() => state),
    route: vi.fn(async (action: string, input: unknown) => {
      if (action === "status") return state;
      if (action === "invalid") throw new GatewayError(400, "Invalid phone request.");
      return { action, input };
    }),
    cancelAI: vi.fn(),
    close: vi.fn(async () => {}),
  };
}
async function start(messaging?: ReturnType<typeof fixture>, chatgpt?: ChatGPTAuth) {
  const gateway = createGateway(loadConfig({ PORT: "0", DEMO_MODE: chatgpt ? "0" : "1" }), {
    token,
    messaging: messaging as unknown as MessagingService | undefined,
    chatgpt,
  });
  running.push(gateway);
  return { gateway, url: `http://127.0.0.1:${await gateway.listen()}` };
}
function post(url: string, action: string, input: unknown = {}, extra: Record<string, string> = {}) {
  return fetch(`${url}/api/messaging/${action}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...extra },
    body: JSON.stringify(input),
  });
}

describe("local phone companion routes", () => {
  it("keeps owner details authenticated and public health limited to capability status", async () => {
    const service = fixture();
    const { url } = await start(service);
    const health = await (await fetch(`${url}/health`)).json();
    expect(health.capabilities.messaging).toMatchObject({ available: true, mode: "live" });
    expect(JSON.stringify(health)).not.toContain("+12125550123");
    expect(JSON.stringify(health)).not.toContain("private-owner-status");
    expect((await post(url, "status", {}, { authorization: "Bearer wrong" })).status).toBe(401);
    expect((await post(url, "status", {}, { origin: "https://evil.example" })).status).toBe(403);
    expect(service.route).not.toHaveBeenCalled();
    expect(await (await post(url, "status")).json()).toMatchObject({ ownerPhone: "+12125550123" });
    expect(service.route).toHaveBeenCalledWith("status", {});
  });

  it("dispatches authenticated messaging inputs before browser route validation", async () => {
    const service = fixture();
    const { url } = await start(service);
    const payload = { phone: "+12125550123" };
    expect(await (await post(url, "pair", payload)).json()).toEqual({ action: "pair", input: payload });
    expect((await post(url, "invalid")).status).toBe(400);
    expect((await fetch(`${url}/api/messaging/status`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(405);
  });

  it("returns an honest unavailable status without instantiating or connecting Photon", async () => {
    const { url } = await start();
    const health = await (await fetch(`${url}/health`)).json();
    expect(health.capabilities.messaging).toMatchObject({ available: false, mode: "unavailable" });
    expect(await (await post(url, "status")).json()).toMatchObject({ configured: false, connected: false, paired: false });
    expect((await post(url, "status", { secret: "forged" })).status).toBe(400);
    expect((await post(url, "pair", { phone: "+12125550123" })).status).toBe(503);
  });

  it("cancels phone inference on account changes and closes the phone service", async () => {
    const service = fixture();
    const chatgpt = { cancel: vi.fn(), select: vi.fn(async () => {}), logout: vi.fn(async () => {}) } as unknown as ChatGPTAuth;
    const { gateway, url } = await start(service, chatgpt);
    for (const [action, input] of [["logout", {}], ["select", { profileId: "profile-two" }]] as const) {
      const response = await fetch(`${url}/api/chatgpt/${action}`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(input),
      });
      expect(response.status).toBe(200);
    }
    expect(service.cancelAI).toHaveBeenCalledTimes(2);
    await gateway.close();
    running.splice(running.indexOf(gateway), 1);
    expect(service.close).toHaveBeenCalledTimes(1);
  });
});
