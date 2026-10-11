/** Request ownership survives page changes through explicit handoff, never through stale replies. */
export class GatewayClient {
  private pending = new Map<string, { controller: AbortController; owner: number | null }>();
  constructor(
    private config: () => Promise<{ serverUrl: string; serverToken: string }>,
    private fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    private saveConnection?: (token: string, serverUrl: string) => Promise<void>,
  ) {}
  cancel(id: string, owner: number | null): boolean {
    const p = this.pending.get(id);
    if (!p || p.owner !== owner) return false;
    p.controller.abort();
    return true;
  }
  cancelOwner(owner: number): void {
    for (const p of this.pending.values()) if (p.owner === owner) p.controller.abort();
  }
  async post<T>(
    path: string,
    body: unknown,
    id: string,
    owner: number | null,
    timeout = 120000,
    stream?: (line: Record<string, unknown>) => void,
  ): Promise<T> {
    if (this.pending.has(id)) throw new Error("Duplicate request id");
    const controller = new AbortController();
    this.pending.set(id, { controller, owner });
    const timer = setTimeout(() => controller.abort(), timeout);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const consume = <V>(operation: Promise<V>): Promise<V> =>
      new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException("Cancelled or timed out", "AbortError"));
        if (controller.signal.aborted) {
          abort();
          return;
        }
        controller.signal.addEventListener("abort", abort, { once: true });
        operation
          .then(resolve, reject)
          .finally(() => controller.signal.removeEventListener("abort", abort));
      });
    try {
      let settings = await consume(this.config());
      const send = (target: string, token: string, payload: unknown) =>
        consume(
          this.fetcher(settings.serverUrl + target, {
            method: payload === undefined ? "GET" : "POST",
            headers: {
              "content-type": "application/json",
              ...(token ? { authorization: `Bearer ${token}` } : {}),
              "x-request-id": id,
            },
            ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
            signal: controller.signal,
          }).catch((error: unknown) => {
            if (error instanceof TypeError)
              throw new Error("Start HypeMan’s local server, then retry.");
            throw error;
          }),
        );
      const connect = async () => {
        const reply = await send("/api/connection", "", {});
        if (!reply.ok)
          throw new Error("Reload the latest HypeMan extension, then retry the connection.");
        const result: unknown = await consume(reply.json());
        if (
          !result ||
          typeof result !== "object" ||
          !("token" in result) ||
          typeof result.token !== "string" ||
          !/^[\x21-\x7e]{16,256}$/.test(result.token)
        )
          throw new Error("HypeMan’s local server returned an invalid connection.");
        await consume(this.saveConnection!(result.token, settings.serverUrl));
        controller.signal.throwIfAborted();
        settings = { ...settings, serverToken: result.token };
      };
      if (this.saveConnection && !settings.serverToken && path.startsWith("/api/")) await connect();
      let response = await send(path, settings.serverToken, body);
      // An expired local transport secret is rejected before API execution, so one retry is safe.
      if (response.status === 401 && this.saveConnection) {
        const failure = await consume(response.clone().json()).catch(() => null);
        if (failure?.code === "pairing_required") {
          await connect();
          response = await send(path, settings.serverToken, body);
        }
      }
      if (!response.ok) {
        const result = (await consume(response.json()).catch(() => ({}))) as {
          error?: string;
          code?: string;
        };
        const chatgptAuth = typeof result.code === "string" && result.code.startsWith("chatgpt_");
        throw new Error(
          response.status === 401 && !chatgptAuth
            ? "HypeMan couldn’t connect to its local server. Reload the extension and retry."
            : result.error || `Local server returned ${response.status}`,
        );
      }
      if (!stream || !response.headers.get("content-type")?.includes("ndjson"))
        return (await consume(response.json())) as T;
      if (!response.body) throw new Error("Empty response");
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "",
        result: T | undefined;
      const parse = (raw: string) => {
        if (!raw.trim()) return;
        const line: unknown = JSON.parse(raw);
        if (!line || typeof line !== "object" || Array.isArray(line))
          throw new Error("Invalid stream response");
        if ("result" in line) result = line.result as T;
        else if ("error" in line) throw new Error(String(line.error));
        else stream(line as Record<string, unknown>);
      };
      while (true) {
        const chunk = await consume(reader.read());
        if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        if (buffer.length > 2_000_000) throw new Error("Response too large");
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          parse(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
        }
        if (chunk.done) break;
      }
      parse(buffer);
      if (result === undefined) throw new Error("Incomplete response");
      return result;
    } finally {
      clearTimeout(timer);
      this.pending.delete(id);
      if (reader) {
        void reader.cancel().catch(() => {});
        try {
          reader.releaseLock();
        } catch {
          /* Pending read is being cancelled. */
        }
      }
    }
  }
}
