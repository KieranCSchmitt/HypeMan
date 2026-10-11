import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { replaceFileAtomically } from "./atomic-file";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { emptyWorkspace, parseWorkspace, parseMessagingSettings, safePageUrl, parseReminderRecurrence, parseReminderDraft, type ReminderDraft, type CompanionSnapshot, type DailyCommitment, type DeliverySummary, type MessagingCapture, type MessagingSettings, type PhoneReminder, type PhoneBrowserRequest } from "@core";
import type { IncomingPhoneMessage } from "./photon";
import { GatewayError } from "./errors";

export interface OutgoingPhoneMessage extends DeliverySummary {
  phone: string;
  spaceId?: string;
  providerId?: string;
}
export interface StoredPhoneBrowserRequest extends PhoneBrowserRequest {
  claimId?: string;
  claimedAt?: number;
}
export interface MessagingState {
  version: 1;
  owner: { phone: string; spaceId: string } | null;
  pairing: { phone: string; hash: string; expiresAt: number; attempts: number } | null;
  settings: MessagingSettings;
  captures: MessagingCapture[];
  browserRequests: StoredPhoneBrowserRequest[];
  reminders: PhoneReminder[];
  commitments: DailyCommitment[];
  outbox: OutgoingPhoneMessage[];
  received: { message: IncomingPhoneMessage; done: boolean }[];
  turns: { id: string; role: "user" | "assistant"; text: string; at: number }[];
  workspace: CompanionSnapshot;
  lastSyncedAt: number;
  baseline: boolean;
  notifications: { id: string; text: string; createdAt: number }[];
  checkIns: string[];
  reminderDraft?: ReminderDraft | null;
}
export const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export const boundedText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 8_640_000_000_000_000;
const phone = (value: unknown): value is string => typeof value === "string" && /^\+[1-9]\d{7,14}$/.test(value);
const fresh = (): MessagingState => ({
  version: 1, owner: null, pairing: null, settings: parseMessagingSettings(null), captures: [], browserRequests: [], reminders: [], commitments: [], outbox: [], received: [], turns: [], workspace: emptyWorkspace(), lastSyncedAt: 0, baseline: false, notifications: [], checkIns: [],
});

