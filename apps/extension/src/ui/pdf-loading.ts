import type { PDFDocumentLoadingTask, PDFDocumentProxy, DocumentInitParameters } from "pdfjs-dist/types/src/display/api";

/** Password callbacks and bytes are local only; this module has no gateway or storage dependency. */
export function startLocalPdf(
  factory: (options: DocumentInitParameters) => PDFDocumentLoadingTask,
  options: DocumentInitParameters,
  signal: AbortSignal,
  onPassword: (submit: (password: string) => void, reason: number) => void,
) {
  signal.throwIfAborted();
  const task = factory(options);
  let rejectAbort!: (error: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const abort = () => {
    rejectAbort(new DOMException("Cancelled", "AbortError"));
    void task.destroy().catch(() => {});
  };
  task.onPassword = (submit: (password: string) => void, reason: number) => {
    if (!signal.aborted) onPassword((password) => { if (!signal.aborted) submit(password); }, reason);
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const promise: Promise<PDFDocumentProxy> = Promise.race([task.promise, aborted]).finally(() => signal.removeEventListener("abort", abort));
  return { promise, destroy: () => task.destroy() };
}

export function pdfFailureMessage(error: unknown): string {
  if (error instanceof Error && /InvalidPDF|Invalid PDF|MissingPDF|Missing PDF/i.test(`${error.name} ${error.message}`))
    return "This PDF is damaged or could not be parsed. Try another copy.";
  return error instanceof Error ? error.message : "The PDF could not be opened.";
}
