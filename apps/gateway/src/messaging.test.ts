import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyWorkspace, type CompanionSnapshot } from "@core";
import { MessagingService, localPhoneTime } from "./messaging";
import type { PhotonTransport, IncomingPhoneMessage } from "./photon";
import { MessagingStore } from "./messaging-store";
import type { Providers } from "./providers";

class FakePhoton implements PhotonTransport {
  configured = true;
  connected = true;
  error?: string;
  sent: { destination: { phone: string; spaceId?: string }; text: string }[] = [];
  fail = false;
  async start(_receive: (message: IncomingPhoneMessage) => Promise<void>) {}
  async send(destination: { phone: string; spaceId?: string }, text: string) {
    this.sent.push({ destination, text });
    if (this.fail) throw new Error("response lost after possible acceptance");
    return { id: `sent-${this.sent.length}`, spaceId: destination.spaceId || "owner-thread" };
  }
  async close() {}
}
const directories: string[] = [];
const services: MessagingService[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map(s => s.close())); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture(start = "2026-10-10T12:59:00Z", provider?: { json: Mock<Providers["json"]> }) {
  const directory = mkdtempSync(join(tmpdir(), "hypeman-phone-")); directories.push(directory);
  let now = Date.parse(start), count = 0;
  const transport = new FakePhoton();
  const service = new MessagingService({ transport, directory, now: () => now,
    providers: provider,
  }); services.push(service);
  const incoming = (text: string, extra: Partial<IncomingPhoneMessage> = {}): IncomingPhoneMessage => ({ id: `m-${++count}`, sender: "+14155551234", spaceId: "owner-thread", text, at: now, fromMe: false, isGroup: false, ...extra });
  const pair = async () => {
    const result = await service.route("pair", { phone: "+14155551234" }) as { code: string; expiresAt: number };
    expect(transport.sent[0].text).not.toContain(result.code);
    await service.receive(incoming(`PAIR ${result.code}`));
    expect(service.status().paired).toBe(true);
    transport.sent = [];
    return result;
  };
  return { directory, transport, service, incoming, pair, at: (value: string | number) => { now = typeof value === "number" ? value : Date.parse(value); }, get now() { return now; } };
}
const taskWorkspace = (status: "running" | "completed" | "paused", updatedAt = 100): CompanionSnapshot => ({
  ...emptyWorkspace(), activeTaskId: status === "running" ? "pottery" : null,
  tasks: [{ id: "pottery", goal: "Compare pottery classes", status, steps: ["Find classes", "Compare costs"].map((title, index) => ({ id: `s${index}`, title, status: status === "completed" ? "done" : "todo", ...(status === "completed" ? { completion: { source: "page" as const, evidence: "Two classes compared", url: "https://example.com/classes", at: updatedAt } } : {}) })), nextStep: "Compare costs", tabId: null, lastPage: null, createdAt: 50, updatedAt }],
});

