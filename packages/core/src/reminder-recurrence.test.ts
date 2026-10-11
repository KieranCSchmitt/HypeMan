import { describe, expect, it } from "vitest";
import { nextReminderOccurrence, parseReminderRecurrence, validReminderStart, type ReminderRecurrence } from "./reminder-recurrence";
const daily: ReminderRecurrence = { frequency: "daily", interval: 1, timezone: "America/New_York", hour: 9, minute: 0 };
const at = Date.parse;
describe("timezone-aware recurring reminders", () => {
  it("preserves wall time across spring and fall clock changes", () => {
    expect(nextReminderOccurrence(daily, at("2026-03-07T14:00:00Z"), at("2026-03-07T14:00:00Z"))).toBe(at("2026-03-08T13:00:00Z"));
    expect(nextReminderOccurrence(daily, at("2026-10-31T13:00:00Z"), at("2026-10-31T13:00:00Z"))).toBe(at("2026-11-01T14:00:00Z"));
  });
  it("skips a DST gap and emits a repeated hour only once", () => {
    expect(nextReminderOccurrence({ ...daily, hour: 2, minute: 30 }, at("2026-03-07T07:30:00Z"), at("2026-03-07T07:30:00Z"))).toBe(at("2026-03-09T06:30:00Z"));
    const fold = { ...daily, hour: 1, minute: 30 };
    expect(nextReminderOccurrence(fold, at("2026-10-31T05:30:00Z"), at("2026-11-01T05:30:00Z"))).toBe(at("2026-11-02T06:30:00Z"));
  });
  it("honors multiweek weekdays, exceptions and an end date", () => {
    const rule: ReminderRecurrence = { ...daily, frequency: "weekly", interval: 2, weekdays: [1, 3], exceptions: ["2026-10-14"] };
    const anchor = at("2026-10-12T13:00:00Z");
    expect(nextReminderOccurrence(rule, anchor, anchor)).toBe(at("2026-10-26T13:00:00Z"));
    expect(nextReminderOccurrence({ ...rule, until: at("2026-10-20T00:00:00Z") }, anchor, anchor)).toBeNull();
    expect(validReminderStart(at("2026-10-13T13:00:00Z"), rule)).toBe(false);
  });
  it("rejects malformed schedules without normalizing invalid dates", () => {
    for (const patch of [{ timezone: "Bad/Zone" }, { interval: 0 }, { hour: 24 }, { weekdays: [1] }, { exceptions: ["2026-02-30"] }, { extra: true }]) expect(parseReminderRecurrence({ ...daily, ...patch })).toBeNull();
  });
});
