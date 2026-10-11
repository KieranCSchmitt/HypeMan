import { validMessagingTimezone } from "./messaging";
import { reminderWallTime } from "./reminder-conversation";

export interface ReminderRecurrence {
  frequency: "daily" | "weekly";
  interval: number;
  timezone: string;
  hour: number;
  minute: number;
  weekdays?: number[];
  until?: number;
  exceptions?: string[];
}
export function reminderLocalDate(at: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (name: string) => parts.find((part) => part.type === name)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
export function parseReminderRecurrence(value: unknown): ReminderRecurrence | null {
  if (!object(value) || Object.keys(value).some((key) => !["frequency", "interval", "timezone", "hour", "minute", "weekdays", "until", "exceptions"].includes(key)) ||
    !["daily", "weekly"].includes(String(value.frequency)) || !integer(value.interval, 1, 52) || !validMessagingTimezone(value.timezone) ||
    !integer(value.hour, 0, 23) || !integer(value.minute, 0, 59) ||
    (value.until !== undefined && (typeof value.until !== "number" || !Number.isFinite(value.until) || value.until < 0)) ||
    (value.weekdays !== undefined && (!Array.isArray(value.weekdays) || !value.weekdays.length || value.weekdays.length > 7 || !value.weekdays.every((day) => integer(day, 0, 6)) || new Set(value.weekdays).size !== value.weekdays.length)) ||
    (value.frequency === "daily" && value.weekdays !== undefined) ||
    (value.exceptions !== undefined && (!Array.isArray(value.exceptions) || value.exceptions.length > 366 || !value.exceptions.every((date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && reminderWallTime(date, 12, 0, value.timezone as string).length)))) return null;
  return { frequency: value.frequency as ReminderRecurrence["frequency"], interval: value.interval, timezone: value.timezone, hour: value.hour, minute: value.minute,
    ...(value.weekdays ? { weekdays: [...value.weekdays as number[]].sort() } : {}), ...(typeof value.until === "number" ? { until: value.until } : {}),
    ...(value.exceptions ? { exceptions: [...new Set(value.exceptions as string[])].sort() } : {}) };
}
/** Wall-clock recurrence; DST gaps are skipped and repeated hours produce one occurrence. */
export function nextReminderOccurrence(rule: ReminderRecurrence, anchor: number, after: number): number | null {
  const parsed = parseReminderRecurrence(rule);
  if (!parsed || !Number.isFinite(anchor) || !Number.isFinite(after)) throw new Error("Invalid recurring reminder.");
  const first = reminderLocalDate(anchor, rule.timezone), current = reminderLocalDate(Math.max(anchor, after), rule.timezone);
  const firstDay = Date.parse(`${first}T12:00:00Z`), startDay = Date.parse(`${current}T12:00:00Z`);
  const anchorWeekday = new Date(firstDay).getUTCDay();
  for (let offset = 0; offset < 366 * 8; offset++) {
    const day = startDay + offset * 86400000, date = new Date(day).toISOString().slice(0, 10);
    const days = Math.round((day - firstDay) / 86400000), weekday = new Date(day).getUTCDay();
    const eligible = days >= 0 && (rule.frequency === "daily" ? days % rule.interval === 0 :
      Math.floor((days + anchorWeekday) / 7) % rule.interval === 0 && (rule.weekdays || [anchorWeekday]).includes(weekday));
    if (!eligible || rule.exceptions?.includes(date)) continue;
    const candidate = reminderWallTime(date, rule.hour, rule.minute, rule.timezone)[0];
    if (candidate !== undefined && candidate >= anchor && candidate > after) return rule.until !== undefined && candidate > rule.until ? null : candidate;
    if (rule.until !== undefined && day > rule.until + 86400000) return null;
  }
  return null;
}
export function validReminderStart(dueAt: number, rule: ReminderRecurrence): boolean {
  if (!parseReminderRecurrence(rule) || !Number.isFinite(dueAt)) return false;
  const date = reminderLocalDate(dueAt, rule.timezone), weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return reminderWallTime(date, rule.hour, rule.minute, rule.timezone).includes(dueAt) && !rule.exceptions?.includes(date) &&
    (rule.until === undefined || dueAt <= rule.until) && (rule.frequency !== "weekly" || !rule.weekdays || rule.weekdays.includes(weekday));
}
