import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatGPTStatus } from "@core";
import { ChatGPTAuth } from "./chatgpt-auth";
import { createGateway } from "./index";
import { loadConfig } from "./config";

const token = "burrow-chatgpt-test-pairing";
const running: ReturnType<typeof createGateway>[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((gateway) => gateway.close()));
});
function authFixture() {
  let state: ChatGPTStatus = {
    connected: true,
    sharing: true,
    activeProfileId: "profile-one",
    pending: false,
    profiles: [
      {
        id: "profile-one",
        label: "Personal · 1",
        email: "private@example.com",
        connected: true,
        sharing: true,
      },
    ],
  };
  const auth = {
    get sharing() {
      return state.sharing;
    },
    get model() {
      return "gpt-test";
    },
    status: vi.fn(() => structuredClone(state)),
    start: vi.fn(async (_input: unknown, redirectUri: string) => ({
      url: `https://auth.openai.com/api/accounts/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`,
    })),
    callback: vi.fn(async (url: URL) => {
      if (url.searchParams.get("state") !== "valid-state") throw new Error("Invalid state");
    }),
    cancel: vi.fn(),
    select: vi.fn(async () => {}),
    setModel: vi.fn(),
    logout: vi.fn(async () => {
      state = { ...state, connected: false, sharing: false, activeProfileId: null };
    }),
    accessToken: vi.fn(async () => "private-oauth-access-token"),
  };
  return auth;
}
const modelFetch = vi.fn(
  async () =>
    new Response(
      JSON.stringify({
        models: [{ slug: "gpt-test", display_name: "Test model", visibility: "list" }],
      }),
      { headers: { "content-type": "application/json" } },
    ),
) as typeof fetch;
async function start(demo = false) {
  const auth = authFixture();
  const gateway = createGateway(loadConfig({ PORT: "0", DEMO_MODE: demo ? "1" : "0" }), {
    token,
    chatgpt: auth as unknown as ChatGPTAuth,
    fetcher: modelFetch,
  });
  running.push(gateway);
  return { auth, url: `http://127.0.0.1:${await gateway.listen()}` };
}
function post(
  url: string,
  action: string,
  input: unknown = {},
  headers: Record<string, string> = {},
) {
  return fetch(`${url}/api/chatgpt/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(input),
  });
}
describe("paired ChatGPT account routes", () => {
  it("completes real auth state and code exchange through the gateway callback port", async () => {
    const directory = mkdtempSync(join(tmpdir(), "burrow-chatgpt-route-"));
    try {
      const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
        if (String(url).endsWith("/oauth/token")) {
          const form = new URLSearchParams(String(init?.body));
          expect(form.get("client_id")).toBe("oaiapp_burrow_test");
          expect(form.get("code")).toBe("one-time-code");
          expect(form.get("redirect_uri")).toBe(callback);
          return new Response(
            JSON.stringify({
              access_token: "route-access-token",
              id_token: "verified-test-id-token",
              refresh_token: "route-refresh-token",
              token_type: "Bearer",
              expires_in: 3600,
              scope:
                "openid email profile offline_access resource.invoke chatgpt.tokens.use.direct",
            }),
          );
        }
        return modelFetch(String(url), init);
      }) as typeof fetch;
      const auth = new ChatGPTAuth({
        directory,
        fetcher,
        verifyIdentity: async () => ({ subject: "test-subject", email: "local@example.com" }),
      });
      const gateway = createGateway(loadConfig({ PORT: "0" }), { token, chatgpt: auth, fetcher });
      running.push(gateway);
      const url = `http://127.0.0.1:${await gateway.listen()}`;
      const callback = `${url}/auth/callback`;
      const authorize = new URL((await (await post(url, "login")).json()).url);
      expect(authorize.searchParams.get("redirect_uri")).toBe(callback);
      expect(authorize.searchParams.get("client_id")).toBe("dynamic_agent_client");
      expect(authorize.searchParams.get("agent_name_hint")).toBe("HypeMan");
      const returned = new URL(callback);
      returned.search = new URLSearchParams({
        code: "one-time-code",
        state: authorize.searchParams.get("state")!,
        client_id: "oaiapp_burrow_test",
      }).toString();
      const completed = await fetch(returned);
      expect(completed.status).toBe(200);
      const callbackPage = await completed.text();
      expect(callbackPage).toContain("<title>HypeMan · ChatGPT</title>");
      expect(callbackPage).not.toContain("Burrow");
      expect(await (await post(url, "status")).json()).toMatchObject({
        connected: true,
        sharing: true,
        model: "gpt-test",
      });
      expect((await fetch(returned)).status).toBe(400);
      expect(auth.status().sharing).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("keeps account details behind pairing and out of public health", async () => {
    const { url } = await start();
    const health = await (await fetch(`${url}/health`)).text();
    expect(health).not.toContain("private@example.com");
    expect(health).not.toContain("private-oauth-access-token");
    expect((await post(url, "status", {}, { authorization: "Bearer wrong" })).status).toBe(401);
    expect((await post(url, "login", {}, { origin: "https://evil.example" })).status).toBe(403);
    const status = await (await post(url, "status")).json();
    expect(status).toMatchObject({ sharing: true, models: [{ slug: "gpt-test" }] });
    expect(JSON.stringify(status)).not.toContain("private-oauth-access-token");
  });
  it("starts browser sign-in with the exact loopback callback and exposes no credentials", async () => {
    const { url, auth } = await start();
    const result = await (await post(url, "login", { newProfile: true })).json();
    expect(new URL(result.url).searchParams.get("redirect_uri")).toBe(`${url}/auth/callback`);
    expect(auth.start).toHaveBeenCalledWith({ newProfile: true }, `${url}/auth/callback`);
    expect(JSON.stringify(result)).not.toContain("private-oauth-access-token");
    const callback = await fetch(`${url}/auth/callback?state=valid-state&code=secret-code`);
    expect(callback.status).toBe(200);
    expect(await callback.text()).not.toContain("secret-code");
    expect(callback.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(callback.headers.get("content-security-policy")).toContain("font-src 'self'");
    const rejected = await fetch(`${url}/auth/callback?state=wrong&code=secret-code`);
    expect(rejected.status).toBe(400);
    expect(await rejected.text()).not.toContain("secret-code");
  });
  it("validates account actions and keeps demo sign-in isolated", async () => {
    const { url, auth } = await start();
    for (const [action, input] of [
      ["login", { newProfile: "yes" }],
      ["login", { newProfile: true, profileId: "profile-one" }],
      ["select", {}],
      ["model", { model: "bad model" }],
      ["status", { access_token: "secret" }],
    ] as const)
      expect((await post(url, action, input)).status).toBe(400);
    expect(auth.start).not.toHaveBeenCalled();
    expect((await post(url, "unknown")).status).toBe(404);
    await post(url, "cancel");
    expect(auth.cancel).toHaveBeenCalledOnce();
    await post(url, "logout");
    expect(auth.logout).toHaveBeenCalledOnce();
    expect(await (await post(url, "status")).json()).toMatchObject({
      connected: false,
      activeProfileId: null,
    });
    const demo = await start(true);
    expect(await (await post(demo.url, "status")).json()).toMatchObject({
      connected: false,
      profiles: [],
    });
    expect((await post(demo.url, "login")).status).toBe(409);
    expect(demo.auth.start).not.toHaveBeenCalled();
  });
});