/** Single-process atomic snapshots, using the same private-file boundary as account storage. */
export class MessagingStore {
  readonly path: string;
  state: MessagingState;
  private saved?: string;
  constructor(directory = join(homedir(), ".config", "hypeman")) {
    this.path = join(directory, "messaging.json");
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const dir = lstatSync(directory);
      if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Error("Invalid directory");
      chmodSync(directory, 0o700);
      this.state = fresh();
      if (existsSync(this.path)) {
        const stat = lstatSync(this.path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_000_000) throw new Error("Invalid file");
        chmodSync(this.path, 0o600);
        const value: unknown = JSON.parse(readFileSync(this.path, "utf8"));
        if (!object(value) || value.version !== 1 || !finite(value.lastSyncedAt) || typeof value.baseline !== "boolean") throw new Error("Invalid state");
        for (const key of ["captures", "reminders", "commitments", "outbox", "received", "turns", "notifications", "checkIns"])
          if (!Array.isArray(value[key])) throw new Error("Invalid collection");
        if (value.owner !== null && (!object(value.owner) || !phone(value.owner.phone) || !boundedText(value.owner.spaceId, 4096))) throw new Error("Invalid owner");
        if (value.pairing !== null && (!object(value.pairing) || !phone(value.pairing.phone) || typeof value.pairing.hash !== "string" || !/^[a-f0-9]{64}$/.test(value.pairing.hash) || !finite(value.pairing.expiresAt) || !finite(value.pairing.attempts))) throw new Error("Invalid pairing");
        const arrays = value as unknown as MessagingState;
        const browserRequests = value.browserRequests === undefined ? [] : value.browserRequests;
        if (!Array.isArray(browserRequests) || !browserRequests.every(r => object(r) && boundedText(r.id, 300) &&
          typeof r.conversationId === "string" && /^[\w.-]{1,160}$/.test(r.conversationId) && boundedText(r.goal, 2000) &&
          finite(r.createdAt) && finite(r.updatedAt) && ["queued", "claimed", "started", "failed", "cancelled", "unknown"].includes(String(r.status)) &&
          (r.url === undefined || boundedText(r.url, 4096) && !!safePageUrl(r.url)) &&
          (r.error === undefined || boundedText(r.error, 1000)) &&
          (r.claimId === undefined || boundedText(r.claimId, 300)) && (r.claimedAt === undefined || finite(r.claimedAt)) &&
          (r.status !== "claimed" || boundedText(r.claimId, 300) && finite(r.claimedAt)))) throw new Error("Invalid browser requests");
        if (!arrays.captures.every(c => object(c) && boundedText(c.id, 300) && ["idea", "goal", "link"].includes(c.kind) && boundedText(c.text, 6000) && finite(c.createdAt) && (c.url === undefined || (boundedText(c.url, 4096) && /^https?:\/\//.test(c.url))) && (c.importedAt === undefined || finite(c.importedAt)))) throw new Error("Invalid captures");
        if (!arrays.reminders.every(r => object(r) && boundedText(r.id, 300) && boundedText(r.text, 2000) && finite(r.dueAt) && finite(r.createdAt) && ["pending", "sent", "cancelled", "failed", "unknown"].includes(r.status) &&
          (r.recurrence === undefined || !!parseReminderRecurrence(r.recurrence)) && (r.anchorAt === undefined || finite(r.anchorAt)) && (r.paused === undefined || typeof r.paused === "boolean") && (r.seriesId === undefined || boundedText(r.seriesId, 300)) && (r.ownerPhone === undefined || phone(r.ownerPhone)) && (r.requestSignature === undefined || typeof r.requestSignature === "string" && /^[a-f0-9]{64}$/.test(r.requestSignature)) &&
          (r.lastDelivery === undefined || object(r.lastDelivery) && finite(r.lastDelivery.dueAt) && ["sent", "failed", "unknown"].includes(r.lastDelivery.status)))) throw new Error("Invalid reminders");
        if (arrays.reminderDraft !== undefined && arrays.reminderDraft !== null && !parseReminderDraft(arrays.reminderDraft)) throw new Error("Invalid reminder draft");
        if (!arrays.commitments.every(c => object(c) && boundedText(c.id, 300) && /^\d{4}-\d{2}-\d{2}$/.test(c.date) && boundedText(c.text, 2000) && typeof c.done === "boolean" && finite(c.createdAt))) throw new Error("Invalid commitments");
        if (!arrays.outbox.every(d => object(d) && boundedText(d.id, 300) && boundedText(d.text, 8000) && phone(d.phone) && finite(d.at) && ["pending", "sent", "failed", "unknown"].includes(d.status) && (d.spaceId === undefined || boundedText(d.spaceId, 4096)))) throw new Error("Invalid outbox");
        if (!arrays.received.every(r => object(r) && typeof r.done === "boolean" && object(r.message) && boundedText(r.message.id, 200) && phone(r.message.sender) && boundedText(r.message.spaceId, 4096) && boundedText(r.message.text, 6000) && finite(r.message.at) && typeof r.message.fromMe === "boolean" && typeof r.message.isGroup === "boolean")) throw new Error("Invalid inbound receipts");
        if (!arrays.turns.every(t => object(t) && boundedText(t.id, 300) && ["user", "assistant"].includes(t.role) && boundedText(t.text, 8000) && finite(t.at))) throw new Error("Invalid conversation");
        if (!arrays.notifications.every(n => object(n) && boundedText(n.id, 300) && boundedText(n.text, 2000) && finite(n.createdAt)) || !arrays.checkIns.every(s => boundedText(s, 200))) throw new Error("Invalid scheduling state");
        this.state = { ...arrays, browserRequests, settings: parseMessagingSettings(value.settings), workspace: parseWorkspace(value.workspace) };
      }
      // A crash after dispatch may have delivered. Never replay such sends automatically.
      for (const delivery of this.state.outbox)
        if (delivery.status === "pending") { delivery.status = "unknown"; delivery.error = "Gateway restarted before delivery was confirmed."; }
      if (this.state.owner) for (const reminder of this.state.reminders) reminder.ownerPhone ??= this.state.owner.phone;
      this.save();
    } catch {
      throw new GatewayError(503, "Phone storage could not be opened. Check ~/.config/hypeman/messaging.json; existing data was preserved.", "messaging_storage_error");
    }
  }
  save(): void {
    const state = this.state;
    state.turns = state.turns.slice(-100);
    state.checkIns = state.checkIns.slice(-100);
    const terminalBrowserIds = new Set(state.browserRequests.filter(r => !["queued", "claimed"].includes(r.status)).slice(-1000).map(r => r.id));
    state.browserRequests = state.browserRequests.filter(r => ["queued", "claimed"].includes(r.status) || terminalBrowserIds.has(r.id));
    // Retain unresolved receipts/sends, and never silently evict captures or active reminders.
    const retainedReceipts = new Set(state.received.filter(r => r.done).slice(-5000).map(r => r.message.id));
    const retainedSends = new Set(state.outbox.filter(d => d.status === "sent").slice(-1000).map(d => d.id));
    state.received = state.received.filter(r => !r.done || retainedReceipts.has(r.message.id));
    state.outbox = state.outbox.filter(d => d.status !== "sent" || retainedSends.has(d.id));
    const serialized = JSON.stringify(state);
    if (serialized.length > 16_000_000) {
      if (this.saved) this.state = JSON.parse(this.saved) as MessagingState;
      throw new GatewayError(507, "Phone storage is full. Remove old inbox items or reminders.");
    }
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporary, "wx", 0o600);
      writeFileSync(descriptor, serialized, "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor); descriptor = undefined;
      replaceFileAtomically(temporary, this.path);
      this.saved = serialized;
    } catch {
      if (this.saved) this.state = JSON.parse(this.saved) as MessagingState;
      throw new GatewayError(503, "Phone changes could not be saved. Check the local app directory.", "messaging_storage_error");
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      try { unlinkSync(temporary); } catch { /* already renamed */ }
    }
  }
}
