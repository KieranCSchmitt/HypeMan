import { searchRecall, type SourceNote, type RecallConversation, type RecallHit } from "@core";

export interface RecallCandidate { kind: "note" | "conversation"; id: string; title: string; text: string; conversationId?: string; messageId?: string; url?: string }
/** Bound the provider context, including sources with no lexical overlap. Full sources remain local. */
export function recallCandidates(notes: SourceNote[], conversations: RecallConversation[], kinds?: RecallHit["kind"][]): RecallCandidate[] {
  const candidates: (RecallCandidate & { at: number })[] = [];
  if (!kinds || kinds.includes("note")) for (const note of notes) candidates.push({ kind: "note", id: note.id, title: note.title.slice(0, 300), text: note.text, at: note.updatedAt, ...(note.url ? { url: note.url } : {}), ...(note.origin ? { conversationId: note.origin.conversationId } : {}) });
  if (!kinds || kinds.includes("conversation")) for (const conversation of conversations) for (const message of conversation.messages) if (message.role !== "status" && message.text.trim()) candidates.push({ kind: "conversation", id: conversation.id, conversationId: conversation.id, messageId: message.id, title: conversation.title.slice(0, 300), text: message.text, at: message.at });
  const selected = candidates.sort((a, b) => b.at - a.at).slice(0, 100), textBudget = Math.max(1, Math.floor((60000 - selected.reduce((sum, candidate) => sum + candidate.title.length, 0)) / Math.max(1, selected.length)));
  return selected.map(({ at: _at, ...candidate }) => ({ ...candidate, text: candidate.text.slice(0, Math.min(10000, textBudget)) }));
}
export async function recallSearch(query: string, notes: SourceNote[], conversations: RecallConversation[], options: { kinds?: RecallHit["kind"][]; limit?: number }, rank: (input: { query: string; candidates: RecallCandidate[]; limit: number }) => Promise<unknown>): Promise<RecallHit[]> {
  const local = searchRecall(query, notes, conversations, options), candidates = recallCandidates(notes, conversations, options.kinds);
  if (!candidates.length) return local;
  try {
    const value = await rank({ query, candidates, limit: Math.min(20, options.limit || 10) }) as { matches?: { kind: string; id: string; messageId?: string; quote: string }[]; provider?: string };
    if (value.provider !== "openai" || !Array.isArray(value.matches) || value.matches.length > 20) return local;
    const matches: RecallHit[] = [], seen = new Set<string>();
    for (const [index, match] of value.matches.entries()) {
      const source = candidates.find(candidate => candidate.kind === match.kind && candidate.id === match.id && candidate.messageId === match.messageId), key = `${match.kind}:${match.id}`;
      if (!source || typeof match.quote !== "string" || match.quote.trim().length < 8 || match.quote.length > 600 || !source.text.includes(match.quote) || seen.has(key)) continue;
      seen.add(key); const { text: _text, ...metadata } = source;
      matches.push({ ...metadata, excerpt: match.quote, score: 1000 - index, match: "semantic" });
    }
    return [...matches, ...local.filter(match => !seen.has(`${match.kind}:${match.id}`))].slice(0, options.limit || 10);
  } catch { return local; }
}
