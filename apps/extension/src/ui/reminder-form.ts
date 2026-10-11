import { reminderWallTime, validMessagingTimezone } from "@core";
/** datetime-local is wall time in the explicitly displayed phone zone, never the browser zone. */
export function reminderFormTime(value: string, timezone: string, now = Date.now()): number {
  if (!validMessagingTimezone(timezone)) throw new Error("Choose a valid phone timezone.");
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59) throw new Error("Choose a valid reminder date and time.");
  const candidates = reminderWallTime(match[1], Number(match[2]), Number(match[3]), timezone);
  if (!candidates.length) throw new Error("That time does not exist in this timezone. Choose another time.");
  // Ambiguous fall-back hours require an explicit choice instead of silently using an offset.
  if (candidates.length > 1) throw new Error("That time occurs twice after the clock change. Specify its timezone offset in chat, or choose another time.");
  if (candidates[0] <= now || candidates[0] > now + 366 * 86400000) throw new Error("Choose a future time within one year.");
  return candidates[0];
}
