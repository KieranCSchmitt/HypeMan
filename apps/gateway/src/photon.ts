import type { GatewayConfig } from "./config";
import { GatewayError } from "./errors";

/** Provider-independent envelope; the phone service enforces owner authorization. */
export interface IncomingPhoneMessage {
  id: string;
  sender: string;
  spaceId: string;
  text: string;
  at: number;
  fromMe: boolean;
  isGroup: boolean;
}
export interface PhotonTransport {
  readonly configured: boolean;
  readonly connected: boolean;
  readonly error?: string;
  start(onMessage: (message: IncomingPhoneMessage) => Promise<void>): Promise<void>;
  send(destination: { phone: string; spaceId?: string }, text: string): Promise<{ id?: string; spaceId?: string }>;
  close(): Promise<void>;
}

interface RuntimeSpace {
  id: string;
  phone: string;
  type: "dm" | "group";
  send(text: string): Promise<{ id: string } | undefined>;
}
interface RuntimeMessage {
  id: string;
  sender?: { id: string };
  direction: "inbound" | "outbound";
  content: RuntimeContent;
  timestamp: Date;
}
interface RuntimeContent { type: string; text?: string; content?: RuntimeContent; }
/** Small injectable SDK boundary used by deterministic tests, without a network. */
export interface PhotonRuntime {
  messages: AsyncIterable<[RuntimeSpace, RuntimeMessage]>;
  createSpace(phone: string): Promise<RuntimeSpace>;
  getSpace(id: string, line: string): Promise<RuntimeSpace>;
  stop(): Promise<void>;
}
type RuntimeFactory = (config: GatewayConfig) => Promise<PhotonRuntime>;

function messageText(content: RuntimeContent): string | undefined {
  // Native threaded replies wrap new text; never include the quoted target.
  for (let depth = 0; depth < 4; depth++) {
    if (content.type === "text") return content.text;
    if (content.type !== "reply" || !content.content) return undefined;
    content = content.content;
  }
  return undefined;
}

async function createRuntime(config: GatewayConfig): Promise<PhotonRuntime> {
  // These imports must remain inside the configured, live-only connection path.
  const [{ Spectrum }, { imessage }] = await Promise.all([
    import("spectrum-ts"),
    import("spectrum-ts/providers/imessage"),
  ]);
  const app = await Spectrum({
    projectId: config.spectrumProjectId!,
    projectSecret: config.spectrumProjectSecret!,
    providers: [imessage.config()],
    options: { logLevel: "error" },
    telemetry: false,
  });
  const provider = imessage(app);
  return {
    messages: {
      async *[Symbol.asyncIterator]() {
        for await (const [space, message] of app.messages) {
          if (imessage.is(space) && imessage.is(message)) yield [space, message];
        }
      },
    },
    createSpace: (phone) => provider.space.create(phone),
    getSpace: (id, line) => provider.space.get(id, { phone: line }),
    stop: () => app.stop(),
  };
}

/** Persists both chat and sending-line identity without exposing SDK objects. */
function encodeSpace(space: RuntimeSpace): string {
  return Buffer.from(JSON.stringify({ id: space.id, line: space.phone })).toString("base64url");
}
function decodeSpace(value: string): { id: string; line: string } {
  try {
    if (value.length > 4096) throw new Error();
    const result: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!result || typeof result !== "object") throw new Error();
    const { id, line } = result as Record<string, unknown>;
    if (typeof id !== "string" || !id || typeof line !== "string" || !line) throw new Error();
    return { id, line };
  } catch {
    throw new GatewayError(400, "Invalid phone conversation.", "messaging_invalid_space");
  }
}

export class PhotonAdapter implements PhotonTransport {
  readonly configured: boolean;
  connected = false;
  error?: string;
  private runtime?: PhotonRuntime;
  private starting?: Promise<void>;
  private stopped = false;
  private spaces = new Map<string, RuntimeSpace>();
  private callbacks = new Set<Promise<void>>();

  constructor(private readonly config: GatewayConfig, private readonly factory: RuntimeFactory = createRuntime) {
    this.configured = !!config.spectrumProjectId && !!config.spectrumProjectSecret;
    if (config.demo) this.error = "Demo mode does not connect to Photon. Start live mode to pair your phone.";
    else if (!this.configured) this.error = "Set SPECTRUM_PROJECT_ID and SPECTRUM_PROJECT_SECRET in the local gateway.";
  }

