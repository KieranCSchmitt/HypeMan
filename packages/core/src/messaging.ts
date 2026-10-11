import type { CompanionSnapshot } from "./workspace";

export interface MessagingSettings {
  coachingEnabled: boolean;
  morningTime: string;
  eveningTime: string;
  timezone: string;
  projectUpdates: boolean;
  proactiveEnabled: boolean;
}
export const DEFAULT_MESSAGING_SETTINGS: MessagingSettings = {
  coachingEnabled: true,
  morningTime: "09:00",
  eveningTime: "19:00",
  timezone: "America/New_York",
  projectUpdates: false,
  proactiveEnabled: true,
};
export interface MessagingCapture {
  id: string;
  kind: "idea" | "goal" | "link";
  text: string;
  url?: string;
  createdAt: number;
  importedAt?: number;
}
export interface PhoneReminder {
  id: string;
  text: string;
  dueAt: number;
  status: "pending" | "sent" | "cancelled" | "failed" | "unknown";
  createdAt: number;
}
export interface DailyCommitment {
  id: string;
  date: string;
  text: string;
  done: boolean;
  createdAt: number;
}
export interface DeliverySummary {
  id: string;
  text: string;
  status: "pending" | "sent" | "failed" | "unknown";
  at: number;
  error?: string;
}
/** The desktop code remains usable when the invitation's delivery is uncertain. */
export interface MessagingPairingResult {
  code: string;
  expiresAt: number;
  deliveryStatus: "sent" | "unknown";
}
export interface MessagingStatus {
  configured: boolean;
  connected: boolean;
  paired: boolean;
  ownerPhone?: string;
  error?: string;
  lastSyncedAt: number;
  settings: MessagingSettings;
  captures: MessagingCapture[];
  reminders: PhoneReminder[];
  commitments: DailyCommitment[];
  deliveries: DeliverySummary[];
}
export interface MessagingSync {
  workspace: CompanionSnapshot;
  captureAcks: string[];
}
/** Phone intents deliberately contain no browser actions or arbitrary recipients. */
export type PhoneIntent =
  | { type: "capture"; kind: MessagingCapture["kind"]; text: string; url?: string }
  | { type: "reminder"; text: string; dueAt: number }
  | { type: "commitment"; text: string }
  | { type: "commitment_done"; id: string };

export function validMessagingTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 100) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; }
  catch { return false; }
}
export function parseMessagingSettings(value: unknown): MessagingSettings {
  const settings = { ...DEFAULT_MESSAGING_SETTINGS };
  if (!value || typeof value !== "object" || Array.isArray(value)) return settings;
  const input = value as Record<string, unknown>;
  for (const key of ["coachingEnabled", "projectUpdates", "proactiveEnabled"] as const)
    if (typeof input[key] === "boolean") settings[key] = input[key];
  for (const key of ["morningTime", "eveningTime"] as const)
    if (typeof input[key] === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(input[key]))
      settings[key] = input[key];
  if (validMessagingTimezone(input.timezone)) settings.timezone = input.timezone;
  return settings;
}
export function unavailableMessagingStatus(error = "Configure Photon in the local gateway to connect your phone."): MessagingStatus {
  return {
    configured: false, connected: false, paired: false, error, lastSyncedAt: 0,
    settings: { ...DEFAULT_MESSAGING_SETTINGS }, captures: [], reminders: [], commitments: [], deliveries: [],
  };
}
