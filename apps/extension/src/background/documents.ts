import { DOCUMENT_CHUNK_BYTES, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_PAGE_TEXT, type DocumentMetadata, type DocumentPage } from "../../../../packages/core/src/documents";
import { checkDocumentFrame } from "./frame-grants";

type Message = Record<string, unknown>;
export interface DocumentUpload {
  id: string; documentId: string; conversationId: string; name: string; size: number;
  owner: string; received: number; next: number; createdAt: number;
}
export interface StoredDocument extends DocumentMetadata { blob: Blob }
export interface DocumentChunk { id: string; uploadId: string; index: number; bytes: Uint8Array }
/** The service worker owns these transactions; content scripts never use page-origin storage. */
export interface DocumentRepository {
  upload(id: string): Promise<DocumentUpload | undefined>;
  begin(upload: DocumentUpload): Promise<void>;
  chunks(id: string): Promise<DocumentChunk[]>;
  chunk(upload: DocumentUpload, chunk: DocumentChunk): Promise<void>;
  cancel(id: string): Promise<void>;
  complete(document: StoredDocument, uploadId: string): Promise<void>;
  document(id: string): Promise<StoredDocument | undefined>;
  list(conversationId: string): Promise<StoredDocument[]>;
  all?(): Promise<StoredDocument[]>;
  merge?(documents: StoredDocument[]): Promise<number>;
  save(document: StoredDocument): Promise<void>;
  remove(id: string): Promise<void>;
  page(id: string, page: number): Promise<DocumentPage | undefined>;
  savePage(page: DocumentPage): Promise<void>;
}
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value);
const integer = (value: unknown, minimum: number, maximum: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;
const metadata = ({ blob: _blob, ...value }: StoredDocument): DocumentMetadata => value;
const asBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
};
function decode(value: unknown): Uint8Array {
  if (typeof value !== "string" || value.length > Math.ceil(DOCUMENT_CHUNK_BYTES / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new Error("Invalid PDF transfer chunk.");
  const binary = atob(value);
  if (!binary.length || binary.length > DOCUMENT_CHUNK_BYTES) throw new Error("Invalid PDF transfer chunk.");
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function owner(sender: chrome.runtime.MessageSender): string {
  return `${sender.id ?? ""}:${sender.tab?.id ?? "extension"}:${sender.frameId ?? 0}:${sender.documentId ?? sender.url ?? ""}`;
}
function safeFailure(error: unknown): never {
  if (error instanceof DOMException && error.name === "QuotaExceededError")
    throw new Error("There is not enough local storage for this PDF. Your other saved work is safe.");
  throw error;
}

export function createDocumentHandler(repository: DocumentRepository, extensionOrigin?: string,
  authorizeReader = checkDocumentFrame) {
  let pending: Promise<unknown> = Promise.resolve();
  return (message: Message, sender: chrome.runtime.MessageSender): Promise<unknown> | undefined => {
    if (typeof message.type !== "string" || !message.type.startsWith("document.")) return undefined;
    const work = pending.catch(() => undefined).then(async () => {
      const origin = extensionOrigin ?? chrome.runtime.getURL("").replace(/\/$/, "");
      const extensionId = origin.replace("chrome-extension://", "");
      if (sender.id !== extensionId) throw new Error("Unknown PDF caller.");
      const reader = sender.url?.split(/[?#]/)[0] === `${origin}/documents.html`;
      const conversationId = message.conversationId;
      if (!identifier(conversationId)) throw new Error("Choose a conversation for this PDF.");
      const getDocument = async () => {
        if (!identifier(message.documentId)) throw new Error("Choose a saved PDF.");
        const document = await repository.document(message.documentId);
        if (!document || document.conversationId !== conversationId) throw new Error("This PDF is not in this conversation.");
        return document;
      };
      const getUpload = async () => {
        if (!identifier(message.uploadId)) throw new Error("Invalid PDF transfer.");
        const upload = await repository.upload(message.uploadId);
        if (!upload || upload.owner !== owner(sender) || upload.conversationId !== conversationId)
          throw new Error("This PDF transfer belongs to another screen or has expired.");
        if (Date.now() - upload.createdAt > 30 * 60_000) {
          await repository.cancel(upload.id);
          throw new Error("The PDF transfer expired. Drop the file again.");
        }
        return upload;
      };
      switch (message.type) {
        case "document.upload.begin": {
          if (!integer(message.size, 1, MAX_DOCUMENT_BYTES) || typeof message.name !== "string" || !message.name.trim() || message.name.length > 240)
            throw new Error("Choose a PDF up to 25 MiB.");
          const upload: DocumentUpload = {
            id: crypto.randomUUID(), documentId: crypto.randomUUID(), conversationId,
            name: message.name.replace(/[\u0000-\u001f\u007f]/g, "").trim(), size: message.size,
            owner: owner(sender), received: 0, next: 0, createdAt: Date.now(),
          };
          await repository.begin(upload);
          return { uploadId: upload.id, documentId: upload.documentId, chunkBytes: DOCUMENT_CHUNK_BYTES };
        }
        case "document.upload.chunk": {
          const upload = await getUpload();
          if (!integer(message.index, 0, Math.ceil(MAX_DOCUMENT_BYTES / DOCUMENT_CHUNK_BYTES))) throw new Error("Invalid PDF chunk index.");
          const bytes = decode(message.data);
          if (message.index < upload.next) {
            const previous = (await repository.chunks(upload.id)).find((chunk) => chunk.index === message.index);
            if (!previous || asBase64(previous.bytes) !== message.data) throw new Error("A PDF chunk changed during transfer.");
            return { received: upload.received };
          }
          if (message.index !== upload.next || upload.received + bytes.length > upload.size)
            throw new Error("The PDF transfer is incomplete or out of order.");
          await repository.chunk({ ...upload, received: upload.received + bytes.length, next: upload.next + 1 },
            { id: `${upload.id}:${message.index}`, uploadId: upload.id, index: message.index, bytes });
          return { received: upload.received + bytes.length };
        }
        case "document.upload.complete": {
          const upload = await getUpload();
          if (upload.received !== upload.size) throw new Error("The PDF transfer is incomplete.");
          const chunks = (await repository.chunks(upload.id)).sort((a, b) => a.index - b.index);
          const blob = new Blob(chunks.map((chunk) => chunk.bytes as Uint8Array<ArrayBuffer>), { type: "application/pdf" });
          const header = new TextDecoder().decode(await blob.slice(0, 1024).arrayBuffer());
          if (blob.size !== upload.size || !header.includes("%PDF-")) {
            await repository.cancel(upload.id);
            throw new Error("This file does not contain a valid PDF header.");
          }
          const document: StoredDocument = { id: upload.documentId, conversationId, name: upload.name,
            size: blob.size, createdAt: Date.now(), status: "stored", blob };
          await repository.complete(document, upload.id);
          return metadata(document);
        }
        case "document.upload.cancel": {
          if (!identifier(message.uploadId)) throw new Error("Invalid PDF transfer.");
          const upload = await repository.upload(message.uploadId);
          if (upload) {
            if (upload.owner !== owner(sender) || upload.conversationId !== conversationId) throw new Error("This PDF transfer belongs to another screen.");
            await repository.cancel(upload.id);
          }
          return { ok: true };
        }
        case "document.list":
          return (await repository.list(conversationId)).map(metadata);
        case "document.get":
          return metadata(await getDocument());
        case "document.read": {
          if (!reader) throw new Error("PDF bytes are available only inside the document reader.");
          await authorizeReader(message, sender);
          const document = await getDocument();
          if (!integer(message.offset, 0, document.size) || !integer(message.length, 1, DOCUMENT_CHUNK_BYTES))
            throw new Error("Invalid PDF read range.");
          const bytes = new Uint8Array(await document.blob.slice(message.offset, message.offset + message.length).arrayBuffer());
          return { data: asBase64(bytes), offset: message.offset, total: document.size };
        }
        case "document.status": {
          if (!reader) throw new Error("Only the document reader can update PDF metadata.");
          await authorizeReader(message, sender);
          const document = await getDocument();
          if (!["ready", "locked", "error"].includes(String(message.status)) ||
            (message.pageCount !== undefined && !integer(message.pageCount, 1, 100_000))) throw new Error("Invalid PDF status.");
          const next: StoredDocument = { ...document, status: message.status as DocumentMetadata["status"],
            ...(typeof message.pageCount === "number" ? { pageCount: message.pageCount } : {}),
            ...(typeof message.error === "string" ? { error: message.error.slice(0, 300) } : { error: undefined }) };
          await repository.save(next);
          return metadata(next);
        }
        case "document.page.get": {
          const document = await getDocument();
          if (!integer(message.page, 1, document.pageCount ?? 100_000)) throw new Error("Choose a real PDF page.");
          return await repository.page(document.id, message.page) ?? null;
        }
        case "document.page.put": {
          if (!reader) throw new Error("Only the document reader can extract PDF pages.");
          await authorizeReader(message, sender);
          const document = await getDocument();
          if (!integer(message.page, 1, document.pageCount ?? 100_000) || typeof message.text !== "string" ||
            message.text.length > MAX_DOCUMENT_PAGE_TEXT || typeof message.truncated !== "boolean" ||
            !["embedded", "vision"].includes(String(message.method))) throw new Error("Invalid PDF page text.");
          const page: DocumentPage = { documentId: document.id, page: message.page, text: message.text,
            truncated: message.truncated, method: message.method as DocumentPage["method"] };
          await repository.savePage(page);
          return page;
        }
        case "document.remove": {
          const document = await getDocument();
          await repository.remove(document.id);
          return { ok: true };
        }
        default: throw new Error("Unknown PDF request.");
      }
    }).catch(safeFailure);
    pending = work;
    return work;
  };
}

const requestValue = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
export function indexedDocumentRepository(name = "hypeman-documents"): DocumentRepository {
  let opening: Promise<IDBDatabase> | undefined;
  const database = () => opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore("uploads", { keyPath: "id" });
      database.createObjectStore("chunks", { keyPath: "id" }).createIndex("uploadId", "uploadId");
      database.createObjectStore("documents", { keyPath: "id" }).createIndex("conversationId", "conversationId");
      database.createObjectStore("pages", { keyPath: "id" }).createIndex("documentId", "documentId");
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => { opening = undefined; reject(request.error); };
    request.onblocked = () => { opening = undefined; reject(new Error("Close older HypeMan document screens and try again.")); };
  });
  const transaction = async <T>(stores: string[], mode: IDBTransactionMode, run: (transaction: IDBTransaction) => Promise<T>): Promise<T> => {
    const current = (await database()).transaction(stores, mode);
    const completed = new Promise<void>((resolve, reject) => {
      current.oncomplete = () => resolve(); current.onerror = () => reject(current.error); current.onabort = () => reject(current.error ?? new Error("PDF storage was interrupted."));
    });
    try { const value = await run(current); await completed; return value; }
    catch (error) { void completed.catch(() => undefined); try { current.abort(); } catch { /* Already ended. */ } throw error; }
  };
  const removeChunks = async (current: IDBTransaction, uploadId: string) => {
    const store = current.objectStore("chunks");
    for (const key of await requestValue(store.index("uploadId").getAllKeys(uploadId))) store.delete(key);
    current.objectStore("uploads").delete(uploadId);
  };
  return {
    upload: (id) => transaction(["uploads"], "readonly", (current) => requestValue(current.objectStore("uploads").get(id))),
    begin: (upload) => transaction(["uploads"], "readwrite", async (current) => { await requestValue(current.objectStore("uploads").put(upload)); }),
    chunks: (id) => transaction(["chunks"], "readonly", (current) => requestValue(current.objectStore("chunks").index("uploadId").getAll(id))),
    chunk: (upload, chunk) => transaction(["uploads", "chunks"], "readwrite", async (current) => {
      current.objectStore("uploads").put(upload); await requestValue(current.objectStore("chunks").put(chunk));
    }),
    cancel: (id) => transaction(["uploads", "chunks"], "readwrite", (current) => removeChunks(current, id)),
    complete: (document, uploadId) => transaction(["documents", "uploads", "chunks"], "readwrite", async (current) => {
      current.objectStore("documents").put(document); await removeChunks(current, uploadId);
    }),
    document: (id) => transaction(["documents"], "readonly", (current) => requestValue(current.objectStore("documents").get(id))),
    list: (conversationId) => transaction(["documents"], "readonly", (current) => requestValue(current.objectStore("documents").index("conversationId").getAll(conversationId))),
    all: () => transaction(["documents"], "readonly", current => requestValue(current.objectStore("documents").getAll())),
    merge: (documents) => transaction(["documents"], "readwrite", async current => {
      const store = current.objectStore("documents"); let added = 0;
      for (const document of documents) if (!(await requestValue(store.get(document.id)))) { await requestValue(store.put(document)); added++; }
      return added;
    }),
    save: (document) => transaction(["documents"], "readwrite", async (current) => { await requestValue(current.objectStore("documents").put(document)); }),
    remove: (id) => transaction(["documents", "pages"], "readwrite", async (current) => {
      current.objectStore("documents").delete(id);
      const pages = current.objectStore("pages");
      for (const key of await requestValue(pages.index("documentId").getAllKeys(id))) pages.delete(key);
    }),
    page: (id, page) => transaction(["pages"], "readonly", async (current) => {
      const value = await requestValue(current.objectStore("pages").get(`${id}:${page}`));
      if (!value) return undefined;
      const { id: _id, ...result } = value; return result as DocumentPage;
    }),
    savePage: (page) => transaction(["pages"], "readwrite", async (current) => { await requestValue(current.objectStore("pages").put({ ...page, id: `${page.documentId}:${page.page}` })); }),
  };
}
export const documentRepository = indexedDocumentRepository();
let handler: ReturnType<typeof createDocumentHandler> | undefined;
export function handleDocumentMessage(message: Message, sender: chrome.runtime.MessageSender): Promise<unknown> | undefined {
  if (typeof message.type !== "string" || !message.type.startsWith("document.")) return undefined;
  handler ??= createDocumentHandler(documentRepository);
  return handler(message, sender);
}
