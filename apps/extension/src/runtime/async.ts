export function abortError(): DOMException {
  return new DOMException("Stopped", "AbortError");
}
export function check(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  check(signal);
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal?.addEventListener("abort", stop, { once: true });
  });
}
export function cancelled(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
