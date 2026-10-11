import { describe, expect, it } from "vitest";
import { createDocumentHandler, type DocumentRepository, type DocumentUpload, type DocumentChunk, type StoredDocument } from "./documents";
import { MAX_DOCUMENT_BYTES, type DocumentPage } from "../../../../packages/core/src/documents";

const origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const source: chrome.runtime.MessageSender = { id: origin.slice(19), tab: { id: 1 } as chrome.tabs.Tab, frameId: 0, documentId: "page-one", url: "https://example.com/" };
const reader: chrome.runtime.MessageSender = { ...source, documentId: "reader-one", frameId: 3, url: `${origin}/documents.html?conversationId=chat` };
function memory() {
  const uploads = new Map<string, DocumentUpload>(), chunks = new Map<string, DocumentChunk>(), documents = new Map<string, StoredDocument>(), pages = new Map<string, DocumentPage>();
  const repository: DocumentRepository = {
    upload: async (id) => uploads.get(id), begin: async (value) => { uploads.set(value.id, value); },
    chunks: async (id) => [...chunks.values()].filter((chunk) => chunk.uploadId === id),
    chunk: async (upload, chunk) => { uploads.set(upload.id, upload); chunks.set(chunk.id, chunk); },
    cancel: async (id) => { uploads.delete(id); for (const [key, chunk] of chunks) if (chunk.uploadId === id) chunks.delete(key); },
    complete: async (document, id) => { documents.set(document.id, document); await repository.cancel(id); },
    document: async (id) => documents.get(id), list: async (id) => [...documents.values()].filter((document) => document.conversationId === id),
    save: async (document) => { documents.set(document.id, document); }, remove: async (id) => { documents.delete(id); },
    page: async (id, page) => pages.get(`${id}:${page}`), savePage: async (page) => { pages.set(`${page.documentId}:${page.page}`, page); },
  };
  const handler = createDocumentHandler(repository, origin, async () => {});
  const send = (message: Record<string, unknown>, sender = source) => handler({ conversationId: "chat", ...message }, sender)!;
  return { uploads, chunks, documents, repository, send };
}
async function begin(test: ReturnType<typeof memory>, content = "%PDF-1.7\nfixture") {
  const transfer = await test.send({ type: "document.upload.begin", size: content.length, name: "notes.pdf" }) as { uploadId: string; documentId: string };
  return { ...transfer, content, data: btoa(content) };
}
async function upload(test: ReturnType<typeof memory>) {
  const value = await begin(test);
  await test.send({ type: "document.upload.chunk", uploadId: value.uploadId, index: 0, data: value.data });
  await test.send({ type: "document.upload.complete", uploadId: value.uploadId });
  return value;
}
describe("owned, chunked PDF transfers", () => {
  it("stores a local Blob, exposes metadata separately and bounds reader access", async () => {
    const test = memory(), value = await upload(test);
    expect(test.uploads.size).toBe(0); expect(test.chunks.size).toBe(0);
    expect(await test.documents.get(value.documentId)!.blob.text()).toBe(value.content);
    const metadata = await test.send({ type: "document.get", documentId: value.documentId });
    expect(metadata).toMatchObject({ name: "notes.pdf", conversationId: "chat", status: "stored" }); expect(metadata).not.toHaveProperty("blob");
    await expect(test.send({ type: "document.read", documentId: value.documentId, offset: 0, length: 10 })).rejects.toThrow("reader");
    expect(await test.send({ type: "document.read", documentId: value.documentId, offset: 0, length: 10 }, reader)).toMatchObject({ data: btoa(value.content.slice(0, 10)) });
    await expect(test.send({ type: "document.get", documentId: value.documentId, conversationId: "another" })).rejects.toThrow("conversation");
  });
  it("rejects oversize, corrupt, incomplete and out-of-order transfers", async () => {
    const test = memory();
    await expect(test.send({ type: "document.upload.begin", size: MAX_DOCUMENT_BYTES + 1, name: "large.pdf" })).rejects.toThrow("25 MiB");
    const value = await begin(test);
    await expect(test.send({ type: "document.upload.complete", uploadId: value.uploadId })).rejects.toThrow("incomplete");
    await expect(test.send({ type: "document.upload.chunk", uploadId: value.uploadId, index: 1, data: value.data })).rejects.toThrow("out of order");
    const corrupt = await begin(test, "not a PDF");
    await test.send({ type: "document.upload.chunk", uploadId: corrupt.uploadId, index: 0, data: corrupt.data });
    await expect(test.send({ type: "document.upload.complete", uploadId: corrupt.uploadId })).rejects.toThrow("PDF header");
    expect(test.uploads.has(corrupt.uploadId)).toBe(false);
  });
  it("scopes transfer continuation and cancellation to the originating document", async () => {
    const test = memory(), value = await begin(test);
    const other = { ...source, documentId: "page-after-navigation" };
    await expect(test.send({ type: "document.upload.chunk", uploadId: value.uploadId, index: 0, data: value.data }, other)).rejects.toThrow("another screen");
    await expect(test.send({ type: "document.upload.cancel", uploadId: value.uploadId }, other)).rejects.toThrow("another screen");
    await test.send({ type: "document.upload.cancel", uploadId: value.uploadId });
    expect(test.uploads.size).toBe(0); expect(test.chunks.size).toBe(0);
  });
  it("deduplicates exact chunk retries and rejects changed retry bytes", async () => {
    const test = memory(), value = await begin(test);
    await test.send({ type: "document.upload.chunk", uploadId: value.uploadId, index: 0, data: value.data });
    await test.send({ type: "document.upload.chunk", uploadId: value.uploadId, index: 0, data: value.data });
    expect(test.chunks.size).toBe(1);
    await expect(test.send({ type: "document.upload.chunk", uploadId: value.uploadId, index: 0, data: btoa("changed") })).rejects.toThrow("changed");
  });
  it("keeps existing documents after quota failure and allows failed transfer cleanup", async () => {
    const test = memory(), saved = await upload(test), value = await begin(test);
    await test.send({ type: "document.upload.chunk", uploadId: value.uploadId, index: 0, data: value.data });
    test.repository.complete = async () => { throw new DOMException("full", "QuotaExceededError"); };
    await expect(test.send({ type: "document.upload.complete", uploadId: value.uploadId })).rejects.toThrow("other saved work is safe");
    expect(test.documents.has(saved.documentId)).toBe(true);
    await test.send({ type: "document.upload.cancel", uploadId: value.uploadId });
    expect(test.uploads.size).toBe(0);
  });
  it("allows only the reader to persist extracted pages, with real page numbers", async () => {
    const test = memory(), value = await upload(test);
    await test.send({ type: "document.status", documentId: value.documentId, status: "ready", pageCount: 2 }, reader);
    const page = { type: "document.page.put", documentId: value.documentId, page: 2, text: "Actual page two.", truncated: false, method: "embedded" };
    await expect(test.send(page)).rejects.toThrow("reader");
    await test.send(page, reader);
    expect(await test.send({ type: "document.page.get", documentId: value.documentId, page: 2 })).toMatchObject({ text: "Actual page two." });
    await expect(test.send({ ...page, page: 3 }, reader)).rejects.toThrow("Invalid PDF page");
  });
  it("requires a private frame capability before bytes, page extraction or status can be accessed", async () => {
    const test = memory(), value = await upload(test);
    const protectedHandler = createDocumentHandler(test.repository, origin, async () => { throw new Error("unauthorized frame"); });
    for (const message of [
      { type: "document.read", offset: 0, length: 10 },
      { type: "document.status", status: "ready", pageCount: 1 },
      { type: "document.page.put", page: 1, text: "private", truncated: false, method: "embedded" },
    ]) await expect(protectedHandler({ ...message, conversationId: "chat", documentId: value.documentId }, reader)).rejects.toThrow("unauthorized frame");
    expect(test.documents.get(value.documentId)?.status).toBe("stored");
  });
});
