export type HintPriority = "practice" | "selection";
export type HintProducer = (signal: AbortSignal) => Promise<string | null>;

export interface PrepareHintOptions {
  priority?: HintPriority;
  /** A visible user trigger may skip the speculative interval, but not the rolling request budget. */
  trigger?: boolean;
}

export interface PreparedHintsOptions {
  now?: () => number;
  maxEntries?: number;
  ttlMs?: number;
  speculativeIntervalMs?: number;
  maxRequestsPerMinute?: number;
}

interface Entry {
  text: string;
  expiresAt: number;
}

interface Request {
  key: string;
  producer: HintProducer;
  options: PrepareHintOptions;
  controller: AbortController;
  promise: Promise<string | null>;
  resolve: (text: string | null) => void;
}

/** Session-only, bounded preparation. Callers own context keys and decide when to reveal a hint. */
export class PreparedHints {
  private readonly clock: () => number;
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly speculativeIntervalMs: number;
  private readonly maxRequestsPerMinute: number;
  private readonly entries = new Map<string, Entry>();
  private starts: number[] = [];
  private lastSpeculativeStart = -Infinity;
  private active: Request | null = null;
  private pending: Request | null = null;

  constructor(options: PreparedHintsOptions = {}) {
    this.clock = options.now ?? Date.now;
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 6));
    this.ttlMs = Math.max(1, options.ttlMs ?? 5 * 60_000);
    this.speculativeIntervalMs = Math.max(0, options.speculativeIntervalMs ?? 15_000);
    this.maxRequestsPerMinute = Math.max(1, Math.floor(options.maxRequestsPerMinute ?? 6));
  }

  /** Reads without extending expiration or changing eviction order. */
  peek(key: string): string | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.clock()) {
      this.entries.delete(key);
      return null;
    }
    return entry.text;
  }

  /** Reading a prepared hint makes it the most recently used entry. */
  get(key: string): string | null {
    const text = this.peek(key);
    if (text !== null) {
      const entry = this.entries.get(key)!;
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return text;
  }

  prepare(key: string, producer: HintProducer, options: PrepareHintOptions = {}): Promise<string | null> {
    if (!key.trim()) return Promise.resolve(null);
    const cached = this.get(key);
    if (cached !== null) return Promise.resolve(cached);
    if (this.pending?.key === key) {
      if (this.rank(options) > this.rank(this.pending.options)) this.pending.options = { ...options };
      return this.pending.promise;
    }
    if (this.active?.key === key && !this.active.controller.signal.aborted) return this.active.promise;
    if (!this.allowed(options)) return Promise.resolve(null);

    const competing = this.pending ?? this.active;
    if (competing && !competing.controller.signal.aborted && this.rank(options) <= this.rank(competing.options))
      return Promise.resolve(null);

    const request = this.request(key, producer, options);
    if (this.active) {
      // Do not overlap providers that take a moment to acknowledge cancellation.
      this.cancelPending();
      this.pending = request;
      this.active.controller.abort();
    } else {
      this.start(request);
    }
    return request.promise;
  }

  /** Cancels both speculative work and a queued replacement, retaining already prepared hints. */
  abortActive(): void {
    this.cancelPending();
    this.active?.controller.abort();
  }

  /** Invalidates this session's prepared content. Request budgets survive invalidation. */
  clear(): void {
    this.abortActive();
    this.entries.clear();
  }

  private rank(options: PrepareHintOptions): number {
    return (options.trigger ? 2 : 0) + (options.priority === "selection" ? 1 : 0);
  }

  private allowed(options: PrepareHintOptions): boolean {
    const time = this.clock();
    this.starts = this.starts.filter((start) => start > time - 60_000);
    return this.starts.length < this.maxRequestsPerMinute &&
      (options.trigger === true || time - this.lastSpeculativeStart >= this.speculativeIntervalMs);
  }

  private request(key: string, producer: HintProducer, options: PrepareHintOptions): Request {
    let resolve!: Request["resolve"];
    const promise = new Promise<string | null>((complete) => { resolve = complete; });
    return { key, producer, options: { ...options }, controller: new AbortController(), promise, resolve };
  }

  private cancelPending(): void {
    if (!this.pending) return;
    this.pending.controller.abort();
    this.pending.resolve(null);
    this.pending = null;
  }

  private start(request: Request): void {
    if (request.controller.signal.aborted || !this.allowed(request.options)) {
      request.resolve(null);
      return;
    }
    const time = this.clock();
    this.starts.push(time);
    if (!request.options.trigger) this.lastSpeculativeStart = time;
    this.active = request;
    void this.run(request);
  }

  private async run(request: Request): Promise<void> {
    let result: string | null = null;
    try {
      const value = await request.producer(request.controller.signal);
      if (!request.controller.signal.aborted && this.active === request && typeof value === "string" && value.trim()) {
        result = value.trim();
        this.entries.delete(request.key);
        this.entries.set(request.key, { text: result, expiresAt: this.clock() + this.ttlMs });
        for (const [key, entry] of this.entries) {
          if (entry.expiresAt <= this.clock()) this.entries.delete(key);
        }
        while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
      }
    } catch {
      // Provider failures and cancellation do not become cached content or unhandled rejections.
    } finally {
      request.resolve(result);
      if (this.active === request) {
        this.active = null;
        const next = this.pending;
        this.pending = null;
        if (next) this.start(next);
      }
    }
  }
}