describe("personal phone pairing and permissions", () => {
  it("binds a single owner+DM, stores only code hash, and rejects echoes/groups/wrong thread", async () => {
    const f = fixture();
    const pairing = await f.service.route("pair", { phone: "+14155551234" }) as { code: string };
    expect(readFileSync(join(f.directory, "messaging.json"), "utf8")).not.toContain(pairing.code);
    await f.service.receive(f.incoming(`PAIR ${pairing.code}`, { sender: "+14155559999" }));
    expect(f.service.status().paired).toBe(false);
    await f.service.receive(f.incoming(`PAIR ${pairing.code}`, { isGroup: true }));
    expect(f.service.status().paired).toBe(false);
    await f.service.receive(f.incoming(`PAIR ${pairing.code}`));
    expect(f.service.status().paired).toBe(true);
    f.transport.sent = [];
    for (const extra of [{ fromMe: true }, { isGroup: true }, { sender: "+14155559999" }, { spaceId: "another-thread" }, { at: -1 }]) await f.service.receive(f.incoming("QUEUE Do something", extra));
    expect(f.service.status().captures).toHaveLength(0);
    expect(f.transport.sent).toHaveLength(0);
  });
  it("expires codes and caps distinct wrong attempts without duplicate-event exhaustion", async () => {
    const f = fixture();
    const result = await f.service.route("pair", { phone: "+14155551234" }) as { code: string };
    const wrong = f.incoming("PAIR wrong");
    for (let i = 0; i < 8; i++) await f.service.receive(wrong);
    await f.service.receive(f.incoming(`PAIR ${result.code}`));
    expect(f.service.status().paired).toBe(true);
    await f.service.route("unpair", {});
    const expired = await f.service.route("pair", { phone: "+14155551234" }) as { code: string };
    f.at(f.now + 600_001);
    await f.service.receive(f.incoming(`PAIR ${expired.code}`));
    expect(f.service.status().paired).toBe(false);
  });
  it("keeps the desktop code usable when invitation delivery is uncertain without resending", async () => {
    const f = fixture();
    f.transport.fail = true;
    const pairing = await f.service.route("pair", { phone: "+14155551234" }) as { code: string; expiresAt: number; deliveryStatus: "sent" | "unknown" };
    expect(pairing).toMatchObject({ code: expect.stringMatching(/^\d{6}$/), expiresAt: f.now + 600_000, deliveryStatus: "unknown" });
    expect(f.transport.sent).toHaveLength(1);
    const invitation = f.service.status().deliveries[0];
    expect(invitation.status).toBe("unknown");
    expect(readFileSync(join(f.directory, "messaging.json"), "utf8")).not.toContain(pairing.code);
    f.transport.fail = false;
    await f.service.receive(f.incoming(`PAIR ${pairing.code}`));
    expect(f.service.status().paired).toBe(true);
    expect(f.service.status().ownerPhone).toBe("+14155551234");
    expect(f.service.status().deliveries.find(delivery => delivery.id === invitation.id)?.status).toBe("unknown");
    expect(f.transport.sent.filter(message => message.text.startsWith("HypeMan pairing:"))).toHaveLength(1);
    expect(readFileSync(join(f.directory, "messaging.json"), "utf8")).not.toContain(pairing.code);
  });
  it("rotates a pending desktop code without retrying its uncertain invitation", async () => {
    const f = fixture();
    f.transport.fail = true;
    const first = await f.service.route("pair", { phone: "+14155551234" }) as { code: string; expiresAt: number; deliveryStatus: "sent" | "unknown" };
    const invitation = f.service.status().deliveries[0];
    f.at(f.now + 60_000);
    const replacement = await f.service.route("pair", { phone: "+14155551234" }) as { code: string; expiresAt: number; deliveryStatus: "sent" | "unknown" };
    expect(replacement).toMatchObject({ code: expect.stringMatching(/^\d{6}$/), expiresAt: f.now + 600_000, deliveryStatus: "unknown" });
    expect(replacement.code).not.toBe(first.code);
    expect(f.transport.sent).toHaveLength(1);
    expect(f.service.status().deliveries).toEqual([invitation]);
    expect(readFileSync(join(f.directory, "messaging.json"), "utf8")).not.toContain(replacement.code);
    f.transport.fail = false;
    await f.service.receive(f.incoming(`PAIR ${first.code}`));
    expect(f.service.status().paired).toBe(false);
    await f.service.receive(f.incoming(`PAIR ${replacement.code}`));
    expect(f.service.status().paired).toBe(true);
    expect(f.transport.sent.filter(message => message.text.startsWith("HypeMan pairing:"))).toHaveLength(1);
    expect(f.service.status().deliveries.find(delivery => delivery.id === invitation.id)).toEqual(invitation);
    expect(readFileSync(join(f.directory, "messaging.json"), "utf8")).not.toContain(replacement.code);
  });
  it("creates an explicit desktop reminder durably while offline and delivers only when due", async () => {
    const f = fixture("2026-10-10T22:00:00Z");
    const dueAt = f.now + 60_000;
    await expect(f.service.route("remind", { text: "Check the kiln", dueAt })).rejects.toThrow("Pair your phone first");
    await f.pair();
    for (const invalid of [f.now, f.now - 1, f.now + 367 * 86400_000])
      await expect(f.service.route("remind", { text: "Check the kiln", dueAt: invalid })).rejects.toThrow("future time");
    await expect(f.service.route("remind", { text: "Check the kiln", dueAt, phone: "+14155559999" })).rejects.toThrow("Invalid phone request field");
    f.transport.connected = false;
    await f.service.route("remind", { text: "Check the kiln", dueAt });
    expect(f.transport.sent).toHaveLength(0);
    expect(new MessagingStore(f.directory).state.reminders).toMatchObject([{ text: "Check the kiln", dueAt, status: "pending" }]);
    const restarted = new MessagingService({ transport: f.transport, directory: f.directory, now: () => f.now }); services.push(restarted);
    f.transport.connected = true;
    await restarted.tick();
    expect(f.transport.sent).toHaveLength(0);
    f.at(dueAt);
    await restarted.tick(); await restarted.tick();
    expect(f.transport.sent).toHaveLength(1);
    expect(f.transport.sent[0]).toMatchObject({ destination: { phone: "+14155551234", spaceId: "owner-thread" }, text: expect.stringContaining("Reminder: Check the kiln") });
    expect(new MessagingStore(f.directory).state.reminders[0].status).toBe("sent");
  });
  it("rejects invalid route fields and keeps send recipient fixed", async () => {
    const f = fixture(); await f.pair();
    await expect(f.service.route("send", { text: "hello", phone: "+14155559999" })).rejects.toThrow("Invalid phone request field");
    await f.service.route("send", { text: "My saved summary" });
    expect(f.transport.sent[0].destination).toEqual({ phone: "+14155551234", spaceId: "owner-thread" });
    await expect(f.service.route("settings", { patch: { timezone: "not/a-zone" } })).rejects.toThrow();
  });
});

