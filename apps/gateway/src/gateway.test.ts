import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRequest } from "@core";
import { HYPEMAN_EXTENSION_ID, HYPEMAN_EXTENSION_KEY, HYPEMAN_EXTENSION_ORIGIN } from "@core";
import manifest from "../../extension/manifest.json";
import { createGateway } from "./index";
import { loadConfig } from "./config";
import { loadPairingToken } from "./security";
const token = "hypeman-integration-token";
const config = (demo = true) => loadConfig({ DEMO_MODE: demo ? "1" : "0", PORT: "0" });
const agentInput = (requestId = "integration-request"): AgentRequest => ({
  requestId,
  goal: "Find a workshop",
  message: "Find a workshop",
  mode: "browse",
  history: [],
  page: {
    url: "https://example.com",
    title: "Example",
    text: "Workshop",
    headings: [],
    elements: [],
    errors: [],
    successes: [],
    selection: "",
    frames: { count: 0, inaccessible: 0 },
    capturedAt: Date.now(),
    revision: 1,
  },
});
const running: ReturnType<typeof createGateway>[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((gateway) => gateway.close()));
});
async function start(
  options: Partial<Parameters<typeof createGateway>[1]> = {},
  demo = true,
  deadlineMs = 38_000,
) {
  const gateway = createGateway({ ...config(demo), deadlineMs }, { token, ...options });
  running.push(gateway);
  const port = await gateway.listen();
  return { gateway, url: `http://127.0.0.1:${port}`, port };
}
const post = (url: string, path: string, input: unknown, extra: Record<string, string> = {}) =>
  fetch(url + path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...extra },
    body: JSON.stringify(input),
  });

