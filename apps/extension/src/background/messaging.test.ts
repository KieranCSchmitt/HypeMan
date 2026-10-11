import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MESSAGING_SETTINGS, emptyWorkspace, type MessagingStatus, type PhoneBrowserRequest } from "@core";
import { MESSAGING_INBOX_KEY, PhoneSync, safeMessagingStatus } from "./messaging";

const capture = { id: "phone-1", kind: "goal" as const, text: "Compare pottery classes", url: "https://classes.example/", createdAt: 1 };
const status = (patch: Partial<MessagingStatus> = {}): MessagingStatus => ({
  configured: true, connected: true, paired: true, ownerPhone: "+12125551234", lastSyncedAt: 10,
  settings: { ...DEFAULT_MESSAGING_SETTINGS }, captures: [capture], reminders: [], commitments: [], deliveries: [], ...patch,
});
function fixture(post = vi.fn(async (_path: string, _body: unknown): Promise<unknown> => status()), values: Record<string, unknown> = {}, launch?: (request: PhoneBrowserRequest) => Promise<unknown>) {
  const storage = {
    get: vi.fn(async (key: string) => structuredClone({ [key]: values[key] })),
    set: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(values, structuredClone(patch)); }),
  };
  const changed = vi.fn(async () => {});
  return { phone: new PhoneSync(storage, async () => emptyWorkspace(), post, changed, launch), storage, values, post, changed };
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
    { version: 1, captures: [], importedIds: [], pendingAcks: [], browserDispatches: null },
  ])("preserves invalid persisted inboxes without acknowledging remote captures %#", async (state) => {
    const f = fixture(undefined, { [MESSAGING_INBOX_KEY]: state });
    await expect(f.phone.sync()).rejects.toThrow(/inbox|dispatch history/);
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

describe("durable remote browser commands", () => {
  const request = (patch: Partial<PhoneBrowserRequest> = {}): PhoneBrowserRequest => ({
    id: "browser:phone-one", conversationId: "phone-conversation-one", goal: "Open YouTube", url: "https://www.youtube.com/",
    createdAt: 1, updatedAt: 1, status: "queued", ...patch,
  });
  function remote(jobs: PhoneBrowserRequest[] = [request()]) {
    const requests = structuredClone(jobs), claims = new Map<string, string>();
    const post = vi.fn(async (path: string, body: unknown): Promise<unknown> => {
      const input = body as { id: string; claimId: string; status: PhoneBrowserRequest["status"]; error?: string };
      const found = requests.find((item) => item.id === input.id);
      if (path === "/api/messaging/sync") return status({ browserRequests: requests });
      if (path.endsWith("browser.claim")) {
        if (!found || (found.status !== "queued" && !(found.status === "claimed" && claims.get(found.id) === input.claimId))) return null;
        claims.set(found.id, input.claimId); found.status = "claimed";
        return structuredClone(found);
      }
      if (path.endsWith("browser.result")) {
        if (!found || claims.get(found.id) !== input.claimId) throw new Error("Claim does not match");
        if (found.status === "claimed") { found.status = input.status; if (input.error) found.error = input.error; }
        return status({ browserRequests: requests });
      }
      throw new Error("Unexpected phone endpoint");
    });
    return { post, requests, claims };
  }
  it("durably claims explicit requests before launching while saved captures remain in the inbox", async () => {
    const r = remote();
    let f: ReturnType<typeof fixture>;
    const launch = vi.fn(async (job: PhoneBrowserRequest) => {
      expect(job).toEqual(request({ status: "claimed" }));
      expect(f.values[MESSAGING_INBOX_KEY]).toMatchObject({ browserDispatches: [{ id: job.id, status: "dispatching" }] });
      expect(r.claims.has(job.id)).toBe(true);
      return { tabId: 9 };
    });
    f = fixture(r.post, {}, launch);
    await f.phone.sync(); await f.phone.sync();
    expect(launch).toHaveBeenCalledTimes(1);
    expect(r.requests[0].status).toBe("started");
    expect(f.values[MESSAGING_INBOX_KEY]).toMatchObject({ captures: [capture], browserDispatches: [{ status: "started", pendingResult: false }] });
    expect(r.post.mock.calls.filter(([path]) => path.endsWith("browser.claim"))).toHaveLength(1);
  });
  it("uses the gateway claim to prevent two browser clients from executing one request", async () => {
    const r = remote(), firstLaunch = vi.fn(async () => {}), secondLaunch = vi.fn(async () => {});
    const first = fixture(r.post, {}, firstLaunch), second = fixture(r.post, {}, secondLaunch);
    await Promise.all([first.phone.sync(), second.phone.sync()]);
    expect(firstLaunch.mock.calls.length + secondLaunch.mock.calls.length).toBe(1);
    expect(r.requests[0].status).toBe("started");
  });
  it("does not claim or launch if local durable history cannot be saved", async () => {
    const r = remote(), launch = vi.fn(async () => {}), f = fixture(r.post, {}, launch);
    f.storage.set.mockImplementation(async (patch) => {
      if ((patch[MESSAGING_INBOX_KEY] as { browserDispatches: unknown[] }).browserDispatches.length) throw new Error("Storage full");
      Object.assign(f.values, structuredClone(patch));
    });
    await expect(f.phone.sync()).rejects.toThrow("Storage full");
    expect(r.claims.size).toBe(0); expect(launch).not.toHaveBeenCalled();
  });
  it("reports ambiguous launch errors as unknown without ever retrying browser work", async () => {
    const r = remote(), launch = vi.fn(async () => { throw new Error("Tab update reply lost"); });
    const f = fixture(r.post, {}, launch);
    await f.phone.sync();
    const restarted = fixture(r.post, f.values, launch);
    await restarted.phone.sync();
    expect(launch).toHaveBeenCalledTimes(1);
    expect(r.requests[0]).toMatchObject({ status: "unknown", error: expect.stringContaining("will not retry automatically") });
  });
  it("retries only result acknowledgement after a lost gateway response and worker restart", async () => {
    const r = remote(), launch = vi.fn(async () => {});
    const normal = r.post.getMockImplementation()!;
    let fail = true;
    r.post.mockImplementation(async (path, body) => {
      if (path.endsWith("browser.result") && fail) { fail = false; throw new Error("Result response lost"); }
      return normal(path, body);
    });
    const f = fixture(r.post, {}, launch);
    await expect(f.phone.sync()).rejects.toThrow("Result response lost");
    const restarted = fixture(r.post, f.values, launch);
    await restarted.phone.sync();
    expect(launch).toHaveBeenCalledTimes(1);
    expect(r.post.mock.calls.filter(([path]) => path.endsWith("browser.claim"))).toHaveLength(1);
    expect(r.requests[0].status).toBe("started");
    expect(f.values[MESSAGING_INBOX_KEY]).toMatchObject({ browserDispatches: [{ pendingResult: false }] });
  });
  it("recovers an in-flight claim as unknown after restart without launching it", async () => {
    const r = remote(), launch = vi.fn(async () => {});
    r.requests[0].status = "claimed"; r.claims.set(r.requests[0].id, "stable-claim");
    const values = { [MESSAGING_INBOX_KEY]: { version: 1, captures: [], importedIds: [], pendingAcks: [],
      browserDispatches: [{ id: r.requests[0].id, claimId: "stable-claim", status: "dispatching", pendingResult: false }] } };
    const f = fixture(r.post, values, launch);
    await f.phone.sync();
    expect(launch).not.toHaveBeenCalled();
    expect(r.requests[0].status).toBe("unknown");
    expect(r.post.mock.calls.filter(([path]) => path.endsWith("browser.claim"))).toHaveLength(0);
  });
  it("does not execute a request after an uncertain claim response", async () => {
    const r = remote(), launch = vi.fn(async () => {}), normal = r.post.getMockImplementation()!;
    r.post.mockImplementation(async (path, body) => {
      const result = await normal(path, body);
      if (path.endsWith("browser.claim")) throw new Error("Claim response lost");
      return result;
    });
    const f = fixture(r.post, {}, launch);
    await f.phone.sync(); await f.phone.sync();
    expect(launch).not.toHaveBeenCalled(); expect(r.requests[0].status).toBe("unknown");
    expect(r.post.mock.calls.filter(([path]) => path.endsWith("browser.claim"))).toHaveLength(1);
  });
  it("ignores claimed and terminal requests and unpaired statuses, including old gateway responses", async () => {
    const launch = vi.fn(async () => {});
    for (const patch of [
      { browserRequests: [request({ status: "claimed" }), request({ id: "old-job", status: "started" }), request({ id: "failed-job", status: "failed" })] },
      { paired: false, browserRequests: [request()] },
      {},
    ]) {
      const f = fixture(vi.fn(async () => status(patch)), {}, launch);
      await f.phone.sync();
      expect(f.post).toHaveBeenCalledTimes(1);
    }
    expect(launch).not.toHaveBeenCalled();
  });
  it("never dispatches a claimed job with substituted content", async () => {
    const r = remote(), launch = vi.fn(async () => {}), normal = r.post.getMockImplementation()!;
    r.post.mockImplementation(async (path, body) => {
      const result = await normal(path, body);
      return path.endsWith("browser.claim") ? { ...(result as PhoneBrowserRequest), goal: "Delete my account" } : result;
    });
    const f = fixture(r.post, {}, launch);
    await f.phone.sync();
    expect(launch).not.toHaveBeenCalled(); expect(r.requests[0].status).toBe("failed");
  });
  it("does not launch if the phone is unpaired while a claim response is in flight", async () => {
    const r = remote(), launch = vi.fn(async () => {}), normal = r.post.getMockImplementation()!;
    let f: ReturnType<typeof fixture>;
    r.post.mockImplementation(async (path, body) => {
      if (path.endsWith("browser.result")) return status({ paired: false, browserRequests: r.requests });
      const result = await normal(path, body);
      if (path.endsWith("browser.claim")) {
        r.requests[0].status = "cancelled";
        await f.phone.rememberStatus(status({ paired: false, browserRequests: r.requests }));
      }
      return result;
    });
    f = fixture(r.post, {}, launch);
    await f.phone.sync();
    expect(launch).not.toHaveBeenCalled();
    expect((await f.phone.inbox(false)).status?.paired).toBe(false);
    expect(f.values[MESSAGING_INBOX_KEY]).toMatchObject({ browserDispatches: [{ status: "failed", pendingResult: false }] });
  });
  it("does not let an older sync response undo a newly remembered unpair", async () => {
    const launch = vi.fn(async () => {});
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const post = vi.fn(async () => { await hold; return status({ browserRequests: [request()] }); });
    const f = fixture(post, {}, launch), syncing = f.phone.sync();
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await f.phone.rememberStatus(status({ paired: false }));
    release(); await syncing;
    expect(launch).not.toHaveBeenCalled(); expect(post).toHaveBeenCalledTimes(1);
    expect((await f.phone.inbox(false)).status?.paired).toBe(false);
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
    { browserRequests: [{ id: "job", conversationId: "../bad", goal: "Open page", createdAt: 1, updatedAt: 1, status: "queued" }] },
    { browserRequests: [{ id: "job", conversationId: "valid", goal: "Open page", url: "file:///private", createdAt: 1, updatedAt: 1, status: "queued" }] },
    { browserRequests: [{ id: "job", conversationId: "valid", goal: "Open page", createdAt: Infinity, updatedAt: 1, status: "queued" }] },
    { browserRequests: [{ id: "job", conversationId: "valid", goal: "Open page", createdAt: 1, updatedAt: 1, status: "run_now" }] },
  ])("rejects malformed remote state %#", (patch) => {
    expect(() => safeMessagingStatus({ ...status(), ...patch })).toThrow(/invalid/);
  });
});
