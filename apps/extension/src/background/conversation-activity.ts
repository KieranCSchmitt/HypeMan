import { isRecord, type ConversationActivity } from "@core";

export const CONVERSATION_ACTIVITY_KEY = "hypeman.conversation.activity";
const MAX_STOPPED = 256;
const identifier = (value: unknown): value is string => typeof value === "string" && /^[\w.-]{1,160}$/.test(value);
export interface ActivityOwner { tabId: number; documentId?: string; site: string; title: string }
interface Entry { conversationId: string; activity: ConversationActivity; documentId?: string; awaitingContinuation?: boolean }
interface State { entries: Entry[]; stopped: Array<{ conversationId: string; runId: string }> }
interface Dependencies {
  load(): Promise<unknown>;
  save(state: State): Promise<void>;
  changed(conversationId: string, activity: ConversationActivity | null): Promise<void>;
  stopped(conversationId: string, activity: ConversationActivity, markerAlreadyWritten: boolean): Promise<void>;
}
const cancelled = () => new DOMException("This request was stopped or moved to another page.", "AbortError");

/** One durable browser owner per conversation. Every mutation compares the run and owner. */
export class ConversationActivityCoordinator {
  private state?: State;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private dependencies: Dependencies) {}
  private operation<T>(action: (state: State) => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => {}).then(async () => {
      if (!this.state) {
        const value = await this.dependencies.load();
        this.state = { entries: [], stopped: [] };
        if (isRecord(value) && Array.isArray(value.entries) && Array.isArray(value.stopped)) {
          this.state.stopped = value.stopped.filter((item) => isRecord(item) && identifier(item.conversationId) && identifier(item.runId)).slice(-MAX_STOPPED) as State["stopped"];
          for (const item of value.entries.slice(0, 128)) {
            if (!isRecord(item) || !identifier(item.conversationId) || !isRecord(item.activity)) continue;
            const row = item.activity;
            if (!identifier(row.runId) || !Number.isInteger(row.tabId) || Number(row.tabId) < 0 ||
                !["thinking", "acting", "confirming"].includes(String(row.phase)) ||
                typeof row.status !== "string" || row.status.length > 500 || typeof row.site !== "string" || row.site.length > 253 ||
                typeof row.title !== "string" || row.title.length > 200 || this.isStopped(this.state, item.conversationId, row.runId)) continue;
            this.state.entries.push({ conversationId: item.conversationId, activity: row as unknown as ConversationActivity,
              ...(typeof item.documentId === "string" ? { documentId: item.documentId.slice(0, 200) } : {}),
              ...(item.awaitingContinuation === true ? { awaitingContinuation: true } : {}) });
          }
        }
      }
      return action(this.state);
    });
    this.queue = next;
    return next;
  }
  private ids(conversationId: unknown, runId?: unknown): asserts conversationId is string {
    if (!identifier(conversationId) || runId !== undefined && !identifier(runId)) throw new Error("Choose a valid conversation request.");
  }
  private isStopped(state: State, conversationId: string, runId: string): boolean {
    return state.stopped.some((item) => item.conversationId === conversationId && item.runId === runId);
  }
  private remember(state: State, entry: Entry) {
    state.stopped.push({ conversationId: entry.conversationId, runId: entry.activity.runId });
    state.stopped = state.stopped.slice(-MAX_STOPPED);
  }
  private matches(entry: Entry | undefined, runId: string, owner: Pick<ActivityOwner, "tabId" | "documentId">): entry is Entry {
    return !!entry && entry.activity.runId === runId && entry.activity.tabId === owner.tabId &&
      (!entry.documentId || !owner.documentId || entry.documentId === owner.documentId);
  }
  get(conversationId: unknown): Promise<ConversationActivity | null> {
    this.ids(conversationId);
    return this.operation(async (state) => structuredClone(state.entries.find((item) => item.conversationId === conversationId)?.activity ?? null));
  }
  start(conversationId: unknown, runId: unknown, owner: ActivityOwner, continuation = false): Promise<ConversationActivity | null> {
    this.ids(conversationId, runId);
    if (!identifier(runId)) throw new Error("Choose a valid conversation request.");
    return this.operation(async (state) => {
      const previous = state.entries.find((item) => item.conversationId === conversationId);
      if (this.isStopped(state, conversationId, runId)) return null;
      if (continuation) {
        if (!previous || previous.activity.runId !== runId || previous.activity.tabId !== owner.tabId ||
            !previous.awaitingContinuation && !this.matches(previous, runId, owner)) return null;
      } else if (previous?.activity.runId === runId) {
        return this.matches(previous, runId, owner) ? structuredClone(previous.activity) : null;
      }
      if (previous && previous.activity.runId !== runId) this.remember(state, previous);
      const activity: ConversationActivity = { runId, tabId: owner.tabId, phase: "thinking", status: "Thinking…", site: owner.site, title: owner.title };
      state.entries = state.entries.filter((item) => item.conversationId !== conversationId);
      state.entries.push({ conversationId, activity, ...(owner.documentId ? { documentId: owner.documentId } : {}) });
      await this.dependencies.save(state);
      if (previous && previous.activity.runId !== runId) await this.dependencies.stopped(conversationId, previous.activity, true);
      await this.dependencies.changed(conversationId, activity);
      return structuredClone(activity);
    });
  }
  update(conversationId: unknown, runId: unknown, owner: ActivityOwner, phase: unknown, status: unknown): Promise<ConversationActivity | null> {
    this.ids(conversationId, runId);
    if (!identifier(runId) || !["thinking", "acting", "confirming"].includes(String(phase)) || typeof status !== "string" || status.length > 500)
      throw new Error("Choose a valid browser activity.");
    return this.operation(async (state) => {
      const entry = state.entries.find((item) => item.conversationId === conversationId);
      if (!this.matches(entry, runId, owner) || entry.awaitingContinuation) return null;
      entry.activity = { ...entry.activity, phase: phase as ConversationActivity["phase"], status: status.replace(/[\u0000-\u001f]/g, " "), site: owner.site, title: owner.title };
      await this.dependencies.save(state);
      await this.dependencies.changed(conversationId, entry.activity);
      return structuredClone(entry.activity);
    });
  }
  transfer(conversationId: string, runId: string, source: Pick<ActivityOwner, "tabId" | "documentId">, destination: ActivityOwner): Promise<ConversationActivity | null> {
    this.ids(conversationId, runId);
    return this.operation(async (state) => {
      const entry = state.entries.find((item) => item.conversationId === conversationId);
      if (!this.matches(entry, runId, source)) return null;
      entry.activity = { ...entry.activity, tabId: destination.tabId, phase: "thinking", status: "Continuing on the next page…", site: destination.site, title: destination.title };
      entry.documentId = undefined;
      entry.awaitingContinuation = true;
      await this.dependencies.save(state);
      await this.dependencies.changed(conversationId, entry.activity);
      return structuredClone(entry.activity);
    });
  }
  prepare(conversationId: string, runId: string, owner: Pick<ActivityOwner, "tabId" | "documentId">): Promise<void> {
    return this.operation(async (state) => {
      const entry = state.entries.find((item) => item.conversationId === conversationId);
      if (!this.matches(entry, runId, owner)) throw cancelled();
      entry.awaitingContinuation = true;
      await this.dependencies.save(state);
    });
  }
  release(conversationId: string, runId: string, owner: Pick<ActivityOwner, "tabId" | "documentId">): Promise<void> {
    return this.operation(async (state) => {
      const entry = state.entries.find((item) => item.conversationId === conversationId);
      if (!this.matches(entry, runId, owner)) throw cancelled();
      if (entry.awaitingContinuation) {
        entry.awaitingContinuation = false;
        await this.dependencies.save(state);
      }
    });
  }
  end(conversationId: unknown, runId: unknown, owner: Pick<ActivityOwner, "tabId" | "documentId">): Promise<null> {
    this.ids(conversationId, runId);
    return this.operation(async (state) => {
      const entry = state.entries.find((item) => item.conversationId === conversationId);
      if (!identifier(runId) || !this.matches(entry, runId, owner) || entry.awaitingContinuation) return null;
      this.remember(state, entry);
      state.entries = state.entries.filter((item) => item !== entry);
      await this.dependencies.save(state);
      await this.dependencies.changed(conversationId, null);
      return null;
    });
  }
  cancel(conversationId: unknown, beforeStop?: (activity: ConversationActivity) => Promise<boolean>): Promise<ConversationActivity | null> {
    this.ids(conversationId);
    return this.operation(async (state) => {
      const entry = state.entries.find((item) => item.conversationId === conversationId);
      if (!entry) return null;
      this.remember(state, entry);
      state.entries = state.entries.filter((item) => item !== entry);
      await this.dependencies.save(state);
      const markerAlreadyWritten = await beforeStop?.(entry.activity) ?? true;
      await this.dependencies.stopped(conversationId, entry.activity, markerAlreadyWritten);
      await this.dependencies.changed(conversationId, null);
      return structuredClone(entry.activity);
    });
  }
  removeOwner(tabId: number): Promise<void> {
    return this.operation(async (state) => {
      const removed = state.entries.filter((item) => item.activity.tabId === tabId);
      if (!removed.length) return;
      for (const entry of removed) this.remember(state, entry);
      state.entries = state.entries.filter((item) => item.activity.tabId !== tabId);
      await this.dependencies.save(state);
      for (const entry of removed) {
        await this.dependencies.stopped(entry.conversationId, entry.activity, true);
        await this.dependencies.changed(entry.conversationId, null);
      }
    });
  }
  ownerRun(tabId: number): string | null | undefined {
    return this.state ? this.state.entries.find((item) => item.activity.tabId === tabId)?.activity.runId ?? null : undefined;
  }
  ownerDocument(tabId: number): string | undefined {
    return this.state?.entries.find((item) => item.activity.tabId === tabId)?.documentId;
  }
  navigated(owner: ActivityOwner, handoff: { conversationId?: string; runId?: string } | null, observedRunId?: string | null, observedDocumentId?: string): Promise<void> {
    return this.operation(async (state) => {
      const entry = state.entries.find((item) => item.activity.tabId === owner.tabId &&
        (observedRunId === undefined || item.activity.runId === observedRunId));
      if (!entry) return;
      // A slow loading event must not cancel a destination that has already claimed the run.
      if (observedRunId !== undefined && entry.documentId !== observedDocumentId) return;
      if (handoff?.conversationId === entry.conversationId && handoff.runId === entry.activity.runId) {
        entry.awaitingContinuation = true;
        entry.documentId = undefined;
        entry.activity = { ...entry.activity, site: owner.site, title: owner.title, phase: "thinking", status: "Continuing on the next page…" };
        await this.dependencies.save(state);
        await this.dependencies.changed(entry.conversationId, entry.activity);
        return;
      }
      this.remember(state, entry);
      state.entries = state.entries.filter((item) => item !== entry);
      await this.dependencies.save(state);
      await this.dependencies.stopped(entry.conversationId, entry.activity, true);
      await this.dependencies.changed(entry.conversationId, null);
    });
  }
  assertOwner(conversationId: string, runId: string, owner: Pick<ActivityOwner, "tabId" | "documentId">, allowPrepared = false): Promise<void> {
    return this.operation(async (state) => {
      const entry = state.entries.find((item) => item.conversationId === conversationId);
      if (!this.matches(entry, runId, owner) || entry.awaitingContinuation && !allowPrepared) throw cancelled();
    });
  }
  canResume(conversationId: string, runId: string, tabId: number): Promise<boolean> {
    return this.operation(async () => this.allowsHandoff(conversationId, runId, tabId));
  }
  /** Synchronous check inside the tab's storage queue avoids a coordinator/storage lock cycle. */
  allowsHandoff(conversationId: string, runId: string, tabId: number): boolean {
    const entry = this.state?.entries.find((item) => item.conversationId === conversationId);
    return entry?.activity.runId === runId && entry.activity.tabId === tabId;
  }
}