describe("local gateway boundary", () => {
  it("pins the gateway connection origin to the manifest's stable public identity", () => {
    expect(manifest.key).toBe(HYPEMAN_EXTENSION_KEY);
    const digest = createHash("sha256")
      .update(Buffer.from(HYPEMAN_EXTENSION_KEY, "base64"))
      .digest()
      .subarray(0, 16);
    const id = [...digest]
      .flatMap((byte) => [
        String.fromCharCode(97 + (byte >> 4)),
        String.fromCharCode(97 + (byte & 15)),
      ])
      .join("");
    expect(id).toBe(HYPEMAN_EXTENSION_ID);
    expect(HYPEMAN_EXTENSION_ORIGIN).toBe(`chrome-extension://${id}`);
  });
  it("connects the first-party extension without a copied token and keeps API auth", async () => {
    const { url } = await start();
    const response = await fetch(url + "/api/connection", {
      method: "POST",
      headers: { "content-type": "application/json", origin: HYPEMAN_EXTENSION_ORIGIN },
      body: "{}",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(HYPEMAN_EXTENSION_ORIGIN);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ token });
    const unauthenticated = await fetch(url + "/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json", origin: HYPEMAN_EXTENSION_ORIGIN },
      body: JSON.stringify(agentInput()),
    });
    expect(unauthenticated.status).toBe(401);
    expect(
      (await post(url, "/api/agent", agentInput(), { origin: HYPEMAN_EXTENSION_ORIGIN })).status,
    ).toBe(200);
  });
  it("never reveals the connection token to missing, web, or other extension origins", async () => {
    const { url } = await start();
    for (const origin of [
      undefined,
      "null",
      url,
      "http://localhost:8787",
      "https://evil.example",
      `chrome-extension://${"a".repeat(32)}`,
      `${HYPEMAN_EXTENSION_ORIGIN}.evil.example`,
      `${HYPEMAN_EXTENSION_ORIGIN}/`,
    ]) {
      for (const method of ["POST", "OPTIONS"] as const) {
        const response = await fetch(url + "/api/connection", {
          method,
          headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
          ...(method === "POST" ? { body: "{}" } : {}),
        });
        expect(response.status, `${method} from ${origin}`).toBe(403);
        expect(await response.text()).not.toContain(token);
        expect(response.headers.get("access-control-allow-origin")).toBeNull();
      }
    }
  });
  it("validates the connection method, JSON type, body schema, and small payload limit", async () => {
    const { url } = await start();
    const headers = { origin: HYPEMAN_EXTENSION_ORIGIN, "content-type": "application/json" };
    expect((await fetch(url + "/api/connection", { headers })).status).toBe(405);
    expect((await fetch(url + "/api/connection", { method: "OPTIONS", headers })).status).toBe(204);
    for (const malformed of ["{", "null", "[]", "true", '"x"', '{"token":"forged"}']) {
      const response = await fetch(url + "/api/connection", {
        method: "POST",
        headers,
        body: malformed,
      });
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain(token);
    }
    const wrongType = await fetch(url + "/api/connection", {
      method: "POST",
      headers: { ...headers, "content-type": "text/plain" },
      body: "{}",
    });
    expect(wrongType.status).toBe(415);
    const oversized = await fetch(url + "/api/connection", {
      method: "POST",
      headers,
      body: JSON.stringify({ data: "x".repeat(1024) }),
    });
    expect(oversized.status).toBe(413);
  });
  it("requires ChatGPT sign-in for all live AI routes without contacting a fallback", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const { url } = await start({ fetcher }, false);
    const health = await (await fetch(url + "/health")).json();
    for (const name of ["agent", "character", "ink", "notebook", "learning"])
      expect(health.capabilities[name]).toMatchObject({ available: false, mode: "unavailable" });
    for (const [path, input] of [
      ["/api/agent", agentInput()],
      ["/api/learn/plan", { goal: "fractions" }],
      ["/api/learn/teachback", { concept: "fractions", explanation: "Two halves make one." }],
    ] as const) {
      const result = await post(url, path, input);
      expect(result.status).toBe(401);
      expect(await result.json()).toMatchObject({ code: "chatgpt_auth_required" });
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect((await fetch(url + "/ws/tts")).status).toBe(404);
  });
  it("binds loopback, exposes honest nonsecret health, and requires pairing", async () => {
    const { gateway, url } = await start({}, false);
    expect(gateway.server.address()).toMatchObject({ address: "127.0.0.1" });
    const health = await (await fetch(url + "/health")).json();
    expect(health).toMatchObject({
      authRequired: true,
      demoMode: false,
      capabilities: {
        agent: { available: false, mode: "unavailable" },
        notebook: { available: false },
      },
    });
    expect(JSON.stringify(health)).not.toContain(token);
    expect((await fetch(url + "/api/agent", { method: "POST" })).status).toBe(401);
    expect(
      (await post(url, "/api/agent", agentInput(), { authorization: "Bearer wrong-token" })).status,
    ).toBe(401);
  });
  it("rejects hostile browser origins and host headers while allowing paired extensions", async () => {
    const { url } = await start();
    expect(
      (await post(url, "/api/agent", agentInput(), { origin: "https://evil.example" })).status,
    ).toBe(403);
    const hostStatus = await new Promise<number>((resolve) => {
      const req = http.request(
        url + "/health",
        { headers: { host: "attacker.example:8787" } },
        (response) => {
          response.resume();
          resolve(response.statusCode!);
        },
      );
      req.end();
    });
    expect(hostStatus).toBe(403);
    const origin = `chrome-extension://${"a".repeat(32)}`;
    const response = await post(url, "/api/agent", agentInput(), { origin });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
  });
  it("rejects malformed and oversized inputs before provider execution", async () => {
    const agent = vi.fn(async () => ({
      action: { type: "say" as const, text: "safe" },
      provider: "local" as const,
    }));
    const { url } = await start({ agent });
    expect(
      (await post(url, "/api/agent", { ...agentInput(), page: { url: "https://example.com" } }))
        .status,
    ).toBe(400);
    expect(
      (await post(url, "/api/agent", { ...agentInput(), message: "x".repeat(10_001) })).status,
    ).toBe(400);
    const broken = await fetch(url + "/api/agent", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{",
    });
    expect(broken.status).toBe(400);
    expect(agent).not.toHaveBeenCalled();
  });
  it("never substitutes scripted ink, notebook, character, or agent output in live mode", async () => {
    const { url } = await start({}, false);
    const image = "data:image/png;base64,YQ==";
    for (const [path, input] of [
      ["/api/ink", { image }],
      ["/api/notebook", { image }],
      ["/api/character", { image }],
      ["/api/agent", agentInput()],
    ] as const) {
      const response = await post(url, path, input);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "chatgpt_auth_required" });
    }
  });
  it("runs labeled specialist fixtures with no network or paid keys", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("Unexpected external network");
    });
    const { url } = await start({ fetcher });
    const image = "data:image/png;base64,YQ==";
    for (const [path, input] of [
      ["/api/ink", { image }],
      ["/api/notebook", { image }],
      ["/api/character", { image }],
      [
        "/api/video",
        {
          url: "https://example.com/video",
          segments: [{ start: 0, end: 10, text: "An explicitly supplied demonstration caption." }],
        },
      ],
      ["/api/learn/plan", { goal: "fractions" }],
      ["/api/lookup", { query: "workshop" }],
    ] as const) {
      const response = await post(url, path, input);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ provider: "demo" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([false, true])("keeps unavailable captions honest in demo=%s", async (demo) => {
    const fetcher = vi.fn(async () => {
      throw new Error("Unexpected external network");
    });
    const { url } = await start({ fetcher }, demo);
    const response = await post(url, "/api/video", { url: "https://example.com/video" });
    expect(await response.json()).toMatchObject({
      available: false,
      segments: [],
      source: "none",
      provider: "local",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("serves fresh notebook and supports byte ranges for native media seeking", async () => {
    const { url } = await start();
    const response = await fetch(url + "/notebook.html", { headers: { range: "bytes=0-20" } });
    expect(response.status).toBe(206);
    expect((await response.arrayBuffer()).byteLength).toBe(21);
    const font = await fetch(url + "/fonts/PressStart2P.ttf");
    expect(font.status).toBe(200);
    expect(font.headers.get("content-type")).toBe("font/ttf");
    expect((await font.arrayBuffer()).byteLength).toBeGreaterThan(100_000);
    const notice = await fetch(url + "/fonts/OFL-PressStart2P.txt");
    expect(await notice.text()).toContain("SIL OPEN FONT LICENSE");
  });
});

describe("cancellation", () => {
  it("propagates explicit cancellation to the running provider signal", async () => {
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let aborted = false;
    const { url } = await start({
      agent: (_input, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(signal.reason);
          });
          ready();
        }),
    });
    const pending = post(url, "/api/agent", agentInput("cancel-me"));
    await started;
    expect(await (await post(url, "/api/cancel", { requestId: "cancel-me" })).json()).toEqual({
      cancelled: true,
    });
    expect((await pending).status).toBe(499);
    expect(aborted).toBe(true);
  });
  it("aborts provider work on browser disconnect and applies a bounded deadline", async () => {
    const signals: AbortSignal[] = [];
    const { url } = await start(
      {
        agent: (_input, active) => {
          signals.push(active);
          return new Promise((_resolve, reject) =>
            active.addEventListener("abort", () => reject(active.reason)),
          );
        },
      },
      true,
      300,
    );
    const response = await post(url, "/api/agent", agentInput("deadline"));
    expect(response.status).toBe(504);
    expect(signals[0].aborted).toBe(true);
    const control = new AbortController();
    const request = fetch(url + "/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(agentInput("disconnect")),
      signal: control.signal,
    }).catch(() => null);
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    control.abort();
    await request;
    await vi.waitFor(() => expect(signals[1].aborted).toBe(true));
  });
});

