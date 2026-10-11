import { describe, expect, it, vi } from "vitest";
import { runDocumentSummary, type SummaryCheckpoint } from "../apps/extension/src/ui/document-summary";
import type { DocumentAnalysisReply } from "../packages/core/src/documents";
const reply = (pages: number[]): DocumentAnalysisReply => ({ text: "Page facts.", citations: [{ artifactId: "pdf", page: pages[0] }], coveredPages: pages, partial: pages.length < 150, provider: "fixture" });
describe("resumable whole-PDF summaries", () => {
  it("reviews 150 pages across bounded calls and resumes without repeating reviewed pages", async () => {
    let checkpoint: SummaryCheckpoint | null = null;
    const extracted: number[] = [], analyzed: number[][] = [];
    const options = { source: "pdf:revision-1", question: "Summarize the whole document", pageCount: 150, signal: new AbortController().signal, status: vi.fn(),
      extract: async (page: number) => { extracted.push(page); return { documentId: "pdf", page, text: `Actual page ${page}`, truncated: false, method: "embedded" as const }; },
      analyze: async (pages: { page: number }[]) => { analyzed.push(pages.map((page) => page.page)); return reply(pages.map((page) => page.page)); },
      synthesize: async (parts: DocumentAnalysisReply[]) => { const pages = parts.flatMap((part) => part.coveredPages); return reply(pages); },
      save: async (value: SummaryCheckpoint | null) => { checkpoint = value ? structuredClone(value) : null; },
    };
    const first = await runDocumentSummary(options);
    expect(first.paused).toBe(true); expect((checkpoint as SummaryCheckpoint | null)?.nextPage).toBe(81); expect(analyzed).toHaveLength(4);
    const second = await runDocumentSummary({ ...options, checkpoint });
    expect(second.paused).toBe(true); expect((checkpoint as SummaryCheckpoint | null)?.nextPage).toBe(151); expect(analyzed).toHaveLength(8);
    const final = await runDocumentSummary({ ...options, checkpoint });
    expect(final.paused).toBe(false); expect(final.result?.coveredPages).toHaveLength(150); expect(final.result?.partial).toBe(false); expect(checkpoint).toBeNull();
    expect(extracted).toEqual(Array.from({ length: 150 }, (_, index) => index + 1));
  });
  it("checkpoints before a time budget expires and never publishes a cancelled stage", async () => {
    let now = 0; const save = vi.fn();
    const options = { source: "pdf", question: "Summary", pageCount: 150, signal: new AbortController().signal, now: () => now, budgetMs: 10, status: vi.fn(), save,
      extract: async (page: number) => { now += 11; return { documentId: "pdf", page, text: "Text", truncated: false, method: "embedded" as const }; }, analyze: vi.fn(async () => reply([1])), synthesize: vi.fn(async () => reply([1])) };
    expect((await runDocumentSummary(options)).paused).toBe(true); expect(options.analyze).not.toHaveBeenCalled(); expect(save).toHaveBeenCalled();
    const controller = new AbortController(); controller.abort();
    await expect(runDocumentSummary({ ...options, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
