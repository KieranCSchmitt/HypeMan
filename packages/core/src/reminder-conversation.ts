import { validMessagingTimezone } from "./messaging";
import { nextReminderOccurrence, parseReminderRecurrence, type ReminderRecurrence } from "./reminder-recurrence";

export interface ReminderDraft {
  text?: string;
  hour?: number;
  minute?: number;
  meridiem?: "AM" | "PM";
  date?: string;
  day?: "today" | "tomorrow";
  weekday?: number;
  nextWeek?: boolean;
  timezone: string;
  timezoneUnresolved?: boolean;
  needsDate?: boolean;
  dueAt?: number;
  updatedAt: number;
  requestId: string;
  sourceMessage?: string;
  repeat?: { frequency: "daily" | "weekly"; interval: number; weekdays?: number[] };
  recurrence?: ReminderRecurrence;
}
export type ReminderTurn = { kind: "unrelated" } | { kind: "cancel" } | {
  kind: "reminder"; draft: ReminderDraft; question?: string; dueAt?: number; label?: string;
};
const intent = /^(?:please[, ]*)?(?:(?:can|could|would|will) you\s+)?(?:remind me\b|(?:set|create|schedule)(?: me)? (?:a )?(?:text )?reminder\b|send me (?:a )?(?:text )?reminder\b|(?:I need|I'd like) (?:a )?(?:text )?reminder\b|don't let me forget\b|reminder:)|^(?:text me|send me a text)\b.*\b(?:at|in|tomorrow|tonight|noon|midnight)\b/i;
const zones: Record<string, string> = {
  est: "Etc/GMT+5", edt: "Etc/GMT+4", et: "America/New_York", eastern: "America/New_York",
  cst: "Etc/GMT+6", cdt: "Etc/GMT+5", ct: "America/Chicago", central: "America/Chicago",
  mst: "Etc/GMT+7", mdt: "Etc/GMT+6", mt: "America/Denver", mountain: "America/Denver",
  pst: "Etc/GMT+8", pdt: "Etc/GMT+7", pt: "America/Los_Angeles", pacific: "America/Los_Angeles",
  utc: "UTC", gmt: "UTC",
};
const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const numbers: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fortyfive: 45, sixty: 60 };
function parts(at: number, timezone: string) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(at).map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second) };
}
const dateKey = ({ year, month, day }: ReturnType<typeof parts>) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
function addDays(date: string, days: number) { return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10); }

/** Enumerate actual offsets: handles daylight-saving gaps and repeated hours without normalizing invalid dates. */
export function reminderWallTime(date: string, hour: number, minute: number, timezone: string): number[] {
  const nominal = Date.parse(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  if (!Number.isFinite(nominal)) return [];
  const found = new Set<number>();
  for (const delta of [-86400000, -43200000, 0, 43200000, 86400000]) {
    const probe = nominal + delta, local = parts(probe, timezone);
    const offset = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - probe;
    const candidate = nominal - offset, actual = parts(candidate, timezone);
    if (dateKey(actual) === date && actual.hour === hour && actual.minute === minute) found.add(candidate);
  }
  return [...found].sort((a, b) => a - b);
}
export function reminderTimeLabel(at: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(at);
}
export function parseReminderDraft(value: unknown): ReminderDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const draft = value as ReminderDraft;
  if (!validMessagingTimezone(draft.timezone) || !Number.isFinite(draft.updatedAt) || draft.updatedAt < 0 || typeof draft.requestId !== "string" || !/^[\w.-]{1,160}$/.test(draft.requestId) ||
    (draft.text !== undefined && (typeof draft.text !== "string" || draft.text.length > 2000)) || (draft.sourceMessage !== undefined && (typeof draft.sourceMessage !== "string" || draft.sourceMessage.length > 4000)) ||
    (draft.hour !== undefined && (!Number.isInteger(draft.hour) || draft.hour < 0 || draft.hour > 99)) || (draft.minute !== undefined && (!Number.isInteger(draft.minute) || draft.minute < 0 || draft.minute > 99)) || (draft.weekday !== undefined && (!Number.isInteger(draft.weekday) || draft.weekday < 0 || draft.weekday > 6)) || (draft.dueAt !== undefined && (!Number.isFinite(draft.dueAt) || draft.dueAt < 0)) ||
    (draft.meridiem !== undefined && !["AM", "PM"].includes(draft.meridiem)) || (draft.day !== undefined && !["today", "tomorrow"].includes(draft.day)) || (draft.date !== undefined && (typeof draft.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date))) ||
    [draft.timezoneUnresolved, draft.needsDate, draft.nextWeek].some(value => value !== undefined && typeof value !== "boolean") ||
    (draft.repeat !== undefined && (!draft.repeat || !parseReminderRecurrence({ ...draft.repeat, timezone: draft.timezone, hour: 0, minute: 0 }))) ||
    (draft.recurrence !== undefined && !parseReminderRecurrence(draft.recurrence))) return null;
  return structuredClone(draft);
}