describe("phone conversation and durable capture", () => {
  it("discusses before queuing, deduplicates receipt, and never changes browser tasks", async () => {
    const provider = { json: vi.fn<Providers["json"]>().mockResolvedValueOnce({ reply: "Which two classes should we compare?" }).mockResolvedValueOnce({ reply: "Ready for later.", intent: { type: "capture", kind: "goal", text: "Compare two pottery classes" } }) };
    const f = fixture(undefined, provider); await f.pair();
    await f.service.receive(f.incoming("Help me compare classes"));
    expect(f.service.status().captures).toHaveLength(0);
    const approval = f.incoming("Yes, queue that for Chrome");
    await f.service.receive(approval); await f.service.receive(approval);
    expect(provider.json).toHaveBeenCalledTimes(2);
    expect(f.service.status().captures).toHaveLength(1);
    expect(f.transport.sent.at(-1)?.text).toContain("no browser work has started");
    const store = new MessagingStore(f.directory);
    expect(store.state.workspace.tasks).toHaveLength(0);
    const capture = f.service.status().captures[0];
    await f.service.route("sync", { workspace: emptyWorkspace(), captureAcks: [capture.id] });
    expect(new MessagingStore(f.directory).state.captures[0].importedAt).toBe(f.now);
  });
  it("captures ideas without AI and answers status with freshness", async () => {
    const f = fixture(); await f.pair();
    await f.service.receive(f.incoming("SAVE https://example.com/classes pottery idea"));
    expect(f.service.status().captures[0].kind).toBe("link");
    await f.service.route("sync", { workspace: taskWorkspace("running"), captureAcks: [] });
    f.at(f.now + 240_000);
    await f.service.receive(f.incoming("STATUS"));
    expect(f.transport.sent.at(-1)?.text).toContain("4 minute(s) ago");
    expect(f.transport.sent.at(-1)?.text).toContain("Compare costs");
    await f.service.receive(f.incoming("An AI question"));
    expect(f.transport.sent.at(-1)?.text).toContain("Phone AI is unavailable");
  });
  it("rejects unknown/past intents and maintains separate daily commitments", async () => {
    const provider = { json: vi.fn<Providers["json"]>().mockResolvedValueOnce({ reply: "Sure", intent: { type: "navigate", url: "https://example.com" } }).mockResolvedValueOnce({ reply: "Sure", intent: { type: "reminder", text: "Past", dueAt: 1 } }).mockResolvedValueOnce({ reply: "Good plan", intent: { type: "commitment", text: "Finish comparison" } }) };
    const f = fixture(undefined, provider); await f.pair();
    await f.service.receive(f.incoming("Do browser work"));
    await f.service.receive(f.incoming("Bad reminder"));
    expect(f.service.status().reminders).toHaveLength(0);
    expect(f.service.status().captures).toHaveLength(0);
    await f.service.receive(f.incoming("I will finish comparison today"));
    await f.service.receive(f.incoming("DONE"));
    expect(f.service.status().commitments[0].done).toBe(true);
    expect(new MessagingStore(f.directory).state.workspace.tasks).toHaveLength(0);
  });
  it("cancels inference on account change or unpair; unknown send is not retried", async () => {
    let complete!: (value: Record<string, unknown>) => void;
    const provider = { json: vi.fn<Providers["json"]>(() => new Promise<Record<string, unknown>>(resolve => { complete = resolve; })) };
    const f = fixture(undefined, provider); await f.pair();
    const work = f.service.receive(f.incoming("Question"));
    await vi.waitFor(() => expect(provider.json).toHaveBeenCalled());
    await f.service.route("unpair", {}); complete({ reply: "This must not be sent", intent: { type: "capture", kind: "idea", text: "This must not be saved" } });
    await work;
    expect(f.service.status().captures).toHaveLength(0);
    expect(f.transport.sent).toHaveLength(0);
  });
  it("persists queued messages immediately and allows only owner STOP to interrupt AI", async () => {
    let signal!: AbortSignal;
    const provider = { json: vi.fn<Providers["json"]>((_system, _input, inputSignal) => new Promise((_resolve, reject) => {
      signal = inputSignal;
      inputSignal.addEventListener("abort", () => reject(inputSignal.reason), { once: true });
    })) };
    const f = fixture(undefined, provider); await f.pair();
    const inference = f.service.receive(f.incoming("Slow question"));
    await vi.waitFor(() => expect(provider.json).toHaveBeenCalled());
    await f.service.receive(f.incoming("STOP", { sender: "+14155559999" }));
    expect(signal.aborted).toBe(false);
    const queued = f.incoming("SAVE Remember this idea");
    const queuedWork = f.service.receive(queued);
    expect(new MessagingStore(f.directory).state.received.some(r => r.message.id === queued.id && !r.done)).toBe(true);
    const stop = f.service.receive(f.incoming("STOP"));
    expect(f.service.status().settings.proactiveEnabled).toBe(false);
    expect(signal.aborted).toBe(true);
    await Promise.all([inference, queuedWork, stop]);
    expect(f.service.status().captures).toHaveLength(1);
  });
  it("rolls back failed receipt persistence so the same event can be retried", async () => {
    const f = fixture(); await f.pair();
    const path = join(f.directory, "messaging.json"), backup = join(f.directory, "backup");
    renameSync(path, backup); mkdirSync(path);
    const message = f.incoming("SAVE Do not lose this capture");
    await expect(f.service.receive(message)).rejects.toThrow("could not be saved");
    expect(f.service.status().captures).toHaveLength(0);
    rmSync(path, { recursive: true }); renameSync(backup, path);
    await f.service.receive(message);
    expect(f.service.status().captures).toHaveLength(1);
  });
});

