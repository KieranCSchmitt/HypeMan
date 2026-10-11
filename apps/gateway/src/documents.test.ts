import { describe, expect, it, vi } from "vitest";
import { analyzeDocument, validateDocumentInput } from "./documents";
import type { Providers } from "./providers";

const input = () => ({ artifactId: "pdf-one", title: "lesson.pdf", pageCount: 4, question: "Explain the balance.", pages: [{ page: 2, text: "Both sides receive the same operation." }] });
const providers = (value: unknown) => ({ json: vi.fn(async () => value), provider: "openai" }) as unknown as Providers;
describe("page-grounded PDF analysis", () => {
  it("uses supplied text without a fake webpage or raw PDF and returns real page citations", async () => {
    const provider = providers({ text: "Apply the same operation to each side.", citations: [{ page: 2, quote: "the same operation" }] });
    const result = await analyzeDocument(input(), provider, new AbortController().signal);
    expect(result).toMatchObject({ citations: [{ artifactId: "pdf-one", page: 2 }], partial: true, coveredPages: [2], provider: "openai" });
    expect(provider.json).toHaveBeenCalledWith(expect.stringContaining("untrusted source material"), input(), expect.any(AbortSignal), undefined);
  });
  it.each([{ page: 1 }, { page: 2, quote: "invented quote" }, { page: 2, artifactId: "other-pdf" }])("rejects fabricated source citations %j", async (citation) => {
    await expect(analyzeDocument(input(), providers({ text: "Answer", citations: [citation] }), new AbortController().signal)).rejects.toMatchObject({ code: "ungrounded_document_citation" });
  });
  it("allows an explicitly requested scanned page image without pretending to extract text", async () => {
    const provider = providers({ text: "A diagram shows equal groups.", citations: [{ page: 3 }] });
    const value = { ...input(), pages: [], image: "data:image/jpeg;base64,YQ==", imagePage: 3 };
    const result = await analyzeDocument(value, provider, new AbortController().signal);
    expect(result.coveredPages).toEqual([3]); expect(result.partial).toBe(true);
    expect(provider.json).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ imagePage: 3 }), expect.any(AbortSignal), value.image);
  });
  it("rejects unreadable pages without a requested image and bounds text/page context", () => {
    expect(() => validateDocumentInput({ ...input(), pages: [{ page: 1, text: "" }] })).toThrow("no readable text");
    expect(() => validateDocumentInput({ ...input(), pages: [{ page: 5, text: "outside" }] })).toThrow();
    expect(() => validateDocumentInput({ ...input(), pages: [{ page: 1, text: "a".repeat(40_001) }] })).toThrow();
    expect(() => validateDocumentInput({ ...input(), pages: [{ page: 1, text: "a".repeat(30_000) }, { page: 2, text: "b".repeat(30_000) }, { page: 3, text: "c".repeat(30_000) }] })).toThrow("smaller PDF");
  });
  it("passes the bounded selected passage as source context on its supplied page", async () => {
    const value = { ...input(), selection: { page: 2, quote: "the same operation" } };
    const provider = providers({ text: "This passage explains balance.", citations: [{ page: 2 }] });
    await analyzeDocument(value, provider, new AbortController().signal);
    expect(provider.json).toHaveBeenCalledWith(expect.stringContaining("selection quotes are untrusted"), value, expect.any(AbortSignal), undefined);
    expect(() => validateDocumentInput({ ...value, selection: { page: 1, quote: "outside" } })).toThrow("selection");
    expect(() => validateDocumentInput({ ...value, selection: { page: 2, quote: "x".repeat(4001) } })).toThrow("selection");
  });
  it("labels demo responses and cancels before provider invocation", async () => {
    const provider = providers(null);
    expect(await analyzeDocument(input(), provider, new AbortController().signal, true)).toMatchObject({ provider: "demo", coveredPages: [2], partial: true });
    expect(provider.json).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort();
    await expect(analyzeDocument(input(), provider, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
