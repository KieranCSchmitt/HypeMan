import { describe, expect, it, vi } from "vitest";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { startLocalPdf, pdfFailureMessage } from "./pdf-loading";

describe("local PDF loading", () => {
  it("handles missing and incorrect passwords locally, clearing the callback after cancellation", async () => {
    let accept!: (value: PDFDocumentProxy) => void;
    const task = { promise: new Promise<PDFDocumentProxy>((resolve) => { accept = resolve; }), destroy: vi.fn(async () => {}) } as unknown as PDFDocumentLoadingTask;
    let submit!: (password: string) => void;
    const callback = vi.fn((update: (password: string) => void) => { submit = update; });
    const controller = new AbortController();
    const loading = startLocalPdf(() => task, { data: new Uint8Array([1]) }, controller.signal, callback);
    const passwordAccepted = vi.fn();
    task.onPassword(passwordAccepted, 1); submit("wrong");
    task.onPassword(passwordAccepted, 2); submit("correct");
    expect(passwordAccepted.mock.calls).toEqual([["wrong"], ["correct"]]);
    expect(callback.mock.calls.map((call) => call.length)).toEqual([2, 2]);
    accept({ numPages: 2 } as PDFDocumentProxy);
    expect(await loading.promise).toMatchObject({ numPages: 2 });
  });
  it("cancels an encrypted file waiting for a password and ignores late submissions", async () => {
    const task = { promise: new Promise<PDFDocumentProxy>(() => {}), destroy: vi.fn(async () => {}) } as unknown as PDFDocumentLoadingTask;
    let submit!: (password: string) => void;
    const controller = new AbortController(), accepted = vi.fn();
    const loading = startLocalPdf(() => task, {}, controller.signal, (update) => { submit = update; });
    task.onPassword(accepted, 1); controller.abort(); submit("late password");
    await expect(loading.promise).rejects.toMatchObject({ name: "AbortError" });
    expect(accepted).not.toHaveBeenCalled(); expect(task.destroy).toHaveBeenCalledOnce();
  });
  it("reports corrupt PDFs plainly and propagates parser failure", async () => {
    const error = new Error("Invalid PDF structure"); error.name = "InvalidPDFException";
    const task = { promise: Promise.reject(error), destroy: vi.fn(async () => {}) } as unknown as PDFDocumentLoadingTask;
    const loading = startLocalPdf(() => task, {}, new AbortController().signal, () => {});
    await expect(loading.promise).rejects.toBe(error);
    expect(pdfFailureMessage(error)).toContain("damaged");
  });
});
