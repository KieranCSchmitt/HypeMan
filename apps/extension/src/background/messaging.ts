import {
  isRecord,
  safePageUrl,
  validMessagingTimezone,
  parseReminderRecurrence,
  type CompanionSnapshot,
  type MessagingCapture,
  type MessagingStatus,
  type PhoneBrowserRequest,
} from "@core";

export const MESSAGING_INBOX_KEY = "hypeman.messaging.inbox";
export const MESSAGING_ALARM = "hypeman.messaging.sync";

interface InboxState {
  version: 1;
  captures: MessagingCapture[];
  importedIds: string[];
  pendingAcks: string[];
  browserDispatches: BrowserDispatch[];
}
interface BrowserDispatch {
  id: string;
  claimId: string;
  status: "dispatching" | "started" | "failed" | "unknown" | "ignored";
  pendingResult: boolean;
  error?: string;
}
interface Storage {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= max;
const stamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const id = (value: unknown): value is string => text(value, 300);
const time = (value: unknown): value is string =>
  typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

function browserRequest(value: unknown): PhoneBrowserRequest {
  if (!isRecord(value) || !id(value.id) || typeof value.conversationId !== "string" || !/^[\w.-]{1,160}$/.test(value.conversationId) ||
      !text(value.goal, 2000) || !stamp(value.createdAt) || !stamp(value.updatedAt) ||
      value.createdAt > 8_640_000_000_000_000 || value.updatedAt > 8_640_000_000_000_000 ||
      !["queued", "claimed", "started", "failed", "cancelled", "unknown"].includes(String(value.status)) ||
      (value.error !== undefined && !text(value.error, 2000)))
    throw new Error("The local server returned an invalid phone browser request.");
  const url = value.url === undefined ? undefined : safePageUrl(value.url);
  if (value.url !== undefined && (!text(value.url, 4096) || !url))
    throw new Error("The local server returned an invalid phone browser URL.");
  return { id: value.id, conversationId: value.conversationId, goal: value.goal,
    createdAt: value.createdAt, updatedAt: value.updatedAt, status: value.status as PhoneBrowserRequest["status"],
    ...(url ? { url } : {}), ...(value.error !== undefined ? { error: value.error } : {}) };
}

function capture(value: unknown): MessagingCapture {
  if (!isRecord(value) || !id(value.id) || !["idea", "goal", "link"].includes(String(value.kind)) ||
      !text(value.text, 8000) || !stamp(value.createdAt) ||
      (value.importedAt !== undefined && !stamp(value.importedAt)))
    throw new Error("The local server returned an invalid phone capture.");
  const url = value.url === undefined ? undefined : safePageUrl(value.url);
  if (value.url !== undefined && (!text(value.url, 4096) || !url))
    throw new Error("The local server returned an invalid phone capture URL.");
  return {
    id: value.id, kind: value.kind as MessagingCapture["kind"], text: value.text,
    createdAt: value.createdAt, ...(url ? { url } : {}),
    ...(value.importedAt !== undefined ? { importedAt: value.importedAt } : {}),
  };
}
function list<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > 5000)
    throw new Error("The local server returned an invalid phone collection.");
  return value.map(parse);
}
/** Keep transport credentials and additional gateway fields outside extension UI state. */
export function safeMessagingStatus(value: unknown): MessagingStatus {
  const settings = isRecord(value) && isRecord(value.settings) ? value.settings : {};
  if (!isRecord(value) || typeof value.configured !== "boolean" ||
      typeof value.connected !== "boolean" || typeof value.paired !== "boolean" ||
      !stamp(value.lastSyncedAt) || !isRecord(value.settings) ||
      !["coachingEnabled", "projectUpdates", "proactiveEnabled"].every((key) => typeof settings[key] === "boolean") ||
      !time(value.settings.morningTime) || !time(value.settings.eveningTime) ||
      !validMessagingTimezone(value.settings.timezone) ||
      (value.ownerPhone !== undefined && !text(value.ownerPhone, 50)) ||
      (value.error !== undefined && !text(value.error, 2000)))
    throw new Error("The local server returned an invalid phone status.");
  return {
    configured: value.configured, connected: value.connected, paired: value.paired,
    lastSyncedAt: value.lastSyncedAt,
    ...(value.ownerPhone !== undefined ? { ownerPhone: value.ownerPhone } : {}),
    ...(value.error !== undefined ? { error: value.error } : {}),
    settings: {
      coachingEnabled: settings.coachingEnabled as boolean,
      projectUpdates: settings.projectUpdates as boolean,
      proactiveEnabled: settings.proactiveEnabled as boolean,
      morningTime: settings.morningTime as string,
      eveningTime: settings.eveningTime as string,
      timezone: settings.timezone as string,
    },
    captures: list(value.captures, capture),
    ...(value.browserRequests === undefined ? {} : { browserRequests: list(value.browserRequests, browserRequest) }),
    reminders: list(value.reminders, (item) => {
      if (!isRecord(item) || !id(item.id) || !text(item.text, 8000) || !stamp(item.dueAt) ||
          !stamp(item.createdAt) || !["pending", "sent", "cancelled", "failed", "unknown"].includes(String(item.status)))
        throw new Error("The local server returned an invalid phone reminder.");
      const recurrence = item.recurrence === undefined ? undefined : parseReminderRecurrence(item.recurrence);
      if (recurrence === null || item.paused !== undefined && typeof item.paused !== "boolean" || item.anchorAt !== undefined && !stamp(item.anchorAt) || item.seriesId !== undefined && !id(item.seriesId) || item.lastDelivery !== undefined && (!isRecord(item.lastDelivery) || !stamp(item.lastDelivery.dueAt) || !["sent", "failed", "unknown"].includes(String(item.lastDelivery.status)))) throw new Error("The local server returned an invalid reminder schedule.");
      return { id: item.id, text: item.text, dueAt: item.dueAt, createdAt: item.createdAt,
        status: item.status as MessagingStatus["reminders"][number]["status"], ...(recurrence ? { recurrence } : {}), ...(item.paused !== undefined ? { paused: item.paused } : {}), ...(item.anchorAt !== undefined ? { anchorAt: item.anchorAt } : {}), ...(item.seriesId !== undefined ? { seriesId: item.seriesId } : {}), ...(item.lastDelivery ? { lastDelivery: item.lastDelivery as MessagingStatus["reminders"][number]["lastDelivery"] } : {}) };
    }),
    commitments: list(value.commitments, (item) => {
      if (!isRecord(item) || !id(item.id) || !text(item.text, 8000) || !stamp(item.createdAt) ||
          typeof item.done !== "boolean" || typeof item.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.date))
        throw new Error("The local server returned an invalid phone commitment.");
      return { id: item.id, text: item.text, date: item.date, done: item.done, createdAt: item.createdAt };
    }),
    deliveries: list(value.deliveries, (item) => {
      if (!isRecord(item) || !id(item.id) || !text(item.text, 16000) || !stamp(item.at) ||
          !["pending", "sent", "failed", "unknown"].includes(String(item.status)) ||
          (item.error !== undefined && !text(item.error, 2000)))
        throw new Error("The local server returned an invalid phone delivery.");
      return { id: item.id, text: item.text, at: item.at,
        status: item.status as MessagingStatus["deliveries"][number]["status"],
        ...(item.error !== undefined ? { error: item.error } : {}) };
    }),
  };
}

