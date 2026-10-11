import { DOCUMENT_CHUNK_BYTES, MAX_DOCUMENT_BYTES, type DocumentMetadata } from "../../../../packages/core/src/documents";
import { request } from "../bridge";

const cancelled = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
};
function encode(bytes: Uint8Array): string {
  let value = "";
  for (let start = 0; start < bytes.length; start += 8192) value += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(value);
}
/** Chrome messages serialize JSON, so File/Blob/ArrayBuffer must never cross this bridge directly. */
export async function uploadDocument(file: File, conversationId: string, signal?: AbortSignal): Promise<DocumentMetadata> {
  cancelled(signal);
  if (file.size < 1 || file.size > MAX_DOCUMENT_BYTES || (file.type && file.type !== "application/pdf") || !/\.pdf$/i.test(file.name))
    throw new Error("Drop a PDF up to 25 MiB.");
  const header = new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer());
  cancelled(signal);
  if (!header.includes("%PDF-")) throw new Error("This file does not contain a PDF header.");
  // Await the short begin call even on cancellation, so its upload ID can always be cleaned up.
  const begun = await request<{ uploadId: string; documentId: string }>({ type: "document.upload.begin", conversationId, name: file.name, size: file.size });
  let completed = false;
  let saved: DocumentMetadata | undefined;
  try {
    for (let offset = 0, index = 0; offset < file.size; offset += DOCUMENT_CHUNK_BYTES, index++) {
      cancelled(signal);
      const bytes = new Uint8Array(await file.slice(offset, offset + DOCUMENT_CHUNK_BYTES).arrayBuffer());
      cancelled(signal);
      await request({ type: "document.upload.chunk", conversationId, uploadId: begun.uploadId, index, data: encode(bytes) }, signal);
    }
    cancelled(signal);
    // Let finalization return its ID even after Stop, so a cancelled attachment can be removed.
    const document = await request<DocumentMetadata>({ type: "document.upload.complete", conversationId, uploadId: begun.uploadId });
    completed = true;
    saved = document;
    cancelled(signal);
    await request({ type: "artifact.put", conversationId, kind: "documents", id: document.id, value: document });
    cancelled(signal);
    window.dispatchEvent(new CustomEvent("hypeman.document.uploaded", { detail: document }));
    return document;
  } catch (error) {
    if (signal?.aborted && saved) {
      await request({ type: "document.remove", conversationId, documentId: saved.id }).catch(() => undefined);
      await request({ type: "artifact.put", conversationId, kind: "documents", id: saved.id, value: null }).catch(() => undefined);
    }
    throw error;
  } finally {
    if (!completed) await request({ type: "document.upload.cancel", conversationId, uploadId: begun.uploadId }).catch(() => undefined);
  }
}

/** Only the extension-origin reader can fetch binary data. Reads are bounded below the bridge cap. */
export async function readDocument(document: DocumentMetadata, signal?: AbortSignal,
  frame?: { token: string; channel: string }): Promise<Uint8Array> {
  const output = new Uint8Array(document.size);
  for (let offset = 0; offset < document.size; offset += DOCUMENT_CHUNK_BYTES) {
    cancelled(signal);
    const result = await request<{ data: string; offset: number; total: number }>({ type: "document.read",
      conversationId: document.conversationId, documentId: document.id, offset, length: DOCUMENT_CHUNK_BYTES,
      ...(frame ? { frameToken: frame.token, frameChannel: frame.channel } : {}) }, signal);
    const chunk = atob(result.data);
    if (result.offset !== offset || result.total !== document.size || chunk.length !== Math.min(DOCUMENT_CHUNK_BYTES, document.size - offset))
      throw new Error("The saved PDF could not be read completely. Drop the file again.");
    for (let i = 0; i < chunk.length; i++) output[offset + i] = chunk.charCodeAt(i);
  }
  cancelled(signal);
  return output;
}
