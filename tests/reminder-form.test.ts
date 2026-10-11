import { describe, expect, it } from "vitest";
import { reminderFormTime } from "../apps/extension/src/ui/reminder-form";
describe("phone reminder wall time", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  it("uses the displayed New York zone while the browser can be anywhere", () => expect(reminderFormTime("2026-01-02T09:00", "America/New_York", now)).toBe(Date.parse("2026-01-02T14:00:00Z")));
  it("rejects nonexistent and repeated DST times", () => {
    expect(() => reminderFormTime("2026-03-08T02:30", "America/New_York", now)).toThrow("does not exist");
    expect(() => reminderFormTime("2026-11-01T01:30", "America/New_York", now)).toThrow("occurs twice");
  });
  it("rejects invalid dates and already elapsed times", () => { expect(() => reminderFormTime("2026-02-30T09:00", "UTC", now)).toThrow(); expect(() => reminderFormTime("2025-12-31T09:00", "UTC", now)).toThrow(); });
});
