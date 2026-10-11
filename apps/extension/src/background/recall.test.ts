import { describe, expect, it, vi } from "vitest";
import { searchRecall, type SourceNote } from "@core";
import { recallCandidates, recallSearch } from "./recall";
const note: SourceNote = { id: "garden", title: "Window box", text: "The fern perks up after water and indirect sunlight.", excerpt: "Fern care", url: "https://example.com/garden", createdAt: 1, updatedAt: 2 };
const chats = [{ id: "chat", title: "Trip", updatedAt: 4, messages: [{ id: "m1", role: "user", text: "The train leaves after the workshop.", at: 4 }] }];
describe("grounded saved-work recall", () => {
  it("searches conversation contents and offers explicitly limited local concept expansion", () => {
    expect(searchRecall("transport", [], chats)[0]).toMatchObject({ kind: "conversation", messageId: "m1", match: "concept", excerpt: chats[0].messages[0].text });
    expect(searchRecall("unrelated quantum entropy", [note], chats)).toEqual([]);
  });
  it("allows a provider to rank a source with zero word overlap, using only exact saved evidence", async () => {
    const rank = vi.fn(async (_input: { candidates: unknown[] }) => ({ provider: "openai", matches: [{ kind: "note", id: "garden", quote: "fern perks up after water" }, { kind: "note", id: "invented", quote: "made up source" }] }));
    const results = await recallSearch("How do I help a thirsty houseplant?", [note], chats, {}, rank);
    expect(results).toMatchObject([{ kind: "note", id: "garden", match: "semantic", excerpt: "fern perks up after water" }]);
    expect(rank.mock.calls[0][0].candidates).toHaveLength(2);
  });
  it("falls back locally on provider failure and rejects invented evidence", async () => {
    expect(await recallSearch("fern", [note], chats, {}, async () => { throw new Error("offline"); })).toEqual(searchRecall("fern", [note], chats));
    expect(await recallSearch("thirsty", [note], chats, {}, async () => ({ provider: "openai", matches: [{ kind: "note", id: "garden", quote: "not in this source" }] }))).toEqual([]);
  });
  it("bounds the candidate universe without filtering solely by word matches", () => {
    const many = Array.from({ length: 110 }, (_, index) => ({ ...note, id: `n${index}`, text: "x".repeat(20000), updatedAt: index }));
    const candidates = recallCandidates(many, []);
    expect(candidates).toHaveLength(100); expect(candidates.reduce((sum, candidate) => sum + candidate.title.length + candidate.text.length, 0)).toBeLessThanOrEqual(60000);
  });
});
