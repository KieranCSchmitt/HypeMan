import { describe, expect, it, vi } from "vitest";
import { PreparedHints } from "../apps/extension/src/runtime/prepared-hints";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

describe("prepared hint session cache", () => {
  it("reuses a prepared value and deduplicates a trigger against the same in-flight request", async () => {
    const cache = new PreparedHints();
    const response = deferred<string>();
    const producer = vi.fn(() => response.promise);
    const preload = cache.prepare("question:1", producer);
    expect(cache.prepare("question:1", producer, { trigger: true })).toBe(preload);
    response.resolve("  Start by subtracting the constant.  ");
    expect(await preload).toBe("Start by subtracting the constant.");
    expect(await cache.prepare("question:1", producer, { trigger: true })).toBe("Start by subtracting the constant.");
    expect(producer).toHaveBeenCalledTimes(1);
  });

  it("expires hints after five minutes without timers or sliding expiration", async () => {
    let time = 0;
    const cache = new PreparedHints({ now: () => time });
    await cache.prepare("one", async () => "A hint");
    time = 299_999;
    expect(cache.get("one")).toBe("A hint");
    time = 300_000;
    expect(cache.peek("one")).toBeNull();
  });

  it("evicts the least recently used value and keeps peek from changing eviction order", async () => {
    let time = 0;
    const cache = new PreparedHints({ now: () => time, maxEntries: 2 });
    await cache.prepare("one", async () => "One");
    time += 15_000;
    await cache.prepare("two", async () => "Two");
    expect(cache.get("one")).toBe("One");
    expect(cache.peek("two")).toBe("Two");
    time += 15_000;
    await cache.prepare("three", async () => "Three");
    expect(cache.get("two")).toBeNull();
    expect(cache.get("one")).toBe("One");
    expect(cache.get("three")).toBe("Three");
  });

  it("allows only one speculative start per fifteen seconds while a user trigger may start immediately", async () => {
    let time = 0;
    const cache = new PreparedHints({ now: () => time });
    const second = vi.fn(async () => "Second");
    await cache.prepare("one", async () => "First");
    time = 14_999;
    expect(await cache.prepare("two", second)).toBeNull();
    expect(second).not.toHaveBeenCalled();
    expect(await cache.prepare("two", second, { trigger: true })).toBe("Second");
    time = 15_000;
    expect(await cache.prepare("three", async () => "Third")).toBe("Third");
  });

  it("limits total starts to six per rolling minute, including triggers and invalidation", async () => {
    let time = 0;
    const cache = new PreparedHints({ now: () => time });
    const producer = vi.fn(async () => "Hint");
    for (let index = 0; index < 6; index++) {
      expect(await cache.prepare(String(index), producer, { trigger: true })).toBe("Hint");
      time += 1;
    }
    cache.clear();
    expect(await cache.prepare("over budget", producer, { trigger: true })).toBeNull();
    expect(producer).toHaveBeenCalledTimes(6);
    time = 60_000;
    expect(await cache.prepare("fresh window", producer, { trigger: true })).toBe("Hint");
  });

  it("prioritizes selection over practice without overlapping a cancelled producer", async () => {
    let time = 0;
    const cache = new PreparedHints({ now: () => time });
    const slow = deferred<string>();
    let signal!: AbortSignal;
    const practice = cache.prepare("practice", (value) => { signal = value; return slow.promise; });
    time = 15_000;
    const selected = vi.fn(async () => "This word means …");
    const selection = cache.prepare("selection", selected, { priority: "selection" });
    expect(signal.aborted).toBe(true);
    expect(selected).not.toHaveBeenCalled();
    slow.resolve("Stale practice hint");
    expect(await practice).toBeNull();
    expect(await selection).toBe("This word means …");
    expect(cache.peek("practice")).toBeNull();
  });

  it("does not cancel a selected explanation to speculate about a different practice question", async () => {
    let time = 0;
    const cache = new PreparedHints({ now: () => time });
    const response = deferred<string>();
    let signal!: AbortSignal;
    const selection = cache.prepare("selection", (value) => { signal = value; return response.promise; }, { priority: "selection" });
    time = 15_000;
    const practice = vi.fn(async () => "Practice");
    expect(await cache.prepare("practice", practice)).toBeNull();
    expect(signal.aborted).toBe(false);
    expect(practice).not.toHaveBeenCalled();
    response.resolve("Explanation");
    expect(await selection).toBe("Explanation");
  });

  it("replaces queued speculation with an explicit trigger and deduplicates its queued key", async () => {
    let time = 0;
    const cache = new PreparedHints({ now: () => time });
    const response = deferred<string>();
    const practice = cache.prepare("practice", () => response.promise);
    time = 15_000;
    const skipped = vi.fn(async () => "Skipped");
    const speculative = cache.prepare("selection", skipped, { priority: "selection" });
    const clicked = vi.fn(async () => "Clicked");
    const triggered = cache.prepare("clicked", clicked, { trigger: true });
    expect(cache.prepare("clicked", clicked, { trigger: true })).toBe(triggered);
    expect(await speculative).toBeNull();
    response.resolve("Old");
    expect(await practice).toBeNull();
    expect(await triggered).toBe("Clicked");
    expect(skipped).not.toHaveBeenCalled();
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("cancels active and queued requests, and never caches late results", async () => {
    let time = 0;
    const cache = new PreparedHints({ now: () => time });
    const response = deferred<string>();
    let signal!: AbortSignal;
    const active = cache.prepare("one", (value) => { signal = value; return response.promise; });
    time = 15_000;
    const producer = vi.fn(async () => "Queued");
    const queued = cache.prepare("two", producer, { priority: "selection" });
    cache.clear();
    expect(signal.aborted).toBe(true);
    expect(await queued).toBeNull();
    response.resolve("Late");
    expect(await active).toBeNull();
    expect(cache.peek("one")).toBeNull();
    expect(cache.peek("two")).toBeNull();
    expect(producer).not.toHaveBeenCalled();
  });

  it("keeps prepared values on abortActive and permits retry after an error or invalid result", async () => {
    const cache = new PreparedHints();
    await cache.prepare("saved", async () => "Saved");
    cache.abortActive();
    expect(cache.get("saved")).toBe("Saved");
    expect(await cache.prepare("error", async () => { throw new Error("Unavailable"); }, { trigger: true })).toBeNull();
    expect(await cache.prepare("error", async () => "Recovered", { trigger: true })).toBe("Recovered");
    expect(await cache.prepare("empty", async () => "  ", { trigger: true })).toBeNull();
    expect(await cache.prepare("empty", async () => "Valid", { trigger: true })).toBe("Valid");
  });
});
