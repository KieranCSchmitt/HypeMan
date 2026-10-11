import {
  isRecord,
  safePageUrl,
  validMessagingTimezone,
  type CompanionSnapshot,
  type MessagingCapture,
  type MessagingStatus,
} from "@core";

export const MESSAGING_INBOX_KEY = "hypeman.messaging.inbox";
export const MESSAGING_ALARM = "hypeman.messaging.sync";

interface InboxState {
  version: 1;
  captures: MessagingCapture[];
  importedIds: string[];
  pendingAcks: string[];
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
    reminders: list(value.reminders, (item) => {
      if (!isRecord(item) || !id(item.id) || !text(item.text, 8000) || !stamp(item.dueAt) ||
          !stamp(item.createdAt) || !["pending", "sent", "cancelled", "failed", "unknown"].includes(String(item.status)))
        throw new Error("The local server returned an invalid phone reminder.");
      return { id: item.id, text: item.text, dueAt: item.dueAt, createdAt: item.createdAt,
        status: item.status as MessagingStatus["reminders"][number]["status"] };
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
    return { version: 1, captures: [], importedIds: [], pendingAcks: [] };
  // Corrupt local inboxes must fail visibly instead of acknowledging and losing phone captures.
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.captures) || !Array.isArray(value.importedIds) ||
      !value.importedIds.every(id) || !Array.isArray(value.pendingAcks) || !value.pendingAcks.every(id))
    throw new Error("HypeMan's phone inbox could not be read. Restore its local storage before syncing.");
  const captures = value.captures.map(capture);
  const imported = new Set([...value.importedIds, ...captures.map((item) => item.id)]);
  if (value.pendingAcks.some((ack) => !imported.has(ack)))
    throw new Error("HypeMan's phone inbox contains an acknowledgement without a saved capture.");
  return { version: 1, captures, importedIds: [...imported], pendingAcks: [...new Set(value.pendingAcks)] };
}

/** A capture is durably imported before acknowledgement, and never dispatches browser work here. */
export class PhoneSync {
  private queue: Promise<unknown> = Promise.resolve();
  private running: Promise<MessagingStatus | null> | null = null;
  private revision = 0;
  private status: MessagingStatus | null = null;
  private failure: string | undefined;
  constructor(
    private storage: Storage,
    private workspace: () => Promise<CompanionSnapshot>,
    private post: (path: string, body: unknown) => Promise<unknown>,
    private changed: () => Promise<void> = async () => {},
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
  async rememberStatus(value: unknown): Promise<MessagingStatus> {
    const status = safeMessagingStatus(value);
    this.status = status;
    this.failure = undefined;
    await this.changed().catch(() => {});
    return status;
  }
  sync(manual = false): Promise<MessagingStatus | null> {
    // A gateway without Photon credentials should not receive minute-by-minute retries.
    if (!manual && this.status?.configured === false) return Promise.resolve(this.status);
    this.revision++;
    if (this.running) return this.running;
    const operation = (async () => {
      let completedRevision: number;
      do {
        completedRevision = this.revision;
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
        this.status = status;
        this.failure = undefined;
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
