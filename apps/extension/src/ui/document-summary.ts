import { MAX_DOCUMENT_CONTEXT_TEXT, type DocumentPage, type DocumentAnalysisReply, type DocumentAnalysisRequest } from "../../../../packages/core/src/documents";
export interface SummaryCheckpoint {
  version: 1; source: string; question: string; pageCount: number; nextPage: number;
  stages: DocumentAnalysisReply[]; combined?: DocumentAnalysisReply[];
}
interface SummaryOptions {
  source: string; question: string; pageCount: number; checkpoint?: SummaryCheckpoint | null;
  extract: (page: number) => Promise<DocumentPage>;
  analyze: (pages: DocumentAnalysisRequest["pages"], question: string, signal: AbortSignal) => Promise<DocumentAnalysisReply>;
  synthesize: (analyses: DocumentAnalysisReply[], question: string, signal: AbortSignal) => Promise<DocumentAnalysisReply>;
  save: (checkpoint: SummaryCheckpoint | null, latest?: DocumentAnalysisReply) => Promise<void>;
  status: (text: string) => void; signal: AbortSignal; maxCalls?: number; budgetMs?: number; now?: () => number;
}
/** Bounded, durable stages make a long PDF resumable without repeating reviewed pages. */
export async function runDocumentSummary(options: SummaryOptions) {
  const { source, pageCount, signal } = options, now = options.now || Date.now;
  const deadline = now() + (options.budgetMs ?? 60_000), maxCalls = options.maxCalls ?? 4;
  const previous = options.checkpoint;
  const checkpoint: SummaryCheckpoint = previous?.version === 1 && previous.source === source && previous.pageCount === pageCount
    ? structuredClone(previous) : { version: 1, source, question: options.question, pageCount, nextPage: 1, stages: [] };
  let calls = 0;
  const paused = async () => { await options.save(checkpoint, checkpoint.combined?.[0] || checkpoint.stages.at(-1)); return { paused: true as const, checkpoint, result: undefined }; };
  const invoke = async (run: (requestSignal: AbortSignal) => Promise<DocumentAnalysisReply>) => {
    signal.throwIfAborted(); calls++;
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, deadline - now()))]);
    try { const result = await run(requestSignal); requestSignal.throwIfAborted(); return result; }
    catch (error) { signal.throwIfAborted(); if (requestSignal.aborted && now() >= deadline) return null; throw error; }
  };
  while (checkpoint.nextPage <= pageCount) {
    signal.throwIfAborted();
    if (calls >= maxCalls || now() >= deadline) return paused();
    const pages: DocumentAnalysisRequest["pages"] = []; let length = 0, cursor = checkpoint.nextPage;
    while (cursor <= pageCount && pages.length < 20) {
      signal.throwIfAborted();
      if (now() >= deadline) return paused();
      options.status(`Reading page ${cursor} of ${pageCount}…`);
      const page = await options.extract(cursor); signal.throwIfAborted();
      if (pages.length && length + page.text.length > MAX_DOCUMENT_CONTEXT_TEXT) break;
      if (page.text.trim()) { pages.push({ page: cursor, text: page.text, ...(page.truncated ? { truncated: true } : {}) }); length += page.text.length; }
      cursor++;
      // Empty scanned pages also advance durably; an entirely scanned book remains cancellable.
      if (!pages.length && cursor - checkpoint.nextPage >= 20) break;
    }
    if (pages.length) {
      options.status(`Reading summary · p. ${pages[0].page}–${pages.at(-1)!.page}…`);
      const result = await invoke((requestSignal) => options.analyze(pages, checkpoint.question, requestSignal));
      if (!result) return paused();
      checkpoint.stages.push(result);
    }
    checkpoint.nextPage = cursor;
    await options.save(checkpoint, checkpoint.stages.at(-1));
  }
  checkpoint.combined ||= [...checkpoint.stages];
  while (checkpoint.combined.length > 1) {
    signal.throwIfAborted();
    if (calls >= maxCalls || now() >= deadline) return paused();
    options.status("Reading combined summary…");
    const group = checkpoint.combined.slice(0, 6);
    const result = await invoke((requestSignal) => options.synthesize(group, checkpoint.question, requestSignal));
    if (!result) return paused();
    checkpoint.combined.splice(0, group.length, result);
    await options.save(checkpoint, result);
  }
  const result = checkpoint.combined[0];
  await options.save(null, result);
  return { paused: false as const, checkpoint, result };
}
