import { describe, expect, it, vi } from "vitest";
import { unavailableMessagingStatus, type AgentRequest, type ReminderDraft } from "@core";
import { ConversationAssistance } from "./conversation-assistance";
const now = Date.parse("2026-10-11T04:29:00Z");
const request = (message: string, conversationId = "chat-one"): AgentRequest => ({ conversationId, requestId: crypto.randomUUID(), goal: message, message, mode: "learn", history: [], task: null,
  page: { url: "https://math.example", title: "Practice", text: "10 ÷ 5 = 1", headings: [], selection: "", elements: [], errors: ["Incorrect"], successes: [], frames: { count: 0, inaccessible: 0 }, capturedAt: now, revision: 1 } });
function fixture() {
  const drafts = new Map<string, ReminderDraft>(), messages = new Map<string, Array<{ role: string; text: string; at: number }>>();
  const phone = { ...unavailableMessagingStatus(), configured: true, connected: true, paired: true };
  const api = {
    conversation: vi.fn(async (id: string) => ({ messages: messages.get(id) || [] })),
    draft: vi.fn(async (id: string) => structuredClone(drafts.get(id) || null)),
    saveDraft: vi.fn(async (id: string, draft: ReminderDraft | null) => { if (draft) drafts.set(id, structuredClone(draft)); else drafts.delete(id); }),
    phoneStatus: vi.fn(async () => phone), schedule: vi.fn(async () => ({})), now: () => now, timezone: () => "America/New_York",
  };
  return { api, drafts, messages, phone, service: new ConversationAssistance(api) };
}
describe("conversation reminder orchestration", () => {
  it("finishes the screenshot's two-turn request without invoking a model or opening a phone window", async () => {
    const f = fixture();
    const initial = request("send me a text reminder at 12:30 to practice math");
    expect((await f.service.prepare(initial)).reply?.action).toEqual({ type: "say", text: "12:30 AM or PM?" });
    // Worker/document replacement uses the same durable draft.
    const replacement = new ConversationAssistance(f.api);
    const answer = await replacement.prepare(request("AM est"));
    expect(f.api.schedule).toHaveBeenCalledExactlyOnceWith("practice math", Date.parse("2026-10-11T05:30:00Z"), initial.requestId);
    expect(answer.reply?.action).toMatchObject({ type: "say", text: expect.stringContaining("practice math") });
    expect(f.drafts.size).toBe(0); expect(answer.input.page.text).toBe("");
  });
  it("keeps details after service failure and retries using the same idempotency key", async () => {
    const f = fixture(), initial = request("remind me to stretch in 10 minutes");
    f.api.schedule.mockRejectedValueOnce(new Error("Response lost"));
    expect((await f.service.prepare(initial)).reply?.action).toMatchObject({ text: expect.stringContaining("try again") });
    await f.service.prepare(request("try again"));
    expect(f.api.schedule.mock.calls).toEqual([["stretch", now + 600000, initial.requestId], ["stretch", now + 600000, initial.requestId]]);
  });
  it.each([false, true])("cancels a held phone-status request and queued turns (saved draft: %s)", async (savedDraft) => {
    const f = fixture();
    if (savedDraft) await f.service.prepare(request("remind me to study at 9"));
    let release!: (value: typeof f.phone) => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    f.api.phoneStatus.mockImplementationOnce(() => { entered(); return new Promise((resolve) => { release = resolve; }); });
    const pending = f.service.prepare(request(savedDraft ? "AM" : "remind me to study in 10 minutes")).catch((cause) => cause);
    await waiting;
    const queued = f.service.prepare(request("try again")).catch((cause) => cause);
    await f.service.cancel("chat-one");
    expect(f.drafts.size).toBe(0);
    const writesAfterCancel = f.api.saveDraft.mock.calls.length;
    // A new turn must not wait for the cancelled phone-status call or inherit its draft.
    expect((await f.service.prepare(request("AM"))).reply).toBeUndefined();
    release(f.phone);
    expect(await pending).toMatchObject({ name: "AbortError" });
    expect(await queued).toMatchObject({ name: "AbortError" });
    expect(f.api.schedule).not.toHaveBeenCalled();
    expect(f.api.saveDraft.mock.calls.slice(writesAfterCancel)).toEqual([]);
    expect(f.drafts.size).toBe(0);
  });
  it("clears a saved reminder on natural cancellation without changing another conversation", async () => {
    const f = fixture();
    await f.service.prepare(request("remind me to study at 9"));
    await f.service.prepare(request("remind me to stretch at 10", "chat-two"));
    expect((await f.service.prepare(request("cancel the reminder"))).reply?.action).toMatchObject({ text: "Reminder draft cancelled." });
    expect(f.drafts.has("chat-one")).toBe(false);
    expect(f.drafts.get("chat-two")?.text).toBe("stretch");
    expect(f.api.schedule).not.toHaveBeenCalled();
  });
  it("cancels preparation before a delayed conversation read completes", async () => {
    const f = fixture();
    let release!: (value: { messages: [] }) => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    f.api.conversation.mockImplementationOnce(() => { entered(); return new Promise((resolve) => { release = resolve; }); });
    const pending = f.service.prepare(request("remind me to study in 10 minutes")).catch((cause) => cause);
    await waiting;
    await f.service.cancel("chat-one");
    release({ messages: [] });
    expect(await pending).toMatchObject({ name: "AbortError" });
    expect(f.api.phoneStatus).not.toHaveBeenCalled();
    expect(f.api.schedule).not.toHaveBeenCalled();
    expect(f.drafts.size).toBe(0);
  });
  it("retains cancellation ownership while the caller loads context before preparing", async () => {
    const f = fixture(), check = f.service.checkpoint("chat-one");
    await f.service.cancel("chat-one");
    await expect(f.service.prepare(request("remind me to study in 10 minutes"), check)).rejects.toMatchObject({ name: "AbortError" });
    expect(f.api.conversation).not.toHaveBeenCalled();
    expect(f.api.phoneStatus).not.toHaveBeenCalled();
    expect(f.api.schedule).not.toHaveBeenCalled();
  });
  it("never schedules after a topic change or from a different conversation", async () => {
    const f = fixture(); await f.service.prepare(request("remind me to study at 9"));
    const foreign = await f.service.prepare(request("AM", "chat-two"));
    expect(foreign.reply).toBeUndefined(); expect(f.api.schedule).not.toHaveBeenCalled();
    await f.service.prepare(request("Why is my answer wrong?"));
    expect(f.drafts.size).toBe(0);
    expect((await f.service.prepare(request("AM"))).reply).toBeUndefined();
  });
  it("carries structured chat history on ordinary webpage requests and drops irrelevant page context", async () => {
    const f = fixture(); f.messages.set("chat-one", [{ role: "user", text: "Explain inertia", at: 1 }, { role: "assistant", text: "It resists changes in motion.", at: 2 }]);
    const result = await f.service.prepare(request("Give another example"));
    expect(result.input.conversation).toHaveLength(2); expect(result.input.contextScope).toBe("conversation");
    expect(result.input.page.text).toBe(""); expect(result.input.clock).toEqual({ now, timezone: "America/New_York" });
  });
  it("uses paired timezone as a default and retains an unpaired request", async () => {
    const f = fixture(); f.phone.settings.timezone = "America/Los_Angeles";
    await f.service.prepare(request("remind me to study at 9 AM"));
    expect(f.api.schedule).toHaveBeenLastCalledWith("study", Date.parse("2026-10-11T16:00:00Z"), expect.any(String));
    f.phone.paired = false;
    expect((await f.service.prepare(request("remind me to stretch in 5 minutes"))).reply?.action).toMatchObject({ text: expect.stringContaining("Pair your phone") });
    expect(f.drafts.get("chat-one")?.text).toBe("stretch");
  });
});