export function reminderConversation(message: string, previous: ReminderDraft | null, clock: { now: number; timezone: string }, requestId: string): ReminderTurn {
  const text = message.trim().replace(/^(?:(?:actually|sorry|yes|yeah|yep|okay|ok)[,\s]+)+/i, "").replace(/[.!?]+$/, "").replace(/\b(in|at)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|sixty)\b/gi, (_, prefix, number) => `${prefix} ${numbers[number.toLowerCase()]}`), fresh = intent.test(text);
  const pending = previous && clock.now - previous.updatedAt < 30 * 60000 ? previous : null;
  if (!fresh && !pending) return { kind: "unrelated" };
  // The planner can supply typed end dates and exceptions; this small slot parser must not drop them.
  if (/\b(?:except|excluding|until|ending|starting from|starting on)\b/i.test(text) && (pending?.repeat || /\b(?:every|daily|weekly|repeat)\b/i.test(text))) return { kind: "unrelated" };
  // A reminder is only one part of these requests; preserve the entire request for the planner.
  if (!pending && /(?:[,;]\s*|\s+(?:and|then|also)\s+)(?:(?:then|also)\s+)?(?:save|text|send|open|find|search|compare|draw|create|summarize|explain|make|export|download)\b/i.test(text)) return { kind: "unrelated" };
  if (pending && /^(?:cancel(?: (?:it|that|the reminder))?|never ?mind|forget (?:it|that))[.!]?$/i.test(text)) return { kind: "cancel" };
  if (!fresh && /^(?:am|pm)\s+(?:I|you|we|they)\b/i.test(text)) return { kind: "unrelated" };
  if (fresh && pending?.sourceMessage === text && pending.dueAt !== undefined && pending.dueAt > clock.now)
    return { kind: "reminder", draft: { ...pending, updatedAt: clock.now }, dueAt: pending.dueAt, label: reminderTimeLabel(pending.dueAt, pending.timezone) };
  const followup = /^(?:(?:the )?next |(?:at |on |for |make (?:it|that) |use |in |actually[, ]*|yes[, ]*)?)(?:\d|am\b|pm\b|today\b|tomorrow\b|tonight\b|noon\b|midnight\b|est\b|edt\b|et\b|pst\b|pdt\b|pt\b|utc\b|gmt\b|eastern\b|pacific\b|[A-Za-z_]+\/[A-Za-z_]+)|time ?zone|^try again$|^to .+|\b(?:meant|mean|instead)\b/i.test(text);
  if (!fresh && !followup && !(!pending?.text && !/\?|^(?:what|why|how|open|show|explain|find|compare|search)\b/i.test(text))) return { kind: "unrelated" };
  const draft: ReminderDraft = fresh ? { timezone: validMessagingTimezone(clock.timezone) ? clock.timezone : "America/New_York", updatedAt: clock.now, requestId, sourceMessage: text } : { ...pending!, updatedAt: clock.now };
  const zone = text.match(/\b([A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?|EST|EDT|ET|Eastern|CST|CDT|CT|Central|MST|MDT|MT|Mountain|PST|PDT|PT|Pacific|UTC|GMT)\b/i)?.[1];
  if (zone) { draft.timezone = zones[zone.toLowerCase()] || (validMessagingTimezone(zone) ? zone : draft.timezone); draft.timezoneUnresolved = !zones[zone.toLowerCase()] && !validMessagingTimezone(zone); delete draft.dueAt; }
  const repeated = text.match(/\bevery\s+(?:(\d+)\s+)?(days?|weeks?)\b/i);
  if (repeated || /\b(daily|weekly|every weekday|every weekend|every (?:sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/i.test(text)) {
    const weekly = repeated ? /^week/i.test(repeated[2]) : /\bweekly|every (?!day)(?:weekday|weekend|sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i.test(text);
    const selectedDays = weekdays.flatMap((day, index) => new RegExp(`\\b${day}\\b`, "i").test(text) ? [index] : []);
    draft.repeat = { frequency: weekly ? "weekly" : "daily", interval: repeated?.[1] ? Number(repeated[1]) : 1,
      ...(weekly && (/every weekday/i.test(text) || /every weekend/i.test(text) || selectedDays.length) ? { weekdays: /every weekday/i.test(text) ? [1, 2, 3, 4, 5] : /every weekend/i.test(text) ? [0, 6] : selectedDays } : {}) };
    delete draft.needsDate;
  }
  const offset = text.match(/\b(?:UTC|GMT)\s*([+-])(\d{1,2})(?::(\d{2}))?\b/i);
  if (offset) {
    const candidate = Number(offset[2]) ? `Etc/GMT${offset[1] === "+" ? "-" : "+"}${Number(offset[2])}` : "UTC";
    draft.timezoneUnresolved = !!Number(offset[3] || 0) || !validMessagingTimezone(candidate);
    if (!draft.timezoneUnresolved) draft.timezone = candidate;
  }
  const relative = text.match(/\bin\s+(\d+(?:\.\d+)?|an?|half(?: an?)?)\s+(minutes?|mins?|hours?|hrs?|days?|weeks?)\b/i);
  if (relative) {
    const amount = /^half/i.test(relative[1]) ? .5 : /^an?$/i.test(relative[1]) ? 1 : Number(relative[1]);
    draft.dueAt = clock.now + amount * (/^week/i.test(relative[2]) ? 7 * 86400000 : /^day/i.test(relative[2]) ? 86400000 : /^h/i.test(relative[2]) ? 3600000 : 60000); delete draft.needsDate;
  }
  const explicitDate = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (explicitDate) { draft.date = explicitDate; delete draft.day; delete draft.weekday; delete draft.dueAt; delete draft.needsDate; }
  const namedDate = text.match(new RegExp(`\\b(${months.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "i"));
  const numericDate = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  if (namedDate || numericDate) {
    const local = parts(clock.now, draft.timezone), month = namedDate ? months.indexOf(namedDate[1].toLowerCase()) + 1 : Number(numericDate![1]), day = Number((namedDate || numericDate)![2]);
    const yearText = (namedDate || numericDate)![3];
    let year = yearText ? Number(yearText) : local.year;
    let date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!yearText && date < dateKey(local)) { year++; date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
    draft.date = date; delete draft.day; delete draft.weekday; delete draft.dueAt; delete draft.needsDate;
  }
  const day = text.match(/\b(today|tomorrow|tonight)\b/i)?.[1]?.toLowerCase();
  if (day) { draft.day = day === "tomorrow" ? "tomorrow" : "today"; delete draft.date; delete draft.weekday; delete draft.dueAt; delete draft.needsDate; }
  const weekday = weekdays.findIndex((day) => new RegExp(`\\b${day}\\b`, "i").test(text));
  if (weekday >= 0) { draft.weekday = weekday; draft.nextWeek = /\bnext\b/i.test(text); delete draft.day; delete draft.date; delete draft.dueAt; delete draft.needsDate; }
  const meridiem = text.match(/(?:\b|\d)(a\.?m\.?|p\.?m\.?)(?=\b|$)/i)?.[1];
  if (meridiem) { draft.meridiem = meridiem.toLowerCase().startsWith("a") ? "AM" : "PM"; delete draft.dueAt; }
  const time = text.match(/(?:\bat\s+|\bnext\s+|^)(\d{1,2})(?::(\d{2}))?(?:\s*(?:a\.?m\.?|p\.?m\.?))?(?=\s|,|$)/i) || text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (time && !relative && !explicitDate?.startsWith(time[0])) {
    draft.hour = Number(time[1]); draft.minute = Number(time[2] || 0); delete draft.dueAt;
    if (draft.hour === 0 || draft.hour > 12) delete draft.meridiem;
  }
  if (day === "tonight" && draft.hour !== undefined && draft.hour > 0 && draft.hour < 12 && !draft.meridiem) draft.meridiem = "PM";
  if (/\b(noon|midnight)\b/i.test(text)) { draft.hour = /\bnoon\b/i.test(text) ? 12 : 0; draft.minute = 0; draft.meridiem = "AM"; if (draft.hour === 12) draft.meridiem = "PM"; delete draft.dueAt; }
  let reminderText = text.replace(/^(?:please[, ]*)?(?:(?:can|could|would|will) you\s+)?(?:remind me(?: to)?|(?:set|create|schedule)(?: me)? (?:a )?(?:text )?reminder(?: to)?|(?:I need|I'd like) (?:a )?(?:text )?reminder(?: to)?|don't let me forget(?: to)?|reminder:|(?:send me (?:a )?(?:text )?reminder|text me|send me a text))\s*/i, "");
  const afterTo = reminderText.match(/^(?:at|on|in|tomorrow|today|tonight|\d)[\s\S]*?\b(?:to|about)\s+(.+)$/i);
  if (afterTo) reminderText = afterTo[1];
  reminderText = reminderText.replace(new RegExp(`\\s+\\b(?:at\\s+(?:\\d|noon|midnight)|in\\s+(?:\\d|an?\\b|half)|on\\s+(?:\\d|${months.join("|")}|(?:next )?(?:${weekdays.join("|")}))|tomorrow\\b|today\\b|tonight\\b).*`, "i"), "").replace(/^(?:to|about)\s+/i, "").trim();
  reminderText = reminderText.replace(/\s+\b(?:every|daily|weekly|repeat)\b.*$/i, "").trim();
  if (fresh && reminderText && !/^(?:at|in|on|tomorrow|today|tonight|\d)/i.test(reminderText)) draft.text = reminderText.slice(0, 2000);
  else if (!fresh && /^to\s+/i.test(text)) draft.text = text.replace(/^to\s+/i, "").slice(0, 2000);
  else if (!fresh && !draft.text && !followup) draft.text = text.slice(0, 2000);
  const result = (question: string): ReminderTurn => ({ kind: "reminder", draft, question });
  if (draft.timezoneUnresolved) return result("Which timezone should I use? For example, ET or America/New_York.");
  if (/\b(?:next month|next year|this weekend|after work|later)\b/i.test(text) && !draft.date) return result("Which day and time should I use?");
  if (/\b(?:every|daily|weekly|repeat)\b/i.test(text) && !draft.repeat) return result("Should this repeat daily or weekly, and at what time?");
  if (draft.repeat && (!Number.isInteger(draft.repeat.interval) || draft.repeat.interval < 1 || draft.repeat.interval > 52)) return result("Use a repeat interval from 1 to 52 days or weeks.");
  if (!draft.text) return result("What should I remind you to do?");
  if (draft.dueAt === undefined && draft.hour === undefined) return result(`When should I text you to ${draft.text}?`);
  if (draft.dueAt === undefined && (draft.hour! > 23 || draft.minute! > 59)) return result("What time should I use? For example, 12:30 AM.");
  if (draft.dueAt === undefined && draft.hour! >= 1 && draft.hour! <= 12 && !draft.meridiem) return result(`${draft.hour}:${String(draft.minute).padStart(2, "0")} AM or PM?`);
  if (draft.dueAt === undefined) {
    const local = parts(clock.now, draft.timezone), today = dateKey(local);
    const hour = draft.meridiem ? draft.hour! % 12 + (draft.meridiem === "PM" ? 12 : 0) : draft.hour!;
    let date = draft.date || addDays(today, draft.day === "tomorrow" ? 1 : 0);
    if (draft.weekday !== undefined) {
      const currentDay = new Date(`${today}T12:00:00Z`).getUTCDay();
      const days = (draft.weekday - currentDay + 7) % 7;
      date = addDays(today, !days && draft.nextWeek ? 7 : days);
    }
    let candidates = reminderWallTime(date, hour, draft.minute!, draft.timezone);
    if (!candidates.length) return result("That local time does not exist on that date. What other time should I use?");
    let dueAt = candidates.find((at) => at > clock.now);
    if (!dueAt && !draft.date && draft.day !== "today") {
      date = addDays(date, draft.weekday !== undefined ? 7 : 1);
      candidates = reminderWallTime(date, hour, draft.minute!, draft.timezone); dueAt = candidates.find((at) => at > clock.now);
    }
    if (!dueAt) return result("That time has passed. Should I use tomorrow, or another date?");
    draft.dueAt = dueAt;
  }
  if (draft.dueAt <= clock.now || draft.dueAt > clock.now + 366 * 86400000) { delete draft.dueAt; return result("Choose a future time within the next year."); }
  if (draft.repeat) {
    if (draft.hour === undefined || draft.minute === undefined) return result("What local time should the repeating reminder use?");
    const hour = draft.meridiem ? draft.hour! % 12 + (draft.meridiem === "PM" ? 12 : 0) : draft.hour!;
    draft.recurrence = { ...draft.repeat, timezone: draft.timezone, hour, minute: draft.minute! };
    const next = nextReminderOccurrence(draft.recurrence, draft.dueAt, clock.now);
    if (!next) return result("No future occurrence matches that schedule. Choose another time.");
    draft.dueAt = next;
  }
  return { kind: "reminder", draft, dueAt: draft.dueAt, label: reminderTimeLabel(draft.dueAt, draft.timezone) };
}
