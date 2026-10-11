import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config";
import { PhotonAdapter, type IncomingPhoneMessage, type PhotonRuntime } from "./photon";

type Envelope = PhotonRuntime["messages"] extends AsyncIterable<infer Item> ? Item : never;

function messageQueue() {
  const pending: Envelope[] = [];
  let wake: (() => void) | undefined;
  let ended = false;
  let failure: Error | undefined;
  return {
    push(item: Envelope) { pending.push(item); wake?.(); },
    end() { ended = true; wake?.(); },
    fail() { failure = new Error("sensitive-provider-detail"); wake?.(); },
    messages: {
      async *[Symbol.asyncIterator]() {
        while (true) {
          if (failure) throw failure;
          const next = pending.shift();
          if (next) { yield next; continue; }
          if (ended) return;
          await new Promise<void>((resolve) => { wake = resolve; });
        }
      },
    },
  };
}
const config = () => loadConfig({ SPECTRUM_PROJECT_ID: "test-project", SPECTRUM_PROJECT_SECRET: "private-test-secret" });
function fixture() {
  const queue = messageQueue();
  const space = { id: "iMessage;-;+12125550123", phone: "shared", type: "dm" as const, send: vi.fn(async () => ({ id: "outbound-one" })) };
  const runtime: PhotonRuntime = {
    messages: queue.messages,
    createSpace: vi.fn(async () => space),
    getSpace: vi.fn(async () => space),
    stop: vi.fn(async () => { queue.end(); }),
  };
  const factory = vi.fn(async () => runtime);
  return { queue, space, runtime, factory, adapter: new PhotonAdapter(config(), factory) };
}

