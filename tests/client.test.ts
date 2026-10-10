import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { GatewayClient } from "../apps/extension/src/background/client";
const settings = async () => ({
  serverUrl: "http://127.0.0.1:8787",
  serverToken: "local-test-token",
});
const servers: http.Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function streamingServer() {
  let headers!: () => void;
  const started = new Promise<void>((resolve) => {
    headers = resolve;
  });
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/x-ndjson" });
    response.write('{"say":"Thinking"}\n');
    headers();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as import("node:net").AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, started };
}
describe("background gateway request ownership", () => {
  it("only permits the owning tab to cancel a pending request", async () => {
    const { url, started } = await streamingServer();
    const client = new GatewayClient(async () => ({ serverUrl: url, serverToken: "token" }));
    const request = client.post("/api/agent", {}, "owned", 7, 2000, () => {});
    await started;
    expect(client.cancel("owned", 8)).toBe(false);
    expect(client.cancel("owned", 7)).toBe(true);
    await expect(request).rejects.toBeDefined();
    expect(client.cancel("owned", 7)).toBe(false);
  });
  it("cancels a request while settings are still loading before it can reach the network", async () => {
    let ready!: (value: Awaited<ReturnType<typeof settings>>) => void;
    const config = new Promise<Awaited<ReturnType<typeof settings>>>((resolve) => {
      ready = resolve;
    });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }))) as typeof fetch;
    const client = new GatewayClient(() => config, fetcher);
    const request = client.post("/api/agent", {}, "before-config", 4);
    expect(client.cancel("before-config", 4)).toBe(true);
    ready(await settings());
    await expect(request).rejects.toBeDefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("cancels all requests for one tab without disturbing another owner", async () => {
    const signals = new Map<string, AbortSignal>();
    const fetcher = vi.fn(
      (url: unknown, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = options!.signal as AbortSignal;
          const id = (options!.headers as Record<string, string>)["x-request-id"];
          signals.set(id, signal);
          signal.addEventListener("abort", () =>
            reject(new DOMException("Cancelled", "AbortError")),
          );
        }),
    ) as typeof fetch;
    const client = new GatewayClient(settings, fetcher);
    const a = client.post("/api/agent", {}, "a", 1).catch(() => null),
      b = client.post("/api/agent", {}, "b", 2).catch(() => null);
    await vi.waitFor(() => expect(signals.size).toBe(2));
    client.cancelOwner(1);
    expect(signals.get("a")?.aborted).toBe(true);
    expect(signals.get("b")?.aborted).toBe(false);
    client.cancelOwner(2);
    await Promise.all([a, b]);
  });
  it("decodes UTF-8 split across chunks and preserves the last NDJSON result without a newline", async () => {
    const bytes = new TextEncoder().encode(
      '{"say":"Café 🐇"}\n{"result":{"answer":"Crème brûlée"}}',
    );
    const fragments: unknown[] = [];
    const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => {
      expect((options?.headers as Record<string, string>).authorization).toBe(
        "Bearer local-test-token",
      );
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (let offset = 0; offset < bytes.length; offset += 3)
              controller.enqueue(bytes.slice(offset, offset + 3));
            controller.close();
          },
        }),
        { headers: { "content-type": "application/x-ndjson" } },
      );
    }) as typeof fetch;
    const client = new GatewayClient(settings, fetcher);
    expect(
      await client.post("/api/agent", {}, "utf8", 1, 2000, (line) => fragments.push(line)),
    ).toEqual({ answer: "Crème brûlée" });
    expect(fragments).toEqual([{ say: "Café 🐇" }]);
  });
  it("keeps the deadline active after response headers throughout streamed body consumption", async () => {
    const { url } = await streamingServer();
    const client = new GatewayClient(async () => ({ serverUrl: url, serverToken: "token" }));
    const request = client.post("/api/agent", {}, "body-deadline", 1, 40, () => {});
    await expect(request).rejects.toBeDefined();
    expect(client.cancel("body-deadline", 1)).toBe(false);
  });
  it("enforces the deadline even when a custom adapter ignores abort during JSON or stream reads", async () => {
    const hanging = (type: string) =>
      new GatewayClient(
        settings,
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                if (type.includes("ndjson"))
                  controller.enqueue(new TextEncoder().encode('{"say":"First line"}\n'));
              },
            }),
            { headers: { "content-type": type } },
          ),
      );
    const jsonClient = hanging("application/json");
    await expect(jsonClient.post("/api/agent", {}, "json-body", 3, 20)).rejects.toMatchObject({
      name: "AbortError",
    });
    const streamClient = hanging("application/x-ndjson");
    await expect(
      streamClient.post("/api/agent", {}, "stream-body", 3, 20, () => {}),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(jsonClient.cancel("json-body", 3)).toBe(false);
    expect(streamClient.cancel("stream-body", 3)).toBe(false);
  });
  it("rejects malformed or unfinished stream messages without returning a partial result", async () => {
    const client = new GatewayClient(
      settings,
      async () =>
        new Response('{"say":"hello"}\n', { headers: { "content-type": "application/x-ndjson" } }),
    );
    await expect(client.post("/api/agent", {}, "unfinished", 1, 2000, () => {})).rejects.toThrow(
      "Incomplete response",
    );
    const malformed = new GatewayClient(
      settings,
      async () => new Response("[]\n", { headers: { "content-type": "application/x-ndjson" } }),
    );
    await expect(malformed.post("/api/agent", {}, "malformed", 1, 2000, () => {})).rejects.toThrow(
      "Invalid stream response",
    );
  });
  it("distinguishes ChatGPT authorization failures from missing local pairing", async () => {
    for (const code of ["chatgpt_auth_required", "chatgpt_session_expired", "pairing_required"]) {
      const client = new GatewayClient(settings, async () =>
        Response.json({ code, error: "Sign in with ChatGPT again." }, { status: 401 }),
      );
      await expect(client.post("/api/agent", {}, code, 1)).rejects.toThrow(
        code === "pairing_required"
          ? "HypeMan couldn’t connect to its local server. Reload the extension and retry."
          : "Sign in with ChatGPT again.",
      );
    }
  });
  it("connects a fresh installation automatically before sending an authenticated request", async () => {
    const calls: { url: string; authorization?: string }[] = [];
    let token = "";
    const client = new GatewayClient(
      async () => ({ serverUrl: "http://127.0.0.1:8787", serverToken: token }),
      async (url, options) => {
        calls.push({
          url: String(url),
          authorization: (options?.headers as Record<string, string>).authorization,
        });
        return Response.json(
          String(url).endsWith("/connection")
            ? { token: "automatic-private-token" }
            : { connected: true },
        );
      },
      async (value) => {
        token = value;
      },
    );
    await expect(client.post("/api/chatgpt/status", {}, "fresh", null)).resolves.toEqual({
      connected: true,
    });
    expect(calls).toEqual([
      { url: "http://127.0.0.1:8787/api/connection", authorization: undefined },
      {
        url: "http://127.0.0.1:8787/api/chatgpt/status",
        authorization: "Bearer automatic-private-token",
      },
    ]);
    await client.post("/api/chatgpt/status", {}, "again", null);
    expect(calls.filter((call) => call.url.endsWith("/connection"))).toHaveLength(1);
  });
  it("recovers a rejected local secret once without retrying ChatGPT authorization failures", async () => {
    for (const code of ["pairing_required", "chatgpt_auth_required"]) {
      const save = vi.fn(async () => {});
      const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => {
        const authorization = (options?.headers as Record<string, string>).authorization;
        if (!authorization) return Response.json({ token: "replacement-private-token" });
        return authorization.includes("replacement")
          ? Response.json({ ok: true })
          : Response.json({ code, error: "Sign in again." }, { status: 401 });
      });
      const client = new GatewayClient(settings, fetcher, save);
      if (code === "pairing_required") {
        await expect(client.post("/api/chatgpt/status", {}, "refresh", null)).resolves.toEqual({
          ok: true,
        });
        expect(save).toHaveBeenCalledOnce();
        expect(fetcher).toHaveBeenCalledTimes(3);
      } else {
        await expect(client.post("/api/chatgpt/status", {}, "auth-error", null)).rejects.toThrow(
          "Sign in again.",
        );
        expect(save).not.toHaveBeenCalled();
        expect(fetcher).toHaveBeenCalledOnce();
      }
    }
  });
  it("cancels connection setup before saving its secret or sending the protected request", async () => {
    let finish!: (response: Response) => void;
    const save = vi.fn(async () => {});
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const client = new GatewayClient(
      async () => ({ serverUrl: "http://localhost:8787", serverToken: "" }),
      fetcher,
      save,
    );
    const pending = client.post("/api/chatgpt/status", {}, "cancel-connect", 9);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(client.cancel("cancel-connect", 9)).toBe(true);
    finish(Response.json({ token: "late-private-token-value" }));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(save).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
