import type { SourceNote } from "./workspace";

export interface RecallConversation { id: string; title: string; updatedAt: number; messages: { id: string; role: string; text: string; at: number }[] }
export interface RecallMatch {
  kind: "note" | "conversation"; id: string; title: string; excerpt: string; score: number;
  match: "literal" | "concept" | "semantic"; conversationId?: string; messageId?: string; url?: string;
}
export type RecallHit = RecallMatch;
const stop = new Set("a an and are as at be by can do find for from how i in is it me my notes of on or our please show that the these this to was we what with about chats conversations saved".split(" "));
const concepts = [
  "remember remembering memory retention recall retrieval spaced spacing forgetting lessons learning study practice",
  "cancel cancellation cancelled canceled refund return withdrawal",
  "cost costs price prices pricing budget expense expenses affordable cheap cheaper",
  "workshop workshops class classes course courses lesson lessons training",
  "travel trip trips journey vacation holiday transport train flight hotel booking",
  "job jobs career application resume cv employment interview",
  "access accessibility accessible wheelchair accommodations disability",
  "deadline due schedule reminder reminders appointment calendar time",
  "compare comparison versus alternatives options difference differences",
].map(group => group.split(" "));
const words = (value: string) => value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
/** Local concept expansion, never an invented summary or a model's claim about saved contents. */
export function searchRecall(query: string, notes: SourceNote[], conversations: RecallConversation[], options: { kinds?: RecallMatch["kind"][]; limit?: number } = {}): RecallMatch[] {
  if (typeof query !== "string" || !query.trim() || query.length > 500) throw new Error("Describe what to find in 500 characters or fewer.");
  const limit = options.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || options.kinds?.some(kind => !["note", "conversation"].includes(kind))) throw new Error("Choose valid recall filters.");
  const terms = [...new Set(words(query).filter(word => !stop.has(word)))];
  if (!terms.length) return [];
  const expanded = new Set(terms);
  for (const group of concepts) if (terms.some(term => group.includes(term))) for (const word of group) expanded.add(word);
  const candidates: { result: RecallMatch; at: number }[] = [];
  const add = (kind: RecallMatch["kind"], id: string, title: string, text: string, at: number, context: Partial<RecallMatch>) => {
    if (options.kinds && !options.kinds.includes(kind)) return;
    const lower = text.toLowerCase(), titleWords = new Set(words(title)), tokens = new Set(words(`${title} ${text}`));
    const exact = terms.filter(term => tokens.has(term)), related = [...expanded].filter(term => !terms.includes(term) && tokens.has(term));
    const literal = lower.includes(query.toLowerCase().trim()) || title.toLowerCase().includes(query.toLowerCase().trim());
    if (!literal && !exact.length && !related.length) return;
    const score = (literal ? 100 : 0) + exact.length * 12 + exact.filter(term => titleWords.has(term)).length * 8 + Math.min(related.length, 5) * 3;
    const locate = [...exact, ...related].map(term => lower.indexOf(term)).filter(index => index >= 0);
    const start = Math.max(0, (locate.length ? Math.min(...locate) : 0) - 80);
    const excerpt = text.slice(start, start + 400);
    candidates.push({ result: { kind, id, title, excerpt, score, match: exact.length || literal ? "literal" : "concept", ...context }, at });
  };
  for (const note of notes) add("note", note.id, note.title, note.text, note.updatedAt, { ...(note.url ? { url: note.url } : {}), ...(note.origin ? { conversationId: note.origin.conversationId } : {}) });
  for (const conversation of conversations) {
    for (const message of conversation.messages) add("conversation", conversation.id, conversation.title, message.text, message.at || conversation.updatedAt, { conversationId: conversation.id, messageId: message.id });
  }
  const best = new Map<string, { result: RecallMatch; at: number }>();
  for (const candidate of candidates.sort((a, b) => b.result.score - a.result.score || b.at - a.at)) {
    const key = `${candidate.result.kind}:${candidate.result.id}`;
    if (!best.has(key)) best.set(key, candidate);
  }
  return [...best.values()].slice(0, limit).map(item => item.result);
}