describe("Photon managed transport", () => {
  it("does not load or connect the SDK without complete credentials or in demo mode", async () => {
    const factory = vi.fn();
    for (const env of [{}, { SPECTRUM_PROJECT_ID: "only-id" }, { DEMO_MODE: "1", SPECTRUM_PROJECT_ID: "id", SPECTRUM_PROJECT_SECRET: "secret" }]) {
      const adapter = new PhotonAdapter(loadConfig(env), factory);
      await adapter.start(vi.fn());
      expect(adapter.connected).toBe(false);
      expect(adapter.error).toBeTruthy();
      await expect(adapter.send({ phone: "+12125550123" }, "hi")).rejects.toMatchObject({ status: 503 });
      await adapter.close();
    }
    expect(factory).not.toHaveBeenCalled();
    expect(loadConfig({ SPECTRUM_PROJECT_ID: " id ", SPECTRUM_PROJECT_SECRET: " secret " })).toMatchObject({ spectrumProjectId: "id", spectrumProjectSecret: "secret" });
  });

  it("normalizes text direction, sender and group metadata while ignoring other content", async () => {
    const { adapter, queue, space } = fixture();
    const received: IncomingPhoneMessage[] = [];
    await adapter.start(async (message) => { received.push(message); });
    const message = { id: "incoming-one", sender: { id: "+12125550123" }, direction: "inbound" as const, content: { type: "text", text: "hello" }, timestamp: new Date(1000) };
    queue.push([space, message]);
    queue.push([space, { ...message, id: "outbound-echo", direction: "outbound" }]);
    queue.push([{ ...space, type: "group" }, { ...message, id: "group-message", sender: undefined }]);
    queue.push([space, { ...message, content: { type: "attachment" } }]);
    queue.push([space, { ...message, id: "threaded-reply", content: { type: "reply", content: { type: "text", text: "STOP" } } }]);
    await vi.waitFor(() => expect(received).toHaveLength(4));
    expect(received[0]).toMatchObject({ id: "incoming-one", sender: "+12125550123", text: "hello", at: 1000, fromMe: false, isGroup: false });
    expect(received[1]).toMatchObject({ fromMe: true });
    expect(received[2]).toMatchObject({ sender: "", isGroup: true });
    expect(received[3]).toMatchObject({ id: "threaded-reply", text: "STOP" });
    expect(received[0].spaceId).not.toContain("iMessage;");
    await adapter.close();
  });

  it("restores the chat and sending line from its persisted opaque identity", async () => {
    const first = fixture();
    await first.adapter.start(vi.fn());
    const sent = await first.adapter.send({ phone: "+12125550123" }, "pairing invitation");
    expect(first.runtime.createSpace).toHaveBeenCalledWith("+12125550123");
    expect(sent).toMatchObject({ id: "outbound-one", spaceId: expect.any(String) });
    await first.adapter.send({ phone: "+12125550123", spaceId: sent.spaceId }, "cached reply");
    expect(first.runtime.getSpace).not.toHaveBeenCalled();
    await first.adapter.close();
    const second = fixture();
    await second.adapter.start(vi.fn());
    await second.adapter.send({ phone: "+12125550123", spaceId: sent.spaceId }, "after restart");
    expect(second.runtime.getSpace).toHaveBeenCalledWith(first.space.id, first.space.phone);
    expect(second.runtime.createSpace).not.toHaveBeenCalled();
    await second.adapter.close();
  });

  it("rejects invalid recipients, invalid spaces, and group destinations before sending", async () => {
    const { adapter, runtime, space } = fixture();
    await adapter.start(vi.fn());
    await expect(adapter.send({ phone: "2125550123" }, "hi")).rejects.toMatchObject({ status: 400 });
    await expect(adapter.send({ phone: "+12125550123", spaceId: "bad-data" }, "hi")).rejects.toMatchObject({ status: 400 });
    vi.mocked(runtime.createSpace).mockResolvedValueOnce({ ...space, type: "group" });
    await expect(adapter.send({ phone: "+12125550123" }, "hi")).rejects.toMatchObject({ status: 400 });
    expect(space.send).not.toHaveBeenCalled();
    await adapter.close();
  });

  it("surfaces uncertain delivery without retrying it", async () => {
    const { adapter, space } = fixture();
    await adapter.start(vi.fn());
    space.send.mockResolvedValueOnce(undefined as unknown as { id: string });
    await expect(adapter.send({ phone: "+12125550123" }, "reminder")).rejects.toMatchObject({ code: "messaging_delivery_unknown" });
    expect(space.send).toHaveBeenCalledTimes(1);
    await adapter.close();
  });

  it("reports terminal connection failures without leaking provider errors", async () => {
    const { adapter, queue } = fixture();
    await adapter.start(vi.fn());
    queue.fail();
    await vi.waitFor(() => expect(adapter.connected).toBe(false));
    expect(adapter.error).toContain("Restart");
    expect(adapter.error).not.toContain("sensitive-provider-detail");
    await adapter.close();
    const failed = new PhotonAdapter(config(), async () => { throw new Error("private-test-secret"); });
    await failed.start(vi.fn());
    expect(failed.error).not.toContain("private-test-secret");
    expect(failed.connected).toBe(false);
  });

  it("disposes a connection that completes after shutdown", async () => {
    const { runtime } = fixture();
    let complete!: (value: PhotonRuntime) => void;
    const adapter = new PhotonAdapter(config(), () => new Promise((resolve) => { complete = resolve; }));
    const starting = adapter.start(vi.fn());
    await adapter.close();
    complete(runtime);
    await starting;
    expect(runtime.stop).toHaveBeenCalledTimes(1);
    expect(adapter.connected).toBe(false);
  });

  it("delivers a following STOP while the first callback is still processing", async () => {
    const { adapter, queue, space, runtime } = fixture();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const received: string[] = [];
    await adapter.start(async (message) => {
      received.push(message.text);
      if (message.text === "discuss a goal") await waiting;
    });
    const message = { id: "first", sender: { id: "+12125550123" }, direction: "inbound" as const, content: { type: "text", text: "discuss a goal" }, timestamp: new Date(1000) };
    queue.push([space, message]);
    queue.push([space, { ...message, id: "stop", content: { type: "text", text: "STOP" } }]);
    await vi.waitFor(() => expect(received).toEqual(["discuss a goal", "STOP"]));
    await adapter.close();
    expect(runtime.stop).toHaveBeenCalledTimes(1);
    release();
  });

  it("observes callback failures while continuing to receive later messages", async () => {
    const { adapter, queue, space } = fixture();
    const received: string[] = [];
    await adapter.start(async (message) => {
      received.push(message.id);
      if (message.id === "cannot-save") throw new Error("private storage detail");
    });
    const message = { id: "cannot-save", sender: { id: "+12125550123" }, direction: "inbound" as const, content: { type: "text", text: "hi" }, timestamp: new Date(1000) };
    queue.push([space, message]);
    queue.push([space, { ...message, id: "next" }]);
    await vi.waitFor(() => expect(received).toEqual(["cannot-save", "next"]));
    expect(adapter.connected).toBe(true);
    expect(adapter.error).toContain("could not be saved or processed");
    expect(adapter.error).not.toContain("private storage detail");
    await adapter.close();
  });
});
