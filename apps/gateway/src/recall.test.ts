import { afterEach, describe, expect, it, vi } from "vitest";
import { groundedRecall, rankRecall, validateRecallRequest, type RecallRankRequest } from "./recall";
import { createGateway } from "./index";
import { loadConfig } from "./config";
import type { Providers } from "./providers";

const source = "Spaced repetition strengthens retrieval by revisiting material at increasing intervals.";
const input = (): RecallRankRequest => ({ query: "How can I keep information over time?", candidates: [
  { kind: "note", id: "memory-note", title: "Study method", text: source, url: "https://example.com/learning" },
  { kind: "conversation", id: "conversation-1", messageId: "message-1", title: "Trip", text: "The workshop ticket costs sixty dollars." },
] });

describe("grounded semantic recall", () => {
  it("uses live provider ranking on the actual candidate universe even without shared query words", async () => {
    const providers = { provider: "chatgpt", json: vi.fn(async () => ({ matches: [{ kind: "note", id: "memory-note", quote: source }] })) } as unknown as Providers;
    expect(await rankRecall(input(), providers, false, new AbortController().signal)).toEqual({
      provider: "chatgpt", matches: [{ kind: "note", id: "memory-note", quote: source }],
    });
    const [instructions, context] = vi.mocked(providers.json).mock.calls[0];
    expect(instructions).toContain("wording differs");
    expect(instructions).toContain("untrusted");
    expect(context).toMatchObject({ candidates: input().candidates });
  });
  it("drops invented IDs, paraphrases, combined quotations, mismatched message IDs, and duplicates", () => {
    expect(groundedRecall({ matches: [
      { kind: "note", id: "missing", quote: source },
      { kind: "note", id: "memory-note", quote: "Repetition helps you remember everything." },
      { kind: "note", id: "memory-note", quote: "Spaced repetition increasing intervals." },
      { kind: "conversation", id: "conversation-1", messageId: "missing-message", quote: "The workshop ticket costs sixty dollars." },
      { kind: "note", id: "memory-note", quote: source },
      { kind: "note", id: "memory-note", quote: source },
    ] }, input())).toEqual([{ kind: "note", id: "memory-note", quote: source }]);
  });
  it("distinguishes source messages within the same conversation and respects the requested limit", () => {
    const request = input();
    request.candidates.push({ kind: "conversation", id: "conversation-1", messageId: "message-2", title: "Trip", text: "The registration deadline is next Friday." });
    request.limit = 1;
    expect(groundedRecall({ matches: [
      { kind: "conversation", id: "conversation-1", messageId: "message-2", quote: "The registration deadline is next Friday." },
      { kind: "note", id: "memory-note", quote: source },
    ] }, request)).toEqual([{ kind: "conversation", id: "conversation-1", messageId: "message-2", quote: "The registration deadline is next Friday." }]);
  });
  it("returns no model ranking in demo mode instead of fabricating semantic results", async () => {
    const providers = { provider: "chatgpt", json: vi.fn() } as unknown as Providers;
    expect(await rankRecall(input(), providers, true, new AbortController().signal)).toEqual({ provider: "demo", matches: [] });
    expect(providers.json).not.toHaveBeenCalled();
  });
  it("drops a late ranking after cancellation", async () => {
    const controller = new AbortController();
    const providers = { provider: "chatgpt", json: vi.fn(async () => { controller.abort(); return { matches: [{ kind: "note", id: "memory-note", quote: source }] }; }) } as unknown as Providers;
    await expect(rankRecall(input(), providers, false, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    await expect(rankRecall(input(), providers, false, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(providers.json).toHaveBeenCalledTimes(1);
  });
  it("validates candidate bounds, identities, source URLs and total source context", () => {
    expect(validateRecallRequest(input())).toEqual(input());
    expect(() => validateRecallRequest({ ...input(), query: " " })).toThrow();
    expect(() => validateRecallRequest({ ...input(), limit: 30 })).toThrow();
    expect(() => validateRecallRequest({ ...input(), candidates: Array.from({ length: 101 }, (_, i) => ({ ...input().candidates[0], id: `note-${i}` })) })).toThrow();
    expect(() => validateRecallRequest({ ...input(), candidates: [input().candidates[0], input().candidates[0]] })).toThrow();
    expect(() => validateRecallRequest({ ...input(), candidates: [{ ...input().candidates[0], url: "javascript:alert(1)" }] })).toThrow();
    expect(() => validateRecallRequest({ ...input(), candidates: Array.from({ length: 7 }, (_, i) => ({ ...input().candidates[0], id: `note-${i}`, text: "x".repeat(10000) })) })).toThrow();
  });
});

const gateways: ReturnType<typeof createGateway>[] = [];
afterEach(async () => { await Promise.all(gateways.splice(0).map((gateway) => gateway.close())); });
describe("semantic recall HTTP boundary", () => {
  it("uses the authenticated bounded route and labels demo ranking honestly", async () => {
    const gateway = createGateway(loadConfig({ DEMO_MODE: "1", PORT: "0" }), { token: "recall-test-token" });
    gateways.push(gateway);
    const port = await gateway.listen();
    const post = (value: unknown, token = "recall-test-token") => fetch(`http://127.0.0.1:${port}/api/recall/rank`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(value),
    });
    const valid = await post(input());
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ provider: "demo", matches: [] });
    expect((await post({ ...input(), candidates: [{ id: "missing-fields" }] })).status).toBe(400);
    expect((await post(input(), "incorrect-token")).status).toBe(401);
  });
});
