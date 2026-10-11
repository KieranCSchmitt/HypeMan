import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MESSAGING_SETTINGS, emptyWorkspace, type MessagingStatus } from "@core";
import { MESSAGING_INBOX_KEY, PhoneSync, safeMessagingStatus } from "./messaging";

const capture = { id: "phone-1", kind: "goal" as const, text: "Compare pottery classes", url: "https://classes.example/", createdAt: 1 };
const status = (patch: Partial<MessagingStatus> = {}): MessagingStatus => ({
  configured: true, connected: true, paired: true, ownerPhone: "+12125551234", lastSyncedAt: 10,
  settings: { ...DEFAULT_MESSAGING_SETTINGS }, captures: [capture], reminders: [], commitments: [], deliveries: [], ...patch,
});
function fixture(post = vi.fn(async () => status()), values: Record<string, unknown> = {}) {
  const storage = {
    get: vi.fn(async (key: string) => structuredClone({ [key]: values[key] })),
    set: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(values, structuredClone(patch)); }),
  };
  const changed = vi.fn(async () => {});
  return { phone: new PhoneSync(storage, async () => emptyWorkspace(), post, changed), storage, values, post, changed };
}

describe("durable phone inbox synchronization", () => {
  it("persists captures before acknowledging and never launches browser work during sync", async () => {
    const f = fixture();
    await f.phone.sync();
    expect(f.post).toHaveBeenCalledWith("/api/messaging/sync", { workspace: emptyWorkspace(), captureAcks: [] });
    expect(f.values[MESSAGING_INBOX_KEY]).toMatchObject({ captures: [capture], importedIds: [capture.id], pendingAcks: [capture.id] });
    await f.phone.sync();
    expect(f.post).toHaveBeenLastCalledWith("/api/messaging/sync", { workspace: emptyWorkspace(), captureAcks: [capture.id] });
    expect((await f.phone.inbox(false)).captures).toEqual([capture]);
  });
  it("keeps imports and acknowledgements across worker restart and lost responses", async () => {
    const f = fixture();
    await f.phone.sync();
    const restarted = fixture(vi.fn(async () => { throw new Error("Gateway offline"); }), f.values);
    expect(await restarted.phone.inbox()).toMatchObject({ captures: [capture], status: null, error: "Gateway offline" });
    expect(restarted.post).toHaveBeenLastCalledWith("/api/messaging/sync", expect.objectContaining({ captureAcks: [capture.id] }));
    restarted.post.mockImplementation(async () => status());
    await restarted.phone.sync();
    expect((await restarted.phone.inbox(false)).captures).toEqual([capture]);
  });
  it("does not acknowledge captures when the durable import fails", async () => {
    const f = fixture();
    f.storage.set.mockRejectedValueOnce(new Error("Storage full"));
    await expect(f.phone.sync()).rejects.toThrow("Storage full");
    await f.phone.sync();
    expect(f.post).toHaveBeenLastCalledWith("/api/messaging/sync", expect.objectContaining({ captureAcks: [] }));
    expect((await f.phone.inbox(false)).captures).toEqual([capture]);
  });
  it.each([
    { version: 2, captures: [], importedIds: [], pendingAcks: [] },
    { version: 1, captures: [], importedIds: [], pendingAcks: ["never-imported"] },
  ])("preserves invalid persisted inboxes without acknowledging remote captures %#", async (state) => {
    const f = fixture(undefined, { [MESSAGING_INBOX_KEY]: state });
    await expect(f.phone.sync()).rejects.toThrow(/inbox/);
    expect(f.post).not.toHaveBeenCalled();
    expect(f.values[MESSAGING_INBOX_KEY]).toEqual(state);
  });
  it("does not reimport dismissed captures after gateway redelivery", async () => {
    const f = fixture();
    await f.phone.sync();
    await f.phone.dismiss(capture.id);
    await f.phone.sync();
    expect((await f.phone.inbox(false)).captures).toEqual([]);
  });
  it("coalesces overlapping sync requests into one serialized trailing refresh", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const post = vi.fn(async () => { if (post.mock.calls.length === 1) await blocked; return status(); });
    const f = fixture(post);
    const first = f.phone.sync();
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const second = f.phone.sync();
    const third = f.phone.sync();
    expect(second).toBe(first);
    expect(third).toBe(first);
    release();
    await first;
    expect(post).toHaveBeenCalledTimes(2);
    expect((await f.phone.inbox(false)).captures).toHaveLength(1);
  });
  it("avoids background retries when Photon is unconfigured and lets explicit refresh retry", async () => {
    const f = fixture(vi.fn(async () => status({ configured: false, connected: false, captures: [] })));
    await f.phone.sync();
    await f.phone.sync();
    expect(f.post).toHaveBeenCalledTimes(1);
    await f.phone.sync(true);
    expect(f.post).toHaveBeenCalledTimes(2);
  });
  it("requires explicit continuation and durably claims a capture before browser dispatch", async () => {
    const f = fixture();
    const launch = vi.fn(async () => {
      expect(f.values[MESSAGING_INBOX_KEY]).toMatchObject({ captures: [] });
      return { tabId: 1 };
    });
    await f.phone.sync();
    expect(launch).not.toHaveBeenCalled();
    expect(await f.phone.continue(capture.id, launch)).toEqual({ tabId: 1 });
    await expect(f.phone.continue(capture.id, launch)).rejects.toThrow("already handled");
    await f.phone.sync();
    expect((await f.phone.inbox(false)).captures).toEqual([]);
    expect(launch).toHaveBeenCalledExactlyOnceWith(capture);
  });
  it("restores a capture after a failed explicit browser launch", async () => {
    const f = fixture();
    await f.phone.sync();
    await expect(f.phone.continue(capture.id, async () => { throw new Error("Site paused"); })).rejects.toThrow("Site paused");
    expect((await f.phone.inbox(false)).captures).toEqual([capture]);
  });
});

describe("phone status boundary", () => {
  it("removes additional gateway fields and accepts uncertain reminder delivery", () => {
    const input = { ...status(), secret: "private", settings: { ...DEFAULT_MESSAGING_SETTINGS, token: "private" },
      captures: [{ ...capture, secret: "private" }],
      reminders: [{ id: "reminder-1", text: "Practice", status: "unknown", createdAt: 1, dueAt: 2, recipient: "private" }] };
    expect(JSON.stringify(safeMessagingStatus(input))).not.toContain("private");
    expect(safeMessagingStatus(input).reminders[0]?.status).toBe("unknown");
  });
  it.each([
    { captures: [{ ...capture, url: "javascript:alert(1)" }] },
    { captures: [{ ...capture, createdAt: "yesterday" }] },
    { captures: [{ ...capture, kind: "browser_action" }] },
    { settings: { ...DEFAULT_MESSAGING_SETTINGS, morningTime: "25:01" } },
    { settings: { ...DEFAULT_MESSAGING_SETTINGS, timezone: "MadeUp/Timezone" } },
    { lastSyncedAt: -1 },
    { deliveries: [{ id: "send-1", text: "text", status: "retry_me", at: 1 }] },
  ])("rejects malformed remote state %#", (patch) => {
    expect(() => safeMessagingStatus({ ...status(), ...patch })).toThrow(/invalid/);
  });
});