function parseInbox(value: unknown): InboxState {
  if (value === undefined || value === null)
    return { version: 1, captures: [], importedIds: [], pendingAcks: [], browserDispatches: [] };
  // Corrupt local inboxes must fail visibly instead of acknowledging and losing phone captures.
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.captures) || !Array.isArray(value.importedIds) ||
      !value.importedIds.every(id) || !Array.isArray(value.pendingAcks) || !value.pendingAcks.every(id))
    throw new Error("HypeMan's phone inbox could not be read. Restore its local storage before syncing.");
  const captures = value.captures.map(capture);
  const imported = new Set([...value.importedIds, ...captures.map((item) => item.id)]);
  if (value.pendingAcks.some((ack) => !imported.has(ack)))
    throw new Error("HypeMan's phone inbox contains an acknowledgement without a saved capture.");
  const dispatches = value.browserDispatches === undefined ? [] : value.browserDispatches;
  if (!Array.isArray(dispatches) || dispatches.length > 5000 || dispatches.some((item) =>
      !isRecord(item) || !id(item.id) || !id(item.claimId) ||
      !["dispatching", "started", "failed", "unknown", "ignored"].includes(String(item.status)) ||
      typeof item.pendingResult !== "boolean" || (item.error !== undefined && !text(item.error, 2000))) ||
      new Set(dispatches.map((item) => item.id)).size !== dispatches.length)
    throw new Error("HypeMan's phone browser dispatch history could not be read.");
  return { version: 1, captures, importedIds: [...imported], pendingAcks: [...new Set(value.pendingAcks)],
    browserDispatches: dispatches.map((item) => ({ id: item.id, claimId: item.claimId, status: item.status,
      pendingResult: item.pendingResult, ...(item.error ? { error: item.error } : {}) })) };
}

