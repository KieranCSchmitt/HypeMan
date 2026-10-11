import { MAX_DOCUMENT_CONTEXT_TEXT, type DocumentPage, type DocumentAnalysisRequest } from "../../../../packages/core/src/documents";
const stopWords = new Set(["the", "and", "for", "this", "that", "what", "where", "when", "document", "pdf", "explain", "summarize", "about", "does", "with", "from", "page", "pages", "please"]);
export function documentQuestionPages(pages: DocumentPage[], question: string, current: number, limit = 8): number[] {
  const words = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])].filter((word) => !stopWords.has(word));
  const ranked = pages.map((page) => ({ page: page.page, score: words.reduce((score, word) => score + (page.text.toLowerCase().includes(word) ? 1 : 0), 0) })).filter((page) => page.score > 0).sort((a, b) => b.score - a.score || a.page - b.page);
  if (!ranked.length) return [current];
  const selected = new Set<number>();
  for (const item of ranked) { if (selected.size >= limit) break; selected.add(item.page); }
  return [...selected].sort((a, b) => a - b);
}
/** Every extracted page is accounted for; a full context starts another batch, never drops a suffix. */
export function documentBatches(pages: DocumentPage[]): DocumentAnalysisRequest["pages"][] {
  const batches: DocumentAnalysisRequest["pages"][] = []; let batch: DocumentAnalysisRequest["pages"] = [], length = 0;
  for (const page of pages) {
    if (!page.text.trim()) continue;
    if (batch.length && (batch.length >= 20 || length + page.text.length > MAX_DOCUMENT_CONTEXT_TEXT)) { batches.push(batch); batch = []; length = 0; }
    batch.push({ page: page.page, text: page.text, ...(page.truncated ? { truncated: true } : {}) }); length += page.text.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
export function pageList(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b), ranges: string[] = [];
  for (let index = 0; index < sorted.length;) { const start = sorted[index]; let end = start; while (sorted[index + 1] === end + 1) end = sorted[++index]; ranges.push(start === end ? `${start}` : `${start}–${end}`); index++; }
  return ranges.join(", ");
}
