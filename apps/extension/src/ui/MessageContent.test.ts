// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { documentPageLink, MessageContent, messageBlocks, messageParts, messagePreview } from "./MessageContent";

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

describe("readable code and comparison messages", () => {
  it("preserves fenced code exactly, leaves its markup inert and copies only the code", async () => {
    const code = '\tconst html = "<img src=x onerror=alert(1)>";\n  [source](https://example.com/code)\n';
    const writeText = vi.fn(async () => {}), selected = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await act(async () => root.render(createElement("article", { onClick: selected }, createElement(MessageContent, { text: `Example:\n\n\`\`\`javascript\n${code}\`\`\``, onDocumentPage: vi.fn() }))));
    expect(container.querySelector("pre code")?.textContent).toBe(code);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    const button = container.querySelector<HTMLButtonElement>("button")!;
    await act(async () => button.click());
    expect(writeText).toHaveBeenCalledExactlyOnceWith(code);
    expect(selected).not.toHaveBeenCalled();
    expect(button.textContent).toBe("Copied");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Code copied.");
  });

  it("copies through a user-initiated fallback on pages without the Clipboard API", async () => {
    vi.stubGlobal("navigator", {});
    const original = Object.getOwnPropertyDescriptor(document, "execCommand");
    const copy = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: copy });
    try {
      await act(async () => root.render(createElement(MessageContent, { text: "```\nexact text\n```", onDocumentPage: vi.fn() })));
      const button = container.querySelector<HTMLButtonElement>("button")!;
      await act(async () => button.click());
      expect(copy).toHaveBeenCalledExactlyOnceWith("copy");
      expect(container.querySelector("textarea")).toBeNull();
      expect(document.activeElement).toBe(button);
      expect(button.textContent).toBe("Copied");
    } finally { if (original) Object.defineProperty(document, "execCommand", original); else Reflect.deleteProperty(document, "execCommand"); }
  });

  it("reports a copy failure without claiming success or removing the code", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => { throw new Error("Unavailable"); }) } });
    await act(async () => root.render(createElement(MessageContent, { text: "```\nkeep this code\n```", onDocumentPage: vi.fn() })));
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Couldn’t copy");
    expect(container.querySelector("button")?.textContent).toBe("Copy");
    expect(container.querySelector("code")?.textContent).toBe("keep this code\n");
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("renders semantic aligned tables with escaped pipes, safe sources and inert HTML", async () => {
    const open = vi.fn();
    const text = `| City | Note\\|detail | Source |\n| :--- | :---: | ---: |\n| Boston | <img src=x onerror=alert(1)> | ${documentPageLink("forecast", 2, "Forecast.pdf")} |\n| New York | [bad](javascript:alert) | [NOAA](https://weather.gov/) |`;
    await act(async () => root.render(createElement(MessageContent, { text, onDocumentPage: open })));
    expect(container.querySelectorAll("thead th")).toHaveLength(3);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container.querySelectorAll("th")[1].textContent).toBe("Note|detail");
    expect(container.querySelectorAll("th")[1].style.textAlign).toBe("center");
    expect(container.querySelectorAll("th")[2].style.textAlign).toBe("right");
    expect(container.querySelector('th[scope="col"]')).not.toBeNull();
    expect(container.querySelector('[role="region"][aria-label="Table"]')?.getAttribute("tabindex")).toBe("0");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("[bad](javascript:alert)");
    expect(container.querySelectorAll("a")).toHaveLength(2);
    await act(async () => container.querySelector<HTMLAnchorElement>('a[href^="#document-"]')!.click());
    expect(open).toHaveBeenCalledExactlyOnceWith("forecast", 2);
    expect(container.querySelector('a[href="https://weather.gov/"]')?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("preserves malformed tables as text and handles nested or unfinished fences", () => {
    expect(messageBlocks("A | B\n--- | nope\n1 | 2")).toMatchObject([{ kind: "text", text: "A | B\n--- | nope\n1 | 2" }]);
    const nested = messageBlocks("````md\n```js\nvalue\n```\n````");
    expect(nested[0]).toMatchObject({ kind: "code", language: "md", text: "```js\nvalue\n```\n" });
    expect(messageBlocks("```python\n  unfinished\n")[0]).toMatchObject({ kind: "code", text: "  unfinished\n" });
  });

  it("keeps complete code and table blocks across compact previews and excludes code from source chips", async () => {
    const lead = "Here is the example with the original indentation preserved. You can copy it and adjust the final value.";
    const code = '[not a source](https://example.com/code)\n' + "  example();\n".repeat(50);
    const text = `${lead}\n\n\`\`\`js\n${code}\`\`\`\n\n[Reference](https://example.com/reference)`;
    await act(async () => root.render(createElement(MessageContent, { text, compact: true, onDocumentPage: vi.fn() })));
    expect(container.querySelector(":scope > p")?.textContent).toBe(lead);
    expect(container.querySelector("details code")?.textContent).toBe(code);
    expect(container.querySelectorAll(".chat-sources a")).toHaveLength(1);
    expect(container.querySelector(".chat-sources a")?.textContent).toBe("Reference");
    const table = `| Hour | Forecast |\n| --- | --- |\n${"| 7am | A dry morning with light wind |\n".repeat(25)}`;
    const preview = messagePreview(table + "\nAdditional details.");
    expect(messageBlocks(preview.preview).filter((block) => block.kind === "table")).toHaveLength(1);
    expect(messageBlocks(preview.preview).find((block) => block.kind === "table")).toMatchObject({ rows: Array(25).fill(["7am", "A dry morning with light wind"]) });
    expect(preview.rest).toBe("Additional details.");
  });
});
