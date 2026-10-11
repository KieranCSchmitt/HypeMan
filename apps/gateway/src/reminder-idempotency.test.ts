import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MessagingService } from "./messaging";
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
describe("desktop reminder retry receipts", () => {
  it("deduplicates a lost scheduling response across gateway restart and rejects changed details", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hypeman-reminder-retry-")); directories.push(directory);
    const now = Date.parse("2026-10-11T04:29:00Z");
    const transport = { configured: true, connected: true, start: async () => {}, close: async () => {}, send: async () => ({ id: "test-send", spaceId: "test-thread" }) };
    const first = new MessagingService({ directory, transport, now: () => now });
    const invitation = await first.route("pair", { phone: "+12125550123" }) as { code: string };
    await first.receive({ id: "pair-reply", sender: "+12125550123", spaceId: "test-thread", text: `PAIR ${invitation.code}`, at: now, fromMe: false, isGroup: false });
    const reminder = { text: "Practice math", dueAt: now + 600000, idempotencyKey: "one-user-request" };
    await first.route("remind", reminder); await first.close();
    const second = new MessagingService({ directory, transport, now: () => now });
    try {
      await second.route("remind", reminder);
      expect(second.status().reminders).toHaveLength(1);
      expect(second.status().reminders[0]).toMatchObject({ id: "desktop:one-user-request", text: "Practice math", dueAt: now + 600000 });
      await expect(second.route("remind", { ...reminder, text: "Changed message" })).rejects.toThrow("different details");
      expect(second.status().reminders).toHaveLength(1);
    } finally { await second.close(); }
  });
});
