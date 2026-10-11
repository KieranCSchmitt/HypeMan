// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DOCUMENT_CHUNK_BYTES, MAX_DOCUMENT_BYTES, type DocumentMetadata } from "../../../../packages/core/src/documents";
import { request } from "../bridge";
import { readDocument, uploadDocument } from "./document-client";
vi.mock("../bridge", () => ({ request: vi.fn() }));
const rpc = vi.mocked(request);
const metadata: DocumentMetadata = { id: "pdf-one", conversationId: "chat-one", name: "notes.pdf", size: 20, createdAt: 1, status: "stored" };
function file(length = 20, name = "notes.pdf", content = "%PDF-1.7\nhello") {
  const bytes = new Uint8Array(length); bytes.set(new TextEncoder().encode(content).subarray(0, length));
  return { name, type: "application/pdf", size: length, slice: (start = 0, end = length) => ({ arrayBuffer: async () => bytes.slice(start, end).buffer }) } as File;
}
beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(async (message) => {
    if (message.type === "document.upload.begin") return { uploadId: "transfer-one", documentId: metadata.id };
    if (message.type === "document.upload.complete") return metadata;
    return { ok: true };
  });
});
describe("PDF attachment bridge", () => {
  it("sends bounded base64 chunks and saves a document artifact without sending File objects", async () => {
    const uploaded = vi.fn(); window.addEventListener("hypeman.document.uploaded", uploaded);
    const result = await uploadDocument(file(DOCUMENT_CHUNK_BYTES + 10), metadata.conversationId);
    expect(result).toEqual(metadata);
    const chunks = rpc.mock.calls.filter(([message]) => message.type === "document.upload.chunk");
    expect(chunks).toHaveLength(2); expect(typeof chunks[0][0].data).toBe("string");
    expect(atob(chunks[0][0].data as string)).toHaveLength(DOCUMENT_CHUNK_BYTES);
    expect(atob(chunks[1][0].data as string)).toHaveLength(10);
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ type: "artifact.put", id: metadata.id, kind: "documents" }));
    expect(uploaded).toHaveBeenCalledOnce(); window.removeEventListener("hypeman.document.uploaded", uploaded);
  });
  it("rejects non-PDF headers and oversize files before starting a transfer", async () => {
    await expect(uploadDocument(file(20, "notes.pdf", "not a PDF"), "chat-one")).rejects.toThrow("PDF header");
    await expect(uploadDocument(file(1, "notes.txt"), "chat-one")).rejects.toThrow("PDF up to");
    await expect(uploadDocument({ name: "huge.pdf", type: "application/pdf", size: MAX_DOCUMENT_BYTES + 1 } as File, "chat-one")).rejects.toThrow("25 MiB");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("cancels the owned transfer when Stop arrives after a chunk", async () => {
    const controller = new AbortController();
    rpc.mockImplementation(async (message) => {
      if (message.type === "document.upload.begin") return { uploadId: "transfer-one", documentId: metadata.id };
      if (message.type === "document.upload.chunk") controller.abort();
      return { ok: true };
    });
    await expect(uploadDocument(file(DOCUMENT_CHUNK_BYTES + 10), "chat-one", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ type: "document.upload.cancel", conversationId: "chat-one", uploadId: "transfer-one" }));
    expect(rpc.mock.calls.some(([message]) => message.type === "document.upload.complete")).toBe(false);
  });
  it("removes a late finalized attachment after cancellation rather than leaking an orphan PDF", async () => {
    const controller = new AbortController();
    rpc.mockImplementation(async (message) => {
      if (message.type === "document.upload.begin") return { uploadId: "transfer-one", documentId: metadata.id };
      if (message.type === "document.upload.complete") { controller.abort(); return metadata; }
      return { ok: true };
    });
    await expect(uploadDocument(file(), "chat-one", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ type: "document.remove", documentId: metadata.id }));
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ type: "artifact.put", value: null }));
  });
  it("rejects truncated reader transfers and honors reader cancellation", async () => {
    rpc.mockResolvedValue({ data: btoa("short"), total: metadata.size, offset: 0 });
    await expect(readDocument(metadata)).rejects.toThrow("read completely");
    const controller = new AbortController(); controller.abort(); rpc.mockClear();
    await expect(readDocument(metadata, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
