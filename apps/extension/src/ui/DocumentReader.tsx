import "../pdf-compat";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { getDocument, GlobalWorkerOptions, TextLayer, PasswordResponses, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import { MAX_DOCUMENT_CONTEXT_TEXT, MAX_DOCUMENT_PAGE_TEXT, type DocumentMetadata, type DocumentPage, type DocumentAnalysisReply, type DocumentAnalysisRequest } from "../../../../packages/core/src/documents";
import { request, type BridgeMessage } from "../bridge";
import { readDocument } from "./document-client";
import { useToolHandler } from "./WorkbenchContext";
import { startLocalPdf, pdfFailureMessage } from "./pdf-loading";
import { documentPageLink } from "./MessageContent";
import { ToolButton } from "./common";

GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("assets/pdfjs/worker.mjs");
const parameters = new URLSearchParams(location.search);
const conversationId = parameters.get("conversationId") || "default";
const documentId = parameters.get("documentId") || "";
const channel = parameters.get("channel") || "";
const parentOrigin = parameters.get("parentOrigin") || "";
function relay(type: string, value: Record<string, unknown> = {}) {
  if (!channel || !/^(?:https?:\/\/|chrome-extension:\/\/)/.test(parentOrigin)) return;
  parent.postMessage({ ...value, type: `hypeman.document.${type}`, conversationId, documentId, channel }, parentOrigin);
}
function textOf(items: unknown[]) {
  let text = "";
  for (const raw of items) {
    if (!raw || typeof raw !== "object" || !("str" in raw) || typeof raw.str !== "string") continue;
    const item = raw as { str: string; hasEOL?: boolean };
    text += `${item.str}${item.hasEOL ? "\n" : " "}`;
  }
  return text.trim();
}
function pageRange(args: Record<string, unknown>, current: number, count: number, summarize: boolean): number[] {
  let pages: number[];
  if (Array.isArray(args.pages)) pages = args.pages as number[];
  else if (typeof args.fromPage === "number" || typeof args.toPage === "number") {
    const from = Number(args.fromPage ?? current), to = Number(args.toPage ?? from);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from > to || to - from >= 20) throw new Error("Choose a range of at most 20 PDF pages.");
    pages = Array.from({ length: to - from + 1 }, (_, index) => from + index);
  } else if (typeof args.page === "number") pages = [args.page];
  else pages = summarize ? Array.from({ length: Math.min(20, count) }, (_, index) => index + 1) : [current];
  if (!pages.length || pages.length > 20 || pages.some((page) => !Number.isInteger(page) || page < 1 || page > count)) throw new Error(`Choose pages between 1 and ${count}.`);
  return [...new Set(pages)];
}
export function DocumentReader() {
  const [metadata, setMetadata] = useState<DocumentMetadata | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [password, setPassword] = useState("");
  const [locked, setLocked] = useState<"required" | "incorrect" | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Opening your PDF…");
  const [analysis, setAnalysis] = useState<DocumentAnalysisReply | null>(null);
  const [width, setWidth] = useState(680);
  const [zoom, setZoom] = useState(1);
  const [authorized, setAuthorized] = useState(false);
  const frameToken = useRef("");
  const pageHost = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const unlock = useRef<((password: string) => void) | null>(null);
  const processing = useRef<AbortController | null>(null);
  const lifetime = useRef(new AbortController());
  const pageCache = useRef(new Map<number, DocumentPage>());
  const extraction = useRef(new Map<number, Promise<DocumentPage>>());
  const readerRequest = <T,>(message: BridgeMessage, signal?: AbortSignal) => request<T>({ ...message,
    frameToken: frameToken.current, frameChannel: channel }, signal);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== parent || event.origin !== parentOrigin || event.data?.type !== "hypeman.frame-authorize" ||
        event.data.channel !== channel || event.data.conversationId !== conversationId || event.data.documentId !== documentId ||
        typeof event.data.token !== "string") return;
      const token = event.data.token;
      void request({ type: "frame.check", tool: "documents", channel, conversationId, token }).then(() => {
        frameToken.current = token; setAuthorized(true);
      }).catch(() => setError("Reopen this PDF from your conversation to read it."));
    };
    const cancel = () => processing.current?.abort();
    window.addEventListener("message", receive); window.addEventListener("hypeman.cancel-tools", cancel);
    return () => { window.removeEventListener("message", receive); window.removeEventListener("hypeman.cancel-tools", cancel); };
  }, []);
  const show = useCallback((next: number) => {
    if (!pdf || !Number.isInteger(next) || next < 1 || next > pdf.numPages) throw new Error(`Choose a page between 1 and ${pdf?.numPages || 1}.`);
    setPage(next); setPageInput(String(next));
    history.replaceState(null, "", `${location.pathname}${location.search}#page=${next}`);
    pageHost.current?.scrollIntoView({ block: "start" });
  }, [pdf]);
  useEffect(() => {
    if (!authorized) return;
    const controller = new AbortController(); lifetime.current = controller;
    let loading: ReturnType<typeof startLocalPdf> | undefined;
    void (async () => {
      const document = await readerRequest<DocumentMetadata>({ type: "document.get", conversationId, documentId }, controller.signal);
      setMetadata(document);
      const bytes = await readDocument(document, controller.signal, { token: frameToken.current, channel });
      controller.signal.throwIfAborted();
      loading = startLocalPdf(getDocument, { data: bytes, cMapUrl: chrome.runtime.getURL("assets/pdfjs/cmaps/"),
        standardFontDataUrl: chrome.runtime.getURL("assets/pdfjs/standard_fonts/"), wasmUrl: chrome.runtime.getURL("assets/pdfjs/wasm/"),
        enableXfa: false, maxImageSize: 16_000_000, canvasMaxAreaInBytes: 64_000_000,
        useWasm: false, isImageDecoderSupported: false }, controller.signal, (updatePassword, reason) => {
        if (controller.signal.aborted) return;
        unlock.current = updatePassword;
        setLocked(reason === PasswordResponses.INCORRECT_PASSWORD ? "incorrect" : "required");
        setStatus("This PDF needs its password. It stays on this screen.");
        void readerRequest({ type: "document.status", conversationId, documentId, status: "locked" }).catch(() => {});
        relay("ready", { status: "locked" });
      });
      const parsed = await loading.promise;
      controller.signal.throwIfAborted();
      setPdf(parsed); setLocked(null); unlock.current = null;
      const next = await readerRequest<DocumentMetadata>({ type: "document.status", conversationId, documentId, status: "ready", pageCount: parsed.numPages }, controller.signal);
      setMetadata(next); setStatus(`${parsed.numPages} ${parsed.numPages === 1 ? "page" : "pages"} · Select text to discuss it in chat.`);
      relay("ready", { status: "ready", pageCount: parsed.numPages });
      const saved = await request<{ analysis?: DocumentAnalysisReply; currentPage?: number } | null>({ type: "artifact.get", conversationId, kind: "documents", id: documentId }, controller.signal).catch(() => null);
      if (!controller.signal.aborted) {
        if (saved?.analysis) setAnalysis(saved.analysis);
        const previous = Number(new URLSearchParams(location.hash.slice(1)).get("page") || saved?.currentPage || 1);
        if (Number.isInteger(previous) && previous >= 1 && previous <= parsed.numPages) { setPage(previous); setPageInput(String(previous)); }
      }
    })().catch((error: unknown) => {
      if (controller.signal.aborted) return;
      const text = pdfFailureMessage(error);
      setError(text); setStatus(""); relay("ready", { status: "error" });
      void readerRequest({ type: "document.status", conversationId, documentId, status: "error", error: text }).catch(() => {});
    });
    return () => { controller.abort(); processing.current?.abort(); unlock.current = null; void loading?.destroy(); };
  }, [authorized]);
  useEffect(() => {
    const host = pageHost.current;
    if (!host) return;
    const resize = new ResizeObserver(() => setWidth(Math.max(240, Math.min(1100, host.clientWidth - 24))));
    resize.observe(host); return () => resize.disconnect();
  }, [pdf]);
  const extract = async (number: number): Promise<DocumentPage> => {
    if (!pdf) throw new Error(locked ? "Enter this PDF's password in the document pane first." : "The PDF is still opening.");
    const cached = pageCache.current.get(number); if (cached) return cached;
    const active = extraction.current.get(number); if (active) return active;
    const promise = (async () => {
      const stored = await request<DocumentPage | null>({ type: "document.page.get", conversationId, documentId, page: number }, lifetime.current.signal);
      if (stored) { pageCache.current.set(number, stored); return stored; }
      const source = await pdf.getPage(number);
      const content = await source.getTextContent();
      lifetime.current.signal.throwIfAborted();
      const text = textOf(content.items);
      const value: DocumentPage = { documentId, page: number, text: text.slice(0, MAX_DOCUMENT_PAGE_TEXT),
        truncated: text.length > MAX_DOCUMENT_PAGE_TEXT, method: "embedded" };
      await readerRequest({ type: "document.page.put", conversationId, ...value }, lifetime.current.signal);
      pageCache.current.set(number, value); return value;
    })();
    extraction.current.set(number, promise);
    try { return await promise; } finally { extraction.current.delete(number); }
  };
  useEffect(() => {
    if (!pdf || !canvas.current || !layer.current) return;
    let disposed = false, render: RenderTask | undefined, textLayer: TextLayer | undefined;
    const selectedCanvas = canvas.current, selectedLayer = layer.current;
    void (async () => {
      const source = await pdf.getPage(page);
      if (disposed) return;
      const base = source.getViewport({ scale: 1 });
      const viewport = source.getViewport({ scale: Math.min(width * zoom / base.width, 2400 / Math.max(base.width, base.height)) });
      const ratio = Math.min(devicePixelRatio || 1, 2);
      selectedCanvas.width = Math.ceil(viewport.width * ratio); selectedCanvas.height = Math.ceil(viewport.height * ratio);
      selectedCanvas.style.width = `${viewport.width}px`; selectedCanvas.style.height = `${viewport.height}px`;
      selectedLayer.replaceChildren(); selectedLayer.style.setProperty("--total-scale-factor", String(viewport.scale));
      selectedLayer.parentElement!.style.width = `${viewport.width}px`; selectedLayer.parentElement!.style.height = `${viewport.height}px`;
      render = source.render({ canvas: selectedCanvas, canvasContext: selectedCanvas.getContext("2d")!, viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      await render.promise;
      if (disposed) return;
      const content = await source.getTextContent();
      if (disposed) return;
      textLayer = new TextLayer({ textContentSource: content, container: selectedLayer, viewport });
      await textLayer.render();
      if (!disposed) void extract(page).catch(() => {});
    })().catch((error) => { if (!disposed && error?.name !== "RenderingCancelledException") setError("This page could not be rendered. You can try another page."); });
    return () => { disposed = true; render?.cancel(); textLayer?.cancel(); };
  }, [pdf, page, width, zoom]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const selected = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const selection = document.getSelection();
        if (!selection || selection.isCollapsed || !layer.current?.contains(selection.anchorNode) || !layer.current.contains(selection.focusNode)) return;
        const quote = selection.toString().trim().slice(0, 4000);
        if (quote) relay("selection", { page, quote });
      }, 450);
    };
    document.addEventListener("selectionchange", selected);
    return () => { clearTimeout(timer); document.removeEventListener("selectionchange", selected); };
  }, [page]);
  useToolHandler("documents", async (operation, args) => {
    if (["cancel", "stop"].includes(operation)) { processing.current?.abort(); return "PDF analysis stopped. Your document is still saved."; }
    if (["export", "download"].includes(operation)) {
      if (!metadata) throw new Error("The document is still opening.");
      const bytes = await readDocument(metadata, lifetime.current.signal, { token: frameToken.current, channel });
      const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = metadata.name; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return `Downloaded the original ${metadata.name}.`;
    }
    if (!pdf) throw new Error(locked ? "Enter the PDF password in the document pane. It will stay local." : error || "The PDF is still opening.");
    if (["open", "show", "page", "navigate"].includes(operation)) { show(Number(args.page ?? page)); return `Showing ${metadata?.name}, page ${Number(args.page ?? page)} of ${pdf.numPages}.`; }
    if (!["analyze", "summarize", "explain", "inspect", "read"].includes(operation)) throw new Error("Ask to show a page, summarize, or analyze this PDF.");
    const selected = args.selected && typeof args.selected === "object" ? args.selected as Record<string, unknown> : undefined;
    const targetedSelection = selected && (selected.artifactId === documentId || selected.id === documentId) ? selected : undefined;
    const effectiveArgs = { ...args, ...(operation !== "summarize" && args.page === undefined && Number.isInteger(targetedSelection?.page) ? { page: targetedSelection!.page } : {}) };
    processing.current?.abort(); const controller = new AbortController(); processing.current = controller;
    const aborted = () => controller.abort(); lifetime.current.signal.addEventListener("abort", aborted, { once: true });
    try {
      const numbers = pageRange(effectiveArgs, page, pdf.numPages, operation === "summarize");
      setStatus(`Reading ${numbers.length === 1 ? `page ${numbers[0]}` : `pages ${numbers[0]}–${numbers.at(-1)}`}…`);
      const pages: DocumentAnalysisRequest["pages"] = []; let remaining = MAX_DOCUMENT_CONTEXT_TEXT;
      for (const number of numbers) {
        controller.signal.throwIfAborted();
        const source = await extract(number); const text = source.text.slice(0, remaining);
        pages.push({ page: number, text, truncated: source.truncated || text.length < source.text.length }); remaining -= text.length;
      }
      let image: string | undefined, imagePage: number | undefined;
      if (args.visual === true || operation === "inspect") {
        imagePage = Number(effectiveArgs.page ?? numbers[0]);
        const source = await pdf.getPage(imagePage); controller.signal.throwIfAborted();
        const base = source.getViewport({ scale: 1 });
        const viewport = source.getViewport({ scale: Math.min(2, 1400 / Math.max(base.width, base.height)) });
        const imageCanvas = document.createElement("canvas"); imageCanvas.width = Math.ceil(viewport.width); imageCanvas.height = Math.ceil(viewport.height);
        const render = source.render({ canvas: imageCanvas, canvasContext: imageCanvas.getContext("2d")!, viewport });
        const cancel = () => render.cancel(); controller.signal.addEventListener("abort", cancel, { once: true });
        try { await render.promise; } finally { controller.signal.removeEventListener("abort", cancel); }
        image = imageCanvas.toDataURL("image/jpeg", .8);
      }
      controller.signal.throwIfAborted();
      if (!pages.some((page) => page.text.trim()) && !image) return "These PDF pages appear scanned or have no extractable text. Ask me to inspect a specific page visually; the original PDF remains saved locally.";
      const question = typeof args.question === "string" ? args.question : typeof args.message === "string" ? args.message : operation === "summarize" ? "Summarize these supplied PDF pages. State clearly if they are only part of the document." : "Explain the supplied PDF page and its main ideas.";
      const selection = targetedSelection && typeof targetedSelection.quote === "string" && numbers.includes(Number(targetedSelection.page))
        ? { page: Number(targetedSelection.page), quote: targetedSelection.quote.slice(0, 4000) } : undefined;
      const result = await request<DocumentAnalysisReply>({ type: "api", path: "/api/document", body: {
        artifactId: documentId, title: metadata?.name || "PDF", pageCount: pdf.numPages, question, pages,
        ...(image ? { image, imagePage } : {}), ...(selection ? { selection } : {}),
      } }, controller.signal);
      controller.signal.throwIfAborted(); setAnalysis(result);
      await request({ type: "artifact.put", conversationId, kind: "documents", id: documentId, value: { ...metadata, analysis: result, currentPage: page } }, controller.signal);
      relay("analysis", { result });
      return `${result.text}\nSources: ${result.citations.map((citation) => documentPageLink(documentId, citation.page, metadata?.name || "PDF")).join("; ") || "supplied pages"}.${result.partial ? `\nPartial coverage: reviewed pages ${result.coveredPages.join(", ")} of ${pdf.numPages}.` : ""}`;
    } finally {
      lifetime.current.signal.removeEventListener("abort", aborted);
      if (processing.current === controller) { processing.current = null; setStatus(`Page ${page} of ${pdf.numPages} · Select text to discuss it in chat.`); }
    }
  });
  const submitPassword = (event: FormEvent) => { event.preventDefault(); const value = password; setPassword(""); setLocked(null); setStatus("Unlocking locally…"); unlock.current?.(value); };
  return <main className="pdf-reader" onKeyDown={(event) => {
    if ((event.target as Element).closest("input,textarea") || !pdf) return;
    if (["PageDown", "ArrowRight"].includes(event.key) && page < pdf.numPages) { event.preventDefault(); show(page + 1); }
    if (["PageUp", "ArrowLeft"].includes(event.key) && page > 1) { event.preventDefault(); show(page - 1); }
  }}>
    {(!pdf || /^(Reading|Unlocking)/.test(status)) && <p className="tool-status" role="status">{locked ? "Password required" : status}</p>}
    {error && <p className="pdf-error" role="alert">{error}</p>}
    {locked && <form className="pdf-password tool-form" onSubmit={submitPassword}><label>{locked === "incorrect" ? "Incorrect password" : "Password"}
      <input type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} aria-label="PDF password" autoFocus required /></label>
      <button type="submit" title="Unlock locally. Your password is never saved or sent.">Unlock</button></form>}
    {pdf && <><nav className="pdf-page-navigation" aria-label="PDF pages">
      <ToolButton icon="back" label="Previous page" disabled={page <= 1} onClick={() => show(page - 1)} />
      <form onSubmit={(event) => { event.preventDefault(); try { show(Number(pageInput)); setError(""); } catch (error) { setError((error as Error).message); } }}>
        <label><input type="number" min="1" max={pdf.numPages} aria-label="PDF page number" value={pageInput} onChange={(event) => setPageInput(event.target.value)} /> / {pdf.numPages}</label>
      </form>
      <button type="button" className="tool-icon-button" aria-label="Next page" title="Next page" disabled={page >= pdf.numPages} onClick={() => show(page + 1)}>→</button>
      <button type="button" className="tool-icon-button" aria-label="Zoom out" title="Zoom out" disabled={zoom <= .5} onClick={() => setZoom(Math.max(.5, zoom - .25))}>−</button><button type="button" aria-label="Reset zoom" title="Reset zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><ToolButton icon="plus" label="Zoom in" disabled={zoom >= 2} onClick={() => setZoom(Math.min(2, zoom + .25))} />
    </nav><div ref={pageHost} className="pdf-page-host"><div className="pdf-page" data-pdf-page={page}><canvas ref={canvas} aria-label={`PDF page ${page}`} /><div ref={layer} className="textLayer" /></div></div></>}
    {analysis && <section className="pdf-analysis" aria-label="PDF answer"><p>{analysis.text}</p>
      <p className="pdf-coverage">{analysis.partial ? "Partial · " : ""}p. {analysis.coveredPages.join(", ")} / {metadata?.pageCount}</p>
      <div className="pdf-citations" aria-label="Page citations">{analysis.citations.map((citation, index) => <a key={index} href={`#page=${citation.page}`}
        onClick={(event) => { event.preventDefault(); show(citation.page); }} title={citation.quote}>p. {citation.page}</a>)}</div>
    </section>}
  </main>;
}
