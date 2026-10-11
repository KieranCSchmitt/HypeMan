import { describe, expect, it } from "vitest";
import { reminderConversation, reminderWallTime, type ReminderDraft } from "@core";
const clock = { now: Date.parse("2026-10-11T04:29:00Z"), timezone: "America/New_York" };
const parse = (text: string, draft: ReminderDraft | null = null, now = clock.now) => reminderConversation(text, draft, { ...clock, now }, "request-1");
const pending = (text: string) => { const turn = parse(text); if (turn.kind !== "reminder") throw new Error("Missing reminder"); return turn.draft; };
describe("reminder clarification", () => {
  it("retains the original text while resolving the screenshot's terse AM/EST answer", () => {
    const first = parse("send me a text reminder at 12:30 to practice math");
    expect(first).toMatchObject({ kind: "reminder", question: "12:30 AM or PM?", draft: { text: "practice math", hour: 12, minute: 30 } });
    const next = parse("AM est", first.kind === "reminder" ? first.draft : null);
    expect(next).toMatchObject({ kind: "reminder", dueAt: Date.parse("2026-10-11T05:30:00Z"), draft: { text: "practice math", timezone: "Etc/GMT+5" } });
  });
  it("uses saved local timezone and the next occurrence without asking date or recurrence", () => {
    expect(parse("remind me to practice math at 12:30 AM")).toMatchObject({ kind: "reminder", dueAt: Date.parse("2026-10-11T04:30:00Z") });
    expect(parse("remind me to practice math at 12:30 AM", null, Date.parse("2026-10-11T04:31:00Z"))).toMatchObject({ kind: "reminder", dueAt: Date.parse("2026-10-12T04:30:00Z") });
  });
  it("accepts complete and relative requests without a clarification", () => {
    expect(parse("remind me to stretch in 10 minutes")).toMatchObject({ dueAt: clock.now + 600000, draft: { text: "stretch" } });
    expect(parse("text me at 9 PM tomorrow to water plants")).toMatchObject({ dueAt: Date.parse("2026-10-13T01:00:00Z"), draft: { text: "water plants" } });
    expect(parse("Can you remind me to stretch in ten minutes?")).toMatchObject({ dueAt: clock.now + 600000, draft: { text: "stretch" } });
    expect(parse("remind me to stretch at 9pm")).toMatchObject({ dueAt: Date.parse("2026-10-12T01:00:00Z") });
    expect(parse("remind me to stretch on October 12 at 9 AM")).toMatchObject({ dueAt: Date.parse("2026-10-12T13:00:00Z"), draft: { text: "stretch" } });
  });
  it("preserves slots across multiple short corrections", () => {
    let draft = pending("remind me to practice math at 12:30");
    const answer = parse("AM and est timezone is what I meant", draft);
    expect(answer).toMatchObject({ dueAt: Date.parse("2026-10-11T05:30:00Z") });
    draft = answer.kind === "reminder" ? answer.draft : draft;
    expect(parse("The next 12:30 AM", draft)).toMatchObject({ dueAt: Date.parse("2026-10-11T05:30:00Z"), draft: { text: "practice math" } });
    expect(parse("AM", pending("remind me to study next Sunday at 9"))).toMatchObject({ dueAt: Date.parse("2026-10-18T13:00:00Z") });
  });
  it("asks for only missing content/time and never schedules an invalid time", () => {
    expect(parse("set a reminder")).toMatchObject({ question: "What should I remind you to do?" });
    expect(parse("remind me to study")).toMatchObject({ question: "When should I text you to study?" });
    expect(parse("remind me to study at 25:90")).toMatchObject({ question: "What time should I use? For example, 12:30 AM." });
    const empty = pending("set a reminder at 9 AM");
    expect(parse("practice math", empty)).toMatchObject({ dueAt: Date.parse("2026-10-11T13:00:00Z"), draft: { text: "practice math" } });
    expect(parse("remind me to study at 9 AM US/Estern")).toMatchObject({ question: expect.stringContaining("Which timezone") });
  });
  it("does not treat unrelated questions or expired drafts as reminder authorization", () => {
    const draft = pending("remind me to practice math at 12:30");
    expect(parse("Am I correct about this equation?", draft)).toEqual({ kind: "unrelated" });
    expect(parse("AM EST", draft, clock.now + 31 * 60000)).toEqual({ kind: "unrelated" });
    expect(parse("cancel", draft)).toEqual({ kind: "cancel" });
    expect(parse("What reminders have I set at 9 AM?")).toEqual({ kind: "unrelated" });
  });
  it("uses calendar days across DST and rejects a nonexistent local time", () => {
    const spring = { now: Date.parse("2026-03-07T15:00:00Z"), timezone: "America/New_York" };
    expect(reminderConversation("remind me to stretch tomorrow at 9 AM", null, spring, "dst-test")).toMatchObject({ dueAt: Date.parse("2026-03-08T13:00:00Z") });
    expect(reminderWallTime("2026-03-08", 2, 30, spring.timezone)).toEqual([]);
    expect(reminderWallTime("2026-11-01", 1, 30, spring.timezone)).toEqual([Date.parse("2026-11-01T05:30:00Z"), Date.parse("2026-11-01T06:30:00Z")]);
  });
  it("does not silently convert recurring requests into one-time reminders", () => {
    expect(parse("remind me to stretch at 9 AM every day")).toMatchObject({ question: expect.stringContaining("one-time") });
    const draft = pending("remind me to stretch at 9 AM every day");
    expect(parse("AM", draft)).toMatchObject({ question: expect.stringContaining("one-time") });
    expect(parse("tomorrow", draft)).toMatchObject({ dueAt: Date.parse("2026-10-12T13:00:00Z") });
  });
  it("keeps an unresolved timezone pending until the user supplies a valid one", () => {
    const draft = pending("remind me to study at 9 AM US/Estern");
    expect(parse("AM", draft)).toMatchObject({ question: expect.stringContaining("Which timezone") });
    expect(parse("sorry, ET", draft)).toMatchObject({ dueAt: Date.parse("2026-10-11T13:00:00Z") });
    expect(parse("remind me to study at 9 AM UTC-14")).toMatchObject({ question: expect.stringContaining("Which timezone") });
  });
});
