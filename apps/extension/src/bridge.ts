import { DEFAULT_SETTINGS, parseSettings, type Settings, type RuntimeEvent } from "@core";
export interface BridgeMessage {
  type: string;
  [key: string]: unknown;
}
/** All UI writes are routed through the single background owner. */
export function request<T = unknown>(message: BridgeMessage, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestId =
      typeof message.requestId === "string" ? message.requestId : crypto.randomUUID();
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const cancel = () => {
      try {
        void chrome.runtime.sendMessage({ type: "request.cancel", requestId }).catch(() => {});
      } catch {
        /* context invalidated */
      }
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      cancel();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(
      () => {
        if (settled) return;
        settled = true;
        cleanup();
        cancel();
        reject(new Error("HypeMan took too long. Try again."));
      },
      message.type === "api" ? 95000 : 50000,
    );
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    try {
      chrome.runtime.sendMessage({ ...message, requestId }, (response: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || typeof response !== "object" || !("ok" in response)) {
          reject(new Error("The extension restarted. Refresh this page."));
          return;
        }
        const envelope = response as { ok: boolean; data?: T; error?: string; cancelled?: boolean };
        if (!envelope.ok)
          reject(envelope.cancelled === true ? new DOMException(envelope.error || "Cancelled", "AbortError") : new Error(envelope.error || "HypeMan couldn't complete that request."));
        else resolve(envelope.data as T);
      });
    } catch (error) {
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
export function subscribe(listener: (event: RuntimeEvent) => void): () => void {
  const receive = (event: unknown) => {
    if (
      event &&
      typeof event === "object" &&
      "type" in event &&
      typeof event.type === "string" &&
      event.type.startsWith("hypeman.")
    )
      listener({ ...event, type: event.type.slice("hypeman.".length) } as RuntimeEvent);
  };
  chrome.runtime.onMessage.addListener(receive);
  return () => chrome.runtime.onMessage.removeListener(receive);
}
export const readSettings = async (): Promise<Settings> =>
  parseSettings(await request({ type: "settings.get" }));
export const writeSettings = async (patch: Partial<Settings>): Promise<Settings> =>
  parseSettings(await request({ type: "settings.patch", patch }));
export { DEFAULT_SETTINGS };