/** Saved captures wait for Continue; explicit browser requests use a separate durable dispatch ledger. */
export class PhoneSync {
  private queue: Promise<unknown> = Promise.resolve();
  private running: Promise<MessagingStatus | null> | null = null;
  private revision = 0;
  private status: MessagingStatus | null = null;
  private failure: string | undefined;
  private ownerRevision = 0;
  constructor(
    private storage: Storage,
    private workspace: () => Promise<CompanionSnapshot>,
    private post: (path: string, body: unknown) => Promise<unknown>,
    private changed: () => Promise<void> = async () => {},
    private launchBrowser?: (request: PhoneBrowserRequest) => Promise<unknown>,
  ) {}
  private transaction<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async read(): Promise<InboxState> {
    return parseInbox((await this.storage.get(MESSAGING_INBOX_KEY))[MESSAGING_INBOX_KEY]);
  }
  private async save(state: InboxState): Promise<void> {
    await this.storage.set({ [MESSAGING_INBOX_KEY]: state });
  }
  private acceptStatus(status: MessagingStatus): void {
    if (!this.status || this.status.paired !== status.paired || this.status.ownerPhone !== status.ownerPhone) this.ownerRevision++;
    this.status = status;
  }
  private async recordDispatch(dispatch: BrowserDispatch): Promise<void> {
    await this.transaction(async () => {
      const state = await this.read();
      const existing = state.browserDispatches.findIndex((item) => item.id === dispatch.id);
      if (existing < 0) state.browserDispatches.push(dispatch);
      else state.browserDispatches[existing] = dispatch;
      await this.save(state);
    });
  }
  private async reportResult(dispatch: BrowserDispatch): Promise<void> {
    if (!dispatch.pendingResult || !["started", "failed", "unknown"].includes(dispatch.status)) return;
    const ownerRevision = this.ownerRevision;
    const status = safeMessagingStatus(await this.post("/api/messaging/browser.result", {
      id: dispatch.id, claimId: dispatch.claimId, status: dispatch.status,
      ...(dispatch.error ? { error: dispatch.error } : {}),
    }));
    const confirmed = status.browserRequests?.find((request) => request.id === dispatch.id);
    if (!confirmed || ["queued", "claimed"].includes(confirmed.status))
      throw new Error("The local server did not confirm the phone browser dispatch result.");
    await this.recordDispatch({ ...dispatch, pendingResult: false });
    if (ownerRevision === this.ownerRevision) this.acceptStatus(status);
  }
  private async browserRequests(status: MessagingStatus, ownerRevision: number): Promise<void> {
    if (!status.paired || status.browserRequests === undefined) return;
    const dispatches = await this.transaction(async () => {
      const state = await this.read();
      let changed = false;
      for (const dispatch of state.browserDispatches) {
        if (dispatch.status !== "dispatching") continue;
        dispatch.status = "unknown"; dispatch.pendingResult = true;
        dispatch.error = "Chrome stopped before browser dispatch was confirmed. This request will not run again automatically.";
        changed = true;
      }
      if (changed) await this.save(state);
      return state.browserDispatches;
    });
    let reportError: unknown;
    for (const dispatch of dispatches) {
      const remote = status.browserRequests.find((item) => item.id === dispatch.id);
      if (remote && !["queued", "claimed"].includes(remote.status) && dispatch.pendingResult) {
        await this.recordDispatch({ ...dispatch, pendingResult: false });
        continue;
      }
      try { await this.reportResult(dispatch); } catch (error) { reportError = error; }
    }
    if (this.launchBrowser) for (const request of status.browserRequests) {
      if (this.ownerRevision !== ownerRevision || !this.status?.paired) break;
      if (request.status !== "queued") continue;
      const dispatch: BrowserDispatch = { id: request.id, claimId: crypto.randomUUID(), status: "dispatching", pendingResult: false };
      const fresh = await this.transaction(async () => {
        const state = await this.read();
        if (state.browserDispatches.some((item) => item.id === request.id)) return false;
        if (state.browserDispatches.length >= 5000) throw new Error("Phone browser dispatch history is full. Existing requests were preserved.");
        state.browserDispatches.push(dispatch); await this.save(state); return true;
      });
      if (!fresh) continue;
      try {
        const value = await this.post("/api/messaging/browser.claim", { id: request.id, claimId: dispatch.claimId });
        if (value === null) { await this.recordDispatch({ ...dispatch, status: "ignored" }); continue; }
        let claimed: PhoneBrowserRequest | undefined;
        try {
          claimed = browserRequest(value);
          if (claimed.status !== "claimed" || claimed.id !== request.id || claimed.conversationId !== request.conversationId ||
              claimed.goal !== request.goal || claimed.url !== request.url) throw new Error("Changed request");
        } catch {
          dispatch.status = "failed";
          dispatch.error = "The phone browser request changed or was invalid. Chrome did not dispatch it.";
        }
        if (this.ownerRevision !== ownerRevision || !this.status?.paired) {
          dispatch.status = "failed";
          dispatch.error = "Phone pairing changed before Chrome could dispatch this request.";
        }
        if (dispatch.status !== "failed") {
          try {
            await this.launchBrowser(claimed!);
            dispatch.status = "started";
          } catch {
            dispatch.status = "unknown";
            dispatch.error = "Chrome could not confirm browser dispatch. Check Chrome before sending the request again; it will not retry automatically.";
          }
        }
      } catch {
        dispatch.status = "unknown";
        dispatch.error = "Chrome could not confirm the browser request claim. This request will not run again automatically.";
      }
      dispatch.pendingResult = true;
      await this.recordDispatch(dispatch);
      try { await this.reportResult(dispatch); } catch (error) { reportError = error; }
    }
    if (reportError) throw reportError;
  }
  async rememberStatus(value: unknown): Promise<MessagingStatus> {
    const status = safeMessagingStatus(value);
    this.acceptStatus(status);
    this.failure = undefined;
    await this.changed().catch(() => {});
    return status;
  }
  sync(manual = false): Promise<MessagingStatus | null> {
    // A gateway without Photon credentials should not receive automatic retries.
    if (!manual && this.status?.configured === false) return Promise.resolve(this.status);
    this.revision++;
    if (this.running) return this.running;
    const operation = (async () => {
      let completedRevision: number;
      do {
        completedRevision = this.revision;
        const ownerRevision = this.ownerRevision;
        const pendingAcks = await this.transaction(async () => (await this.read()).pendingAcks);
        const status = safeMessagingStatus(await this.post("/api/messaging/sync", {
          workspace: await this.workspace(), captureAcks: pendingAcks,
        }));
        await this.transaction(async () => {
          const state = await this.read();
          const imported = new Set(state.importedIds);
          const acks = new Set(state.pendingAcks.filter((value) => !pendingAcks.includes(value)));
          for (const item of status.captures) {
            if (!imported.has(item.id)) {
              state.captures.push(item);
              imported.add(item.id);
            }
            // The same ID may be redelivered after a lost acknowledgement response.
            acks.add(item.id);
          }
          state.importedIds = [...imported];
          state.pendingAcks = [...acks];
          await this.save(state);
        });
        const currentOwner = ownerRevision === this.ownerRevision;
        if (currentOwner) this.acceptStatus(status);
        this.failure = undefined;
        if (currentOwner) await this.browserRequests(status, this.ownerRevision);
        await this.changed().catch(() => {});
      } while (completedRevision !== this.revision && this.status?.configured !== false);
      return this.status;
    })().catch(async (error: unknown) => {
      this.failure = error instanceof Error ? error.message : "HypeMan couldn't sync its phone inbox.";
      await this.changed().catch(() => {});
      throw error;
    }).finally(() => { this.running = null; });
    this.running = operation;
    return operation;
  }
  async inbox(sync = true): Promise<{ captures: MessagingCapture[]; status: MessagingStatus | null; error?: string }> {
    if (sync) await this.sync(true).catch(() => {});
    const state = await this.transaction(() => this.read());
    return { captures: state.captures, status: this.failure ? null : this.status,
      ...(this.failure ? { error: this.failure } : {}) };
  }
  async dismiss(captureId: unknown): Promise<void> {
    if (!id(captureId)) throw new Error("Choose a phone capture.");
    await this.transaction(async () => {
      const state = await this.read();
      state.captures = state.captures.filter((item) => item.id !== captureId);
      await this.save(state);
    });
    await this.changed().catch(() => {});
  }
  async continue<T>(captureId: unknown, launch: (capture: MessagingCapture) => Promise<T>): Promise<T> {
    if (!id(captureId)) throw new Error("Choose a phone capture.");
    // Claim durably before dispatch: duplicate clicks or a worker restart cannot launch twice.
    const item = await this.transaction(async () => {
      const state = await this.read();
      const item = state.captures.find((value) => value.id === captureId);
      if (!item) throw new Error("This phone capture was already handled.");
      state.captures = state.captures.filter((value) => value.id !== captureId);
      await this.save(state);
      return item;
    });
    try {
      const result = await launch(item);
      await this.changed().catch(() => {});
      return result;
    } catch (error) {
      await this.transaction(async () => {
        const state = await this.read();
        if (!state.captures.some((value) => value.id === item.id)) state.captures.push(item);
        await this.save(state);
      });
      await this.changed().catch(() => {});
      throw error;
    }
  }
}