  async start(onMessage: (message: IncomingPhoneMessage) => Promise<void>): Promise<void> {
    if (this.stopped || this.runtime || !this.configured || this.config.demo) return;
    if (this.starting) return this.starting;
    this.starting = this.connect(onMessage).finally(() => { this.starting = undefined; });
    return this.starting;
  }

  private async connect(onMessage: (message: IncomingPhoneMessage) => Promise<void>) {
    try {
      const runtime = await this.factory(this.config);
      if (this.stopped) {
        await runtime.stop();
        return;
      }
      this.runtime = runtime;
      this.connected = true;
      this.error = undefined;
      // The SDK resumes transient interruptions; a terminal iterator failure is visible in status.
      void this.consume(runtime, onMessage);
    } catch {
      this.connected = false;
      this.error = "Photon could not connect. Check project credentials and dashboard registration, then restart the gateway.";
    }
  }

  private async consume(runtime: PhotonRuntime, onMessage: (message: IncomingPhoneMessage) => Promise<void>) {
    try {
      for await (const [space, message] of runtime.messages) {
        if (this.stopped) break;
        const text = messageText(message.content);
        if (typeof text !== "string") continue;
        const spaceId = encodeSpace(space);
        // A personal gateway needs only a small bounded cache. Durable identities live in the service.
        if (this.spaces.size >= 64 && !this.spaces.has(spaceId)) this.spaces.delete(this.spaces.keys().next().value!);
        this.spaces.set(spaceId, space);
        // Receiving must stay independent of AI latency so a subsequent STOP can
        // reach the service immediately. The service owns durable acceptance and
        // serial processing; failures are observed here without ending the stream.
        const callback = Promise.resolve().then(async () => {
          if (this.stopped) return;
          await onMessage({
            id: message.id,
            sender: message.sender?.id ?? "",
            spaceId,
            text,
            at: message.timestamp.getTime(),
            fromMe: message.direction === "outbound",
            isGroup: space.type !== "dm",
          });
        }).catch(() => {
          if (!this.stopped)
            this.error = "An incoming phone message could not be saved or processed. Check local storage and restart the gateway.";
        }).finally(() => { this.callbacks.delete(callback); });
        this.callbacks.add(callback);
      }
      if (!this.stopped) this.error = "Photon's incoming connection ended. Restart the gateway to reconnect.";
    } catch {
      if (!this.stopped) this.error = "Photon's incoming connection failed. Restart the gateway to reconnect.";
    } finally {
      if (this.runtime === runtime) this.connected = false;
    }
  }

  async send(destination: { phone: string; spaceId?: string }, text: string): Promise<{ id?: string; spaceId?: string }> {
    const runtime = this.runtime;
    if (!runtime || !this.connected || this.stopped)
      throw new GatewayError(503, this.error || "Photon is not connected.", "messaging_unavailable");
    if (!/^\+[1-9]\d{6,14}$/.test(destination.phone) || !text.trim() || text.length > 12_000)
      throw new GatewayError(400, "Invalid phone message.", "messaging_invalid_message");
    let space = destination.spaceId ? this.spaces.get(destination.spaceId) : undefined;
    if (!space && destination.spaceId) {
      const { id, line } = decodeSpace(destination.spaceId);
      space = await runtime.getSpace(id, line);
    }
    space ??= await runtime.createSpace(destination.phone);
    if (space.type !== "dm") throw new GatewayError(400, "Only personal phone conversations are supported.");
    const spaceId = encodeSpace(space);
    this.spaces.set(spaceId, space);
    const sent = await space.send(text);
    if (!sent?.id)
      throw new GatewayError(502, "Photon did not return a message receipt; delivery is uncertain.", "messaging_delivery_unknown");
    return { id: sent.id, spaceId };
  }

  async close(): Promise<void> {
    this.stopped = true;
    this.connected = false;
    // A connection finishing after close immediately disposes itself in connect().
    await this.runtime?.stop();
    this.runtime = undefined;
    this.spaces.clear();
    // Do not await application callbacks: the service cancels inference and owns
    // its processing queue. Waiting here could deadlock shutdown behind that AI.
    this.callbacks.clear();
  }
}