it("persists a restrictive local token and reuses it without exposing it in health", () => {
  const directory = mkdtempSync(join(tmpdir(), "hypeman-token-"));
  try {
    const first = loadPairingToken({}, directory);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(loadPairingToken({}, directory)).toBe(first);
    expect(readFileSync(join(directory, ".hypeman-token"), "utf8").trim()).toBe(first);
    expect(statSync(join(directory, ".hypeman-token")).mode & 0o777).toBe(0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("reuses an existing HypeMan token and tightens its permissions", () => {
  const directory = mkdtempSync(join(tmpdir(), "hypeman-token-existing-"));
  const token = "a".repeat(64);
  try {
    const path = join(directory, ".hypeman-token");
    writeFileSync(path, `${token}\n`, { mode: 0o644 });
    expect(loadPairingToken({}, directory)).toBe(token);
    expect(readFileSync(path, "utf8")).toBe(`${token}\n`);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("accepts a HypeMan environment token and rejects invalid overrides", () => {
  const current = "hypeman-current-token";
  expect(loadPairingToken({ HYPEMAN_TOKEN: current })).toBe(current);
  expect(() => loadPairingToken({ HYPEMAN_TOKEN: "short" })).toThrow(
    "HYPEMAN_TOKEN",
  );
});

it("rejects a malformed pairing file without replacing it", () => {
  const directory = mkdtempSync(join(tmpdir(), "hypeman-invalid-token-"));
  try {
    const path = join(directory, ".hypeman-token");
    writeFileSync(path, "broken token\n");
    expect(() => loadPairingToken({}, directory)).toThrow("Invalid .hypeman-token");
    expect(readFileSync(path, "utf8")).toBe("broken token\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
