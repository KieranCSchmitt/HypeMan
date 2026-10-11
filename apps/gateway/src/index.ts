import http from "node:http";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentReply, AgentRequest, Health, TaskAssessment, TaskAssessmentRequest } from "@core";
import { unavailableMessagingStatus } from "@core";
import { loadConfig, type GatewayConfig } from "./config";
import {
  allowedHost,
  allowedOrigin,
  authenticated,
  firstPartyExtension,
  loadPairingToken,
} from "./security";
import { GatewayError } from "./errors";
import { validateAgent, validateRoute, validateTaskAssessment } from "./validation";
import { Providers } from "./providers";
import { ChatGPTAuth } from "./chatgpt-auth";
import { decide } from "./agent";
import { learning } from "./learning";
import { vision } from "./vision";
import { video } from "./video";
import { analyzeDocument } from "./documents";
import { lookup } from "./lookup";
import { assessTask, groundedAssessment } from "./task-assessment";
import { PhotonAdapter } from "./photon";
import { MessagingService } from "./messaging";
const here = dirname(fileURLToPath(import.meta.url));
const publicDirectory = resolve(here, "../public");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".js": "text/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".vtt": "text/vtt",
  ".json": "application/json",
};
function json(response: http.ServerResponse, status: number, value: unknown) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}
async function body(request: http.IncomingMessage, limit = 12_000_000): Promise<unknown> {
  if (!/^application\/json(?:;|$)/i.test(request.headers["content-type"] ?? ""))
    throw new GatewayError(415, "Use Content-Type: application/json.");
  if (Number(request.headers["content-length"]) > limit)
    throw new GatewayError(413, "Payload too large.");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > limit) throw new GatewayError(413, "Payload too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new GatewayError(400, "Malformed JSON.");
  }
}
/** Undefined ignores an unsupported header; null means a valid but unsatisfiable range. */
function byteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | undefined {
  const parts = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!parts || (!parts[1] && !parts[2])) return undefined;
  if (size === 0) return null;
  // Parse before clamping so large decimal bounds cannot lose integer precision.
  const length = BigInt(size);
  const last = length - 1n;
  if (!parts[1]) {
    const suffix = BigInt(parts[2]);
    if (suffix === 0n) return null;
    return { start: suffix >= length ? 0 : Number(length - suffix), end: size - 1 };
  }
  const start = BigInt(parts[1]);
  const requestedEnd = parts[2] ? BigInt(parts[2]) : last;
  if (start >= length || requestedEnd < start) return null;
  return { start: Number(start), end: Number(requestedEnd > last ? last : requestedEnd) };
}
function staticFile(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  path: string,
): boolean {
  const decoded = decodeURIComponent(path);
  const name = decoded.endsWith("/") ? `${decoded}index.html` : decoded;
  const candidate = resolve(publicDirectory, `.${name}`);
  if (!candidate.startsWith(publicDirectory + sep)) throw new GatewayError(403, "Invalid path.");
  if (!existsSync(candidate) || !statSync(candidate).isFile()) return false;
  if (!realpathSync(candidate).startsWith(realpathSync(publicDirectory) + sep))
    throw new GatewayError(403, "Invalid path.");
  const size = statSync(candidate).size,
    headers = {
      "content-type": MIME[extname(candidate)] || "application/octet-stream",
      "accept-ranges": "bytes",
    };
  const range = byteRange(request.headers.range, size);
  if (range === null) {
    response.writeHead(416, { "content-range": `bytes */${size}` }).end();
    return true;
  }
  if (range) {
    const { start, end } = range;
    response.writeHead(206, {
      ...headers,
      "content-range": `bytes ${start}-${end}/${size}`,
      "content-length": end - start + 1,
    });
    createReadStream(candidate, { start, end }).pipe(response);
    return true;
  }
  response.writeHead(200, { ...headers, "content-length": size });
  createReadStream(candidate).pipe(response);
  return true;
}
export interface GatewayOptions {
  token: string;
  agent?: (input: AgentRequest, signal: AbortSignal) => Promise<AgentReply>;
  assessTask?: (input: TaskAssessmentRequest, signal: AbortSignal) => Promise<TaskAssessment>;
  fetcher?: typeof fetch;
  chatgpt?: ChatGPTAuth;
  messaging?: MessagingService;
}
export function createGateway(config: GatewayConfig, options: GatewayOptions) {
  if (!options.token) throw new Error("Local connection token is required.");
  const chatgpt = options.chatgpt,
    providers = new Providers(config, options.fetcher, chatgpt),
    active = new Map<string, AbortController>();
  const stopRequests = () => {
    options.messaging?.cancelAI();
    for (const controller of active.values())
      controller.abort(new DOMException("ChatGPT account changed", "AbortError"));
  };
  const health = async (): Promise<Health> => {
    const agent = config.demo
      ? { available: true, mode: "demo" as const }
      : await providers.status();
    return {
      ok: true,
      version: "0.2.0",
      demoMode: config.demo,
      authRequired: true,
      capabilities: {
        agent,
        ink: agent,
        transcripts: {
          available: true,
          mode: config.transcriptKey ? "live" : "local",
          reason: config.transcriptKey
            ? "Page captions and Supadata transcripts."
            : "Native page captions only; SUPADATA_API_KEY enables service transcripts.",
        },
        learning: agent,
        messaging: {
          available: !!options.messaging?.status().connected,
          mode: options.messaging?.status().connected ? "live" : "unavailable",
          reason: "Optional Photon phone companion; pairing and delivery details require local authentication.",
        },
      },
    };
  };
  const server = http.createServer(async (request, response) => {
    const port = (server.address() as import("node:net").AddressInfo | null)?.port ?? config.port;
    const origin = request.headers.origin;
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("cache-control", "no-store");
    if (!allowedHost(request.headers.host, port) || !allowedOrigin(origin, port)) {
      json(response, 403, { error: "Untrusted local host or browser origin." });
      return;
    }
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname === "/api/connection" && !firstPartyExtension(origin)) {
      json(response, 403, { error: "Only the HypeMan extension can connect automatically." });
      return;
    }
    if (origin) {
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("vary", "Origin");
    }
    response.setHeader("access-control-allow-headers", "content-type,authorization,x-request-id");
    response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    response.setHeader("access-control-expose-headers", "x-request-id");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, await health());
      return;
    }
    let requestId = "",
      controller: AbortController | undefined,
      deadline: ReturnType<typeof setTimeout> | undefined;
    const disconnect = () => {
      if (!response.writableEnded)
        controller?.abort(new DOMException("Client disconnected", "AbortError"));
    };
    try {
      if (request.method === "GET" && url.pathname === "/auth/callback") {
        if (config.demo || !chatgpt) throw new GatewayError(409, "ChatGPT sign-in is unavailable.");
        let message: string;
        try {
          await chatgpt.callback(url);
          stopRequests();
          message = chatgpt.sharing
            ? "ChatGPT is connected. Return to HypeMan to choose your model and continue."
            : "You signed in, but ChatGPT plan usage is disabled. Return to HypeMan and enable plan usage to continue.";
        } catch {
          message =
            "ChatGPT sign-in could not be completed. Return to HypeMan to check the connection and try again.";
          response.statusCode = 400;
        }
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.setHeader(
          "content-security-policy",
          "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'",
        );
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>HypeMan · ChatGPT</title><style>
          @font-face{font-family:"Press Start 2P";src:url("/fonts/PressStart2P.ttf") format("truetype");font-display:swap}@font-face{font-family:Tiny5;src:url("/fonts/Tiny5.ttf") format("truetype");font-display:swap}
          *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;font:15px/1.6 Arial,sans-serif;color:#1b1f3b;background:radial-gradient(ellipse at 50% 20%,#49376f,transparent 60%),repeating-linear-gradient(0deg,transparent 0 31px,#ffffff05 32px),#15172e}
          main{width:min(100%,440px);padding:5px;border:1px solid #eef4ff;border-right-color:#575c79;border-bottom-color:#575c79;border-radius:5px;background:linear-gradient(135deg,#eef3ff,#aeb7cb);box-shadow:0 18px 65px #0007,0 0 30px #00e5ff20}
          header{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:2px;background:linear-gradient(#8c78ed,#493380);color:white;text-shadow:1px 1px #242344}header b{font:12px/1.5 "Press Start 2P",monospace;letter-spacing:0}header span{margin-left:auto;color:#d5fdff;font:19px/1 Tiny5,monospace}
          section{margin:5px 0 0;padding:24px;border:1px solid #8c92ab;background:#f5f7ff}p{margin:0 0 14px}p:last-child{margin:0;color:#6b6d85;font-size:13px}
        </style><body><main><header><b>HypeMan</b><span>ChatGPT</span></header><section><p>${message}</p><p>You can close this tab.</p></section></main></body></html>`);
        return;
      }
      if (!url.pathname.startsWith("/api/")) {
        if (request.method === "GET" && staticFile(request, response, url.pathname)) return;
        throw new GatewayError(404, "Not found.");
      }
      if (url.pathname === "/api/connection") {
        if (request.method !== "POST") throw new GatewayError(405, "Use POST.");
        const input = await body(request, 1024);
        if (
          !input ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          Object.keys(input).length
        )
          throw new GatewayError(400, "Invalid connection request.");
        json(response, 200, { token: options.token });
        return;
      }
      if (!authenticated(request, options.token))
        throw new GatewayError(401, "Reconnect HypeMan to its local server.", "pairing_required");
      if (request.method !== "POST") throw new GatewayError(405, "Use POST.");
      const payload = await body(request);
      if (url.pathname.startsWith("/api/messaging/")) {
        const action = url.pathname.slice("/api/messaging/".length);
        if (!options.messaging) {
          if (action === "status") {
            if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length)
              throw new GatewayError(400, "Invalid messaging status request.");
            json(response, 200, unavailableMessagingStatus());
            return;
          }
          throw new GatewayError(503, "Phone companion is unavailable in this gateway.", "messaging_unavailable");
        }
        json(response, 200, await options.messaging.route(action, payload));
        return;
      }
      if (url.pathname.startsWith("/api/chatgpt/")) {
        const action = url.pathname.slice("/api/chatgpt/".length);
        const keys: Record<string, string[]> = {
          status: [],
          login: ["profileId", "newProfile"],
          cancel: [],
          logout: [],
          select: ["profileId"],
          model: ["model"],
        };
        if (!Object.hasOwn(keys, action)) throw new GatewayError(404, "Unknown account action.");
        if (!payload || typeof payload !== "object" || Array.isArray(payload))
          throw new GatewayError(400, "Invalid account request.");
        const input = payload as Record<string, unknown>;
        if (
          Object.keys(input).some((key) => !keys[action].includes(key)) ||
          (input.profileId !== undefined &&
            (typeof input.profileId !== "string" || !/^[\w.-]{1,128}$/.test(input.profileId))) ||
          (input.newProfile !== undefined && typeof input.newProfile !== "boolean") ||
          (input.model !== undefined &&
            (typeof input.model !== "string" || !/^[\w.:-]{1,128}$/.test(input.model))) ||
          (action === "select" && !input.profileId) ||
          (action === "model" && !input.model) ||
          (input.newProfile === true && input.profileId !== undefined)
        )
          throw new GatewayError(400, "Invalid account request.");
        if (action === "status") {
          json(
            response,
            200,
            config.demo || !chatgpt
              ? {
                  connected: false,
                  sharing: false,
                  activeProfileId: null,
                  profiles: [],
                  pending: false,
                }
              : await providers.chatgptStatus(),
          );
          return;
        }
        if (config.demo || !chatgpt)
          throw new GatewayError(409, "Start live mode (DEMO_MODE=0) to connect ChatGPT.");
        if (action === "login") {
          json(
            response,
            200,
            await chatgpt.start(
              input as { profileId?: string; newProfile?: boolean },
              `http://127.0.0.1:${port}/auth/callback`,
            ),
          );
          return;
        }
        if (action === "cancel") chatgpt.cancel();
        if (action === "logout") {
          stopRequests();
          await chatgpt.logout();
        }
        if (action === "select") {
          stopRequests();
          await chatgpt.select(String(input.profileId));
        }
        if (action === "model") {
          stopRequests();
          await providers.selectChatGPTModel(String(input.model));
        }
        json(response, 200, { ok: true });
        return;
      }
      const input = validateRoute(url.pathname, payload);
      if (url.pathname === "/api/cancel") {
        const found = active.get(String(input.requestId));
        found?.abort(new DOMException("Cancelled by user", "AbortError"));
        json(response, 200, { cancelled: !!found });
        return;
      }
      const id = request.headers["x-request-id"] ?? input.requestId ?? randomUUID();
      if (typeof id !== "string" || !/^[\w.-]{1,128}$/.test(id))
        throw new GatewayError(400, "Invalid request ID.");
      if (active.has(id)) throw new GatewayError(409, "Request ID already running.");
      if (active.size >= 32) throw new GatewayError(429, "Too many active local requests.");
      requestId = id;
      controller = new AbortController();
      active.set(id, controller);
      deadline = setTimeout(
        () => controller?.abort(new DOMException("Deadline exceeded", "TimeoutError")),
        config.deadlineMs,
      );
      response.on("close", disconnect);
      request.on("aborted", disconnect);
      response.setHeader("x-request-id", id);
      const signal = controller.signal;
      const run = async (): Promise<unknown> => {
        if (url.pathname === "/api/agent")
          return options.agent
            ? options.agent(validateAgent(input), signal)
            : decide(validateAgent(input), providers, config.demo, signal);
        if (url.pathname === "/api/task/assess") {
          const assessment = validateTaskAssessment(input);
          return options.assessTask
            ? groundedAssessment(await options.assessTask(assessment, signal), assessment)
            : assessTask(assessment, providers, config.demo, signal);
        }
        if (url.pathname.startsWith("/api/learn/"))
          return learning(url.pathname, input, providers, config, signal);
        if (url.pathname === "/api/ink")
          return vision(input, providers, config, signal);
        if (url.pathname === "/api/video")
          return video(input, providers, config, signal, options.fetcher);
        if (url.pathname === "/api/document")
          return analyzeDocument(input, providers, signal, config.demo);
        if (url.pathname === "/api/lookup")
          return lookup(String(input.query), config, signal, options.fetcher);
        throw new GatewayError(404, "Unknown API route.");
      };
      const cancelled = new Promise<never>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
      json(response, 200, await Promise.race([run(), cancelled]));
    } catch (error) {
      const timedOut =
        controller?.signal.aborted && (controller.signal.reason as Error)?.name === "TimeoutError";
      const status = timedOut
        ? 504
        : controller?.signal.aborted
          ? 499
          : error instanceof GatewayError
            ? error.status
            : 502;
      const message = timedOut
        ? "Request deadline exceeded. Try a smaller request."
        : controller?.signal.aborted
          ? "Request cancelled."
          : error instanceof GatewayError
            ? error.message
            : "The provider failed. Try again; no result was fabricated.";
      json(response, status, {
        error: message,
        requestId,
        code: timedOut
          ? "deadline_exceeded"
          : error instanceof GatewayError
            ? error.code
            : "provider_error",
      });
    } finally {
      if (deadline) clearTimeout(deadline);
      if (controller && active.get(requestId) === controller) active.delete(requestId);
      response.off("close", disconnect);
      request.off("aborted", disconnect);
    }
  });
  server.requestTimeout = 45_000;
  server.headersTimeout = 10_000;
  server.on("upgrade", (_request, socket) => {
    socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
  });
  return {
    server,
    health,
    listen: () =>
      new Promise<number>((resolvePort, reject) => {
        server.once("error", reject);
        server.listen(config.port, "127.0.0.1", () => {
          server.off("error", reject);
          resolvePort((server.address() as import("node:net").AddressInfo).port);
        });
      }),
    close: async () => {
      chatgpt?.cancel();
      for (const controller of active.values()) controller.abort();
      await options.messaging?.close();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
export async function startGateway() {
  const config = loadConfig(),
    token = loadPairingToken();
  const chatgpt = !config.demo ? new ChatGPTAuth() : undefined;
  const providers = new Providers(config, undefined, chatgpt);
  const messaging = config.demo ? undefined : new MessagingService({
    transport: new PhotonAdapter(config),
    providers,
    demo: config.demo,
  });
  const gateway = createGateway(config, {
    token,
    chatgpt,
    messaging,
  });
  const port = await gateway.listen();
  // A missing/slow Photon connection must never delay Chrome or ChatGPT startup.
  void messaging?.start().catch(() => {
    console.error("Photon phone companion could not start. Check its status in HypeMan Settings.");
  });
  console.info(
    `HypeMan ${config.demo ? "DEMO — labeled fixtures" : "LIVE"} gateway: http://127.0.0.1:${port}`,
  );
  console.info("HypeMan connects automatically. Use the avatar on an ordinary Chrome webpage to continue.");
  const stop = () => {
    void gateway.close().then(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return gateway;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void startGateway().catch((error) => {
    console.error(
      "HypeMan could not start:",
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  });