describe("accountability, delivery, and synchronization recovery", () => {
  it("sends each daily slot once, skips missed slots, and applies STOP/START without changing Chrome", async () => {
    const f = fixture(); await f.pair();
    await f.service.route("sync", { workspace: taskWorkspace("running"), captureAcks: [] });
    f.at("2026-10-10T13:00:00Z"); await f.service.tick(); await f.service.tick();
    expect(f.transport.sent.filter(m => m.text.startsWith("Morning planning"))).toHaveLength(1);
    await f.service.receive(f.incoming("STOP"));
    f.at("2026-10-10T23:00:00Z"); await f.service.tick();
    expect(f.transport.sent.some(m => m.text.startsWith("Evening reflection"))).toBe(false);
    expect(new MessagingStore(f.directory).state.workspace.tasks[0].status).toBe("running");
    await f.service.receive(f.incoming("START"));
    await f.service.tick(); // restoring does not replay the missed evening slot
    expect(f.transport.sent.some(m => m.text.startsWith("Evening reflection"))).toBe(false);
    f.at("2026-10-11T13:20:00Z"); await f.service.tick();
    expect(f.transport.sent.filter(m => m.text.startsWith("Morning planning"))).toHaveLength(1);
  });
  it("uses IANA local dates across daylight-saving changes", () => {
    expect(localPhoneTime(Date.parse("2026-03-08T06:59:00Z"), "America/New_York").time).toBe("01:59");
    expect(localPhoneTime(Date.parse("2026-03-08T07:00:00Z"), "America/New_York").time).toBe("03:00");
    expect(localPhoneTime(Date.parse("2026-11-01T05:30:00Z"), "America/New_York")).toEqual(localPhoneTime(Date.parse("2026-11-01T06:30:00Z"), "America/New_York"));
    expect(localPhoneTime(Date.parse("2026-11-01T14:00:00Z"), "America/New_York").time).toBe("09:00");
  });
  it("delivers overdue reminders once during quiet hours and persists unknown outcomes across restart", async () => {
    const provider = { json: vi.fn<Providers["json"]>() };
    const f = fixture("2026-10-11T01:59:00Z", provider); await f.pair();
    provider.json.mockResolvedValue({ reply: "Okay", intent: { type: "reminder", text: "Water plants", dueAt: f.now + 60_000 } });
    await f.service.receive(f.incoming("Remind me at 10 PM tonight to water plants"));
    const reminder = f.service.status().reminders[0];
    f.at(f.now + 300_000); f.transport.fail = true;
    await f.service.tick(); await f.service.tick();
    expect(f.transport.sent.filter(m => m.text.includes("Late reminder"))).toHaveLength(1);
    expect(f.service.status().reminders[0].status).toBe("unknown");
    expect(f.service.status().deliveries.at(-1)?.status).toBe("unknown");
    const restarted = new MessagingService({ transport: f.transport, directory: f.directory, now: () => f.now }); services.push(restarted);
    await restarted.tick();
    expect(f.transport.sent.filter(m => m.text.includes("Late reminder"))).toHaveLength(1);
    f.transport.fail = false;
    await restarted.route("reminders", { operation: "snooze", id: reminder.id, minutes: 30 });
    expect(restarted.status().reminders.at(-1)?.status).toBe("pending");
  });
  it("baselines old completions and defers new durable updates through quiet hours", async () => {
    const f = fixture("2026-10-11T02:00:00Z"); await f.pair();
    await f.service.route("settings", { patch: { coachingEnabled: false, projectUpdates: true } });
    await f.service.route("sync", { workspace: taskWorkspace("completed"), captureAcks: [] });
    await f.service.tick(); expect(f.transport.sent).toHaveLength(0);
    await f.service.route("sync", { workspace: taskWorkspace("running", 200), captureAcks: [] });
    await f.service.route("sync", { workspace: taskWorkspace("completed", 300), captureAcks: [] });
    await f.service.tick(); expect(f.transport.sent).toHaveLength(0);
    f.at("2026-10-11T13:00:00Z"); await f.service.tick(); await f.service.tick();
    expect(f.transport.sent.filter(m => m.text.startsWith("Project completed"))).toHaveLength(1);
    await f.service.route("sync", { workspace: taskWorkspace("completed", 300), captureAcks: [] });
    await f.service.tick(); expect(f.transport.sent).toHaveLength(1);
  });
  it("STOP during an in-flight reminder suppresses later reminders, and offline cancellation works", async () => {
    const provider = { json: vi.fn<Providers["json"]>() };
    const f = fixture("2026-10-11T01:59:00Z", provider); await f.pair();
    provider.json.mockResolvedValue({ reply: "Okay", intent: { type: "reminder", text: "First", dueAt: f.now + 60_000 } });
    await f.service.receive(f.incoming("First reminder"));
    provider.json.mockResolvedValue({ reply: "Okay", intent: { type: "reminder", text: "Second", dueAt: f.now + 60_000 } });
    await f.service.receive(f.incoming("Second reminder"));
    const original = f.transport.send.bind(f.transport);
    let release!: () => void;
    vi.spyOn(f.transport, "send").mockImplementationOnce(async (destination, text) => {
      await new Promise<void>(resolve => { release = resolve; });
      return original(destination, text);
    });
    f.at(f.now + 60_000);
    const tick = f.service.tick();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await f.service.receive(f.incoming("STOP"));
    release(); await tick;
    expect(f.transport.sent.filter(m => m.text.startsWith("Reminder:"))).toHaveLength(1);
    const pending = f.service.status().reminders.find(r => r.status === "pending")!;
    f.transport.connected = false;
    await f.service.route("reminders", { operation: "cancel", id: pending.id });
    expect(f.service.status().reminders.find(r => r.id === pending.id)?.status).toBe("cancelled");
  });
  it("preserves private atomic state and refuses corrupt or symlinked files", async () => {
    const f = fixture(); await f.pair();
    const path = join(f.directory, "messaging.json");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(f.directory).mode & 0o777).toBe(0o700);
    await f.service.close();
    writeFileSync(path, "corrupt");
    expect(() => new MessagingStore(f.directory)).toThrow("existing data was preserved");
    expect(readFileSync(path, "utf8")).toBe("corrupt");
    rmSync(path); const target = join(f.directory, "target"); writeFileSync(target, "preserved"); symlinkSync(target, path);
    expect(() => new MessagingStore(f.directory)).toThrow();
    expect(readFileSync(target, "utf8")).toBe("preserved");
  });
  it("bounds a hung send, records unknown delivery, and can continue processing", async () => {
    const f = fixture(); await f.pair(); await f.service.close();
    const service = new MessagingService({ transport: f.transport, directory: f.directory, sendTimeoutMs: 10 }); services.push(service);
    vi.spyOn(f.transport, "send").mockImplementationOnce(() => new Promise(() => {}));
    await expect(service.route("send", { text: "Possibly delivered" })).rejects.toThrow("Delivery could not be confirmed");
    expect(service.status().deliveries.at(-1)?.status).toBe("unknown");
    await service.receive(f.incoming("STATUS"));
    expect(service.status().deliveries.at(-1)?.status).toBe("sent");
  });
});
