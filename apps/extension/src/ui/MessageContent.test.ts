// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { documentPageLink, MessageContent, messageParts } from "./MessageContent";

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
describe("durable source links in conversation messages", () => {
  it("opens only the cited document and physical page without selecting the message or navigating away", async () => {
    const open = vi.fn(), selected = vi.fn();
    const text = `A grounded answer.\nSources: ${documentPageLink("pdf-one", 2, "lesson.pdf")}.`;
    await act(async () => root.render(createElement("article", { onClick: selected }, createElement(MessageContent, { text, onDocumentPage: open }))));
    const link = container.querySelector("a")!;
    expect(link.textContent).toBe("lesson.pdf, p. 2"); expect(link.getAttribute("href")).toBe("#document-pdf-one-page-2");
    await act(async () => { expect(link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(false); });
    expect(open).toHaveBeenCalledExactlyOnceWith("pdf-one", 2); expect(selected).not.toHaveBeenCalled();
    // Rehydration receives only the persisted message string, without an ephemeral callback record.
    await act(async () => root.unmount()); root = createRoot(container);
    await act(async () => root.render(createElement(MessageContent, { text: JSON.parse(JSON.stringify(text)), onDocumentPage: open })));
    await act(async () => container.querySelector("a")!.click()); expect(open).toHaveBeenCalledTimes(2);
  });
  it("escapes filenames that contain Markdown syntax and renders HTML as text", async () => {
    const title = "Study [draft](javascript:alert) \\ <img src=x>.pdf";
    const text = documentPageLink("pdf:one", 100_000, title);
    const parts = messageParts(text);
    expect(parts).toEqual([{ kind: "document", documentId: "pdf:one", page: 100_000, label: `${title}, p. 100000` }]);
    await act(async () => root.render(createElement(MessageContent, { text, onDocumentPage: vi.fn() })));
    expect(container.querySelectorAll("a")).toHaveLength(1); expect(container.querySelector("img")).toBeNull(); expect(container.textContent).toBe(`${title}, p. 100000`);
  });
  it.each(["javascript:alert", "data:text/html,attack", "hypeman-tool:settings?permission=input", "hypeman-document:pdf-one?page=0", "hypeman-document:pdf-one?page=100001", "hypeman-document:../secret?page=1", "hypeman-document:pdf-one?page=1&operation=delete", "hypeman-document:pdf-one?page=1#attack", "https://user:secret@example.com/"])("keeps unsafe or unsupported target %s as plain text", (target) => {
    const text = `[Source](${target})`;
    expect(messageParts(text)).toEqual([{ kind: "text", text }]);
  });
  it("allows ordinary HTTP sources while preserving invalid link syntax and surrounding text", async () => {
    const text = "First [bad](javascript:alert), then [source](https://example.com/paper), finally text.";
    await act(async () => root.render(createElement(MessageContent, { text, onDocumentPage: vi.fn() })));
    expect(container.querySelectorAll("a")).toHaveLength(1); expect(container.querySelector("a")?.href).toBe("https://example.com/paper");
    expect(container.querySelector("a")?.rel).toBe("noopener noreferrer"); expect(container.textContent).toBe("First [bad](javascript:alert), then source, finally text.");
  });
});
