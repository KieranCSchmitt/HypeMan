import { parseReminderRecurrence, validMessagingTimezone, type SelectedContent } from "@core";
/** One payload builder keeps the inline review identical to the message submitted. */
export function phoneMessageText(operation: string, args: Record<string, unknown>, selected: SelectedContent | null): string {
  let raw = operation === "test" ? "HypeMan is connected. Text me an idea, goal, or reminder." : String(args.text || selected?.text || "");
  if (operation === "send" && selected?.url && ["note", "project", "video"].includes(selected.kind) && !raw.includes(selected.url)) raw += `\n\nSource: ${selected.url}`;
  return raw.length > 6000 ? `${raw.slice(0, 5980)}\n[Text shortened]` : raw;
}
export function phoneReview(operation: string, args: Record<string, unknown>, selected: SelectedContent | null, phone?: string, phoneTimezone?: string): string {
  const recipient = phone ? `•••• ${phone.replace(/\D/g, "").slice(-4)}` : "your paired phone";
  if (operation === "send" || operation === "test") return `Send one text to ${recipient}?\n\n${phoneMessageText(operation, args, selected)}`;
  if (operation === "pair") return `Send a pairing invitation to ${String(args.phone || "your phone")}?`;
  if (operation === "unpair") return `Unpair ${recipient}? Phone messages and reminders will disconnect.`;
  if (operation === "remind") {
    const rule = parseReminderRecurrence(args.recurrence), zone = rule?.timezone || (validMessagingTimezone(args.timezone) ? args.timezone : validMessagingTimezone(phoneTimezone) ? phoneTimezone : Intl.DateTimeFormat().resolvedOptions().timeZone);
    const time = Number.isFinite(args.dueAt) ? new Intl.DateTimeFormat(undefined, { timeZone: zone, dateStyle: "medium", timeStyle: "short" }).format(Number(args.dueAt)) : "Time not specified";
    const days = rule?.weekdays?.map((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day]).join(", ");
    const repeat = rule ? `\nEvery ${rule.interval === 1 ? "" : `${rule.interval} `}${rule.frequency === "daily" ? rule.interval === 1 ? "day" : "days" : rule.interval === 1 ? "week" : "weeks"}${days ? ` · ${days}` : ""}${rule.until ? ` · until ${new Intl.DateTimeFormat(undefined, { timeZone: zone, dateStyle: "medium" }).format(rule.until)}` : ""}` : "";
    return `Schedule for ${recipient}?\n\n${String(args.text || "")}\n${time} · ${zone}${repeat}`;
  }
  if (operation === "settings") {
    const patch = args.patch && typeof args.patch === "object" ? args.patch as Record<string, unknown> : Object.fromEntries(Object.entries(args).filter(([key]) => !["conversationId", "selected"].includes(key)));
    const names: Record<string, string> = { coachingEnabled: "Coaching", morningTime: "Morning", eveningTime: "Evening", timezone: "Time zone", projectUpdates: "Project updates", proactiveEnabled: "Proactive help" };
    return `Save phone preferences?\n${Object.entries(patch).map(([key, value]) => `${names[key] || key}: ${typeof value === "boolean" ? value ? "on" : "off" : String(value)}`).join("\n")}`;
  }
  return `Continue this phone idea in Chrome?\n${selected?.text || String(args.id || "Selected idea")}`;
}
