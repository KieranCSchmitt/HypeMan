import { useEffect, useRef, useState } from "react";
import type { DocumentMetadata } from "../../../../packages/core/src/documents";
import { request } from "../bridge";
import { useToolHandler, useWorkbench, invokeFrameTool } from "./WorkbenchContext";

/** The privileged PDF reader stays in an extension frame on both webpages and the rooftop. */
export function Documents({ conversationId: supplied, active = true }: { conversationId?: string; active?: boolean } = {}) {
  const workbench = useWorkbench();
  const conversationId = supplied || workbench.conversationId;
  const [documents, setDocuments] = useState<DocumentMetadata[]>([]);
  const [current, setCurrent] = useState<string>("");
  const [error, setError] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const channel = useRef(crypto.randomUUID()).current;
  const linkedDocument = useRef((() => {
    const query = new URLSearchParams(location.search);
    return { id: query.get("documentId"), page: Number(query.get("page")), consumed: false };
  })()).current;
  const ready = useRef("");
  const cancellation = useRef(0);
  const operationVersion = useRef(0);
  const waiting = useRef(new Map<string, { resolve: () => void; reject: (error: Error) => void }[]>());
  const scope = useRef(conversationId); scope.current = conversationId;
  const authorization = useRef<{ scope: string; createdAt: number; promise: Promise<string> } | null>(null);
  const getAuthorization = () => {
    const selectedScope = `${conversationId}:${current}`;
    if (authorization.current?.scope !== selectedScope || Date.now() - authorization.current.createdAt > 30 * 60_000) {
      authorization.current = { scope: selectedScope, createdAt: Date.now(), promise: request<{ token: string }>({ type: "frame.grant", tool: "documents", channel, conversationId }).then((value) => value.token) };
    }
    return authorization.current.promise;
  };
  const authorizeFrame = async () => {
    if (!current) return;
    const selectedFrame = frame.current, token = await getAuthorization();
    if (frame.current !== selectedFrame || !selectedFrame) return;
    selectedFrame.contentWindow?.postMessage({ type: "hypeman.frame-authorize", token, channel, conversationId, documentId: current }, chrome.runtime.getURL("").replace(/\/$/, ""));
  };
  const refresh = async () => {
    const list = await request<DocumentMetadata[]>({ type: "document.list", conversationId });
    if (scope.current !== conversationId) return [];
    setDocuments(list);
    return list;
  };
  useEffect(() => {
    let disposed = false;
    setCurrent(""); ready.current = "";
    void refresh().then((list) => {
      if (disposed) return;
      const selected = workbench.selected;
      const id = linkedDocument.id || selected?.artifactId || selected?.id;
      setCurrent(list.some((document) => document.id === id) ? id! : list.at(-1)?.id || "");
    }).catch((error) => setError(error instanceof Error ? error.message : String(error)));
    const uploaded = (event: Event) => {
      const document = (event as CustomEvent<DocumentMetadata>).detail;
      if (document?.conversationId !== conversationId) return;
      void refresh().catch(() => {}); ready.current = ""; setCurrent(document.id);
    };
    window.addEventListener("hypeman.document.uploaded", uploaded);
    window.addEventListener("hypeman.document.attached", uploaded);
    return () => { disposed = true; window.removeEventListener("hypeman.document.uploaded", uploaded); window.removeEventListener("hypeman.document.attached", uploaded);
      for (const list of waiting.current.values()) for (const pending of list) pending.reject(new Error("The conversation changed.")); waiting.current.clear(); };
  }, [conversationId]);
  useEffect(() => {
    if (!current) return;
    const grant = getAuthorization();
    void authorizeFrame().catch((error) => setError(error instanceof Error ? error.message : String(error)));
    return () => { void grant.then((token) => request({ type: "frame.revoke", token })).catch(() => {}); };
  }, [conversationId, current]);
  useEffect(() => {
    const id = workbench.selected?.artifactId || workbench.selected?.id;
    if (["pdf", "document", "documents"].includes(workbench.selected?.kind || "") && id && id !== current) {
      ready.current = ""; setCurrent(id); void refresh().catch(() => {});
    }
  }, [workbench.selected?.id, workbench.selected?.artifactId, workbench.selected?.kind]);
  useEffect(() => {
    const origin = chrome.runtime.getURL("").replace(/\/$/, "");
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin || event.data?.channel !== channel || event.data?.conversationId !== conversationId) return;
      if (event.data.type === "hypeman.escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      if (event.data.type === "hypeman.document.ready" && event.data.documentId === current) {
        ready.current = current;
        for (const pending of waiting.current.get(current) || []) pending.resolve();
        waiting.current.delete(current);
        if (!linkedDocument.consumed && linkedDocument.id === current && Number.isInteger(linkedDocument.page) && linkedDocument.page > 0) {
          linkedDocument.consumed = true;
          void getAuthorization().then((token) => frame.current && invokeFrameTool(frame.current, "documents", "page", { page: linkedDocument.page }, conversationId, token)).catch((error) => setError(error instanceof Error ? error.message : String(error)));
        }
      }
      if (event.data.type === "hypeman.document.selection" && event.data.documentId === current &&
        typeof event.data.quote === "string" && event.data.quote.length <= 4000 && Number.isInteger(event.data.page) && event.data.page > 0) {
        workbench.selectContent({ kind: "pdf", id: current, artifactId: current,
          page: event.data.page, quote: event.data.quote, text: event.data.quote,
          title: documents.find((document) => document.id === current)?.name || "PDF" });
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [channel, conversationId, current, documents, workbench.selectContent]);
  useEffect(() => () => {
    for (const list of waiting.current.values()) for (const pending of list) pending.reject(new Error("The document screen closed."));
    waiting.current.clear();
  }, []);
  useEffect(() => {
    const cancel = () => {
      cancellation.current++;
      for (const list of waiting.current.values()) for (const pending of list) pending.reject(new DOMException("Cancelled", "AbortError"));
      waiting.current.clear();
      const target = frame.current, documentId = ready.current, operation = operationVersion.current;
      if (target && documentId) void getAuthorization().then((token) => {
        if (frame.current === target && ready.current === documentId && operationVersion.current === operation) return invokeFrameTool(target, "documents", "cancel", {}, conversationId, token);
      }).catch(() => {});
    };
    window.addEventListener("hypeman.cancel-tools", cancel);
    if (!active) cancel();
    return () => window.removeEventListener("hypeman.cancel-tools", cancel);
  }, [active, conversationId]);
  useToolHandler("documents", async (operation, args) => {
    operationVersion.current++;
    const version = cancellation.current;
    const check = () => { if (version !== cancellation.current) throw new DOMException("Cancelled", "AbortError"); };
    const list = await refresh();
    check();
    const selectedId = typeof args.documentId === "string" ? args.documentId : typeof args.artifactId === "string" ? args.artifactId : typeof args.id === "string" ? args.id : current || workbench.selected?.artifactId;
    const document = list.find((item) => item.id === selectedId) || (!selectedId ? list.at(-1) : undefined);
    if (!document) return "Drop a PDF into the conversation to open it. PDFs up to 25 MiB stay saved with this chat.";
    if (["remove", "delete"].includes(operation)) {
      await request({ type: "document.remove", conversationId, documentId: document.id });
      await request({ type: "artifact.put", conversationId, kind: "documents", id: document.id, value: null });
      const remaining = await refresh(); ready.current = ""; setCurrent(remaining.at(-1)?.id || ""); workbench.selectContent(null);
      return `Removed ${document.name} from this conversation.`;
    }
    const selected = workbench.selected?.artifactId === document.id || workbench.selected?.id === document.id ? workbench.selected : null;
    const navigationPage = ["page", "open", "show"].includes(operation) && Number.isInteger(args.page) ? Number(args.page) : undefined;
    workbench.selectContent({ ...(selected || {}), kind: "pdf", id: document.id, artifactId: document.id, title: document.name,
      ...(navigationPage ? { page: navigationPage, ...(selected?.page !== navigationPage ? { text: undefined, quote: undefined } : {}) } : {}) });
    if (document.id !== current) { ready.current = ""; setCurrent(document.id); }
    if (["open", "show"].includes(operation) && args.page === undefined) return `Opened ${document.name}.`;
    if (ready.current !== document.id) await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The PDF is still opening. Try again when it is ready.")), 20_000);
      const pending = { resolve: () => { clearTimeout(timer); resolve(); }, reject: (error: Error) => { clearTimeout(timer); reject(error); } };
      waiting.current.set(document.id, [...waiting.current.get(document.id) || [], pending]);
    });
    if (!frame.current) throw new Error("The PDF reader is still opening.");
    check(); const token = await getAuthorization(); check(); await authorizeFrame(); check();
    return invokeFrameTool(frame.current, "documents", operation, args, conversationId, token);
  });
  const parentOrigin = location.origin;
  return <div className="documents-tool" hidden={!active} style={{ height: "100%", minHeight: 420, display: active ? "flex" : "none", flexDirection: "column" }}>
    {documents.length > 1 && <div className="document-collection" aria-label="PDFs in this conversation">
      {documents.map((document) => <a key={document.id} href={`#document-${document.id}`} aria-current={current === document.id ? "page" : undefined}
        onClick={(event) => { event.preventDefault(); ready.current = ""; setCurrent(document.id); workbench.selectContent({ kind: "pdf", id: document.id, artifactId: document.id, title: document.name }); }}>{document.name}</a>)}
    </div>}
    {error && <p role="alert">{error}</p>}
    {current ? <iframe ref={frame} title="PDF document" key={`${conversationId}:${current}`} style={{ flex: 1, width: "100%", minHeight: 420, border: 0 }}
      onLoad={() => { void authorizeFrame().catch((error) => setError(error instanceof Error ? error.message : String(error))); }}
      src={`${chrome.runtime.getURL("documents.html")}?${new URLSearchParams({ conversationId, documentId: current, channel, parentOrigin })}`} />
      : <div className="document-empty"><p>Drop a PDF into the conversation.</p><p>Read, highlight, and ask about any page. Your document stays with this chat.</p></div>}
  </div>;
}
