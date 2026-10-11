import { useState, type ReactNode } from "react";

type MessagePart = { kind: "text"; text: string } | { kind: "document"; label: string; documentId: string; page: number } |
  { kind: "web"; label: string; href: string };
const DOCUMENT_ID = /^[a-zA-Z0-9_.:-]{1,160}$/;
const DOCUMENT_TARGET = /^hypeman-document:([a-zA-Z0-9_.:-]{1,160})\?page=([1-9]\d{0,5})$/;
const unescapeLabel = (label: string) => label.replace(/\\([\\\[\]])/g, "$1");

/** Persist a bounded source reference as text, without allowing filenames to introduce markup. */
export function documentPageLink(documentId: string, page: number, title: string) {
  if (!DOCUMENT_ID.test(documentId) || !Number.isInteger(page) || page < 1 || page > 100_000)
    throw new Error("Invalid PDF page reference.");
  const label = `${title.slice(0, 240).replace(/[\u0000-\u001f\u007f]/g, " ")}, p. ${page}`.replace(/[\\\[\]]/g, "\\$&");
  return `[${label}](hypeman-document:${documentId}?page=${page})`;
}

/** Deliberately recognizes source links only; HTML remains ordinary text. */
export function messageParts(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  const links = /\[((?:\\[\\\[\]]|[^\]\\\n]){1,600})\]\(([^()\s]{1,800})\)/g;
  let offset = 0;
  for (const match of text.matchAll(links)) {
    const target = match[2], document = target.match(DOCUMENT_TARGET);
    let part: MessagePart | undefined;
    if (document && Number(document[2]) <= 100_000) part = { kind: "document", label: unescapeLabel(match[1]), documentId: document[1], page: Number(document[2]) };
    else {
      try {
        const url = new URL(target);
        if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password)
          part = { kind: "web", label: unescapeLabel(match[1]), href: url.href };
      } catch { /* Unrecognized links stay visible as their original text. */ }
    }
    if (!part) continue;
    if (match.index > offset) parts.push({ kind: "text", text: text.slice(offset, match.index) });
    parts.push(part); offset = match.index + match[0].length;
  }
  if (offset < text.length || !parts.length) parts.push({ kind: "text", text: text.slice(offset) });
  return parts;
}

type MessageBlock = { kind: "text"; text: string; start: number; end: number } |
  { kind: "code"; text: string; language: string; start: number; end: number } |
  { kind: "table"; headers: string[]; rows: string[][]; align: Array<"left" | "center" | "right">; start: number; end: number };

function tableCells(line: string): string[] | null {
  const cells: string[] = [];
  let cell = "", ticks = 0, separators = 0;
  const value = line.trim();
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === "\\" && index + 1 < value.length) { cell += character + value[++index]; continue; }
    if (character === "`") {
      let length = 1;
      while (value[index + length] === "`") length++;
      ticks = ticks === length ? 0 : ticks || length;
      cell += value.slice(index, index + length); index += length - 1; continue;
    }
    if (character === "|" && !ticks) { cells.push(cell); cell = ""; separators++; }
    else cell += character;
  }
  if (!separators) return null;
  cells.push(cell);
  if (!cells[0] && value.startsWith("|")) cells.shift();
  if (!cells.at(-1) && value.endsWith("|")) cells.pop();
  return cells.map((item) => item.trim().replace(/\\\|/g, "|"));
}

/** A small text-only Markdown subset: fenced code and pipe tables, never HTML. */
export function messageBlocks(text: string): MessageBlock[] {
  const rawLines = text.split("\n"), lines = rawLines.map((line) => line.replace(/\r$/, ""));
  const offsets: number[] = [];
  let offset = 0;
  for (const line of rawLines) { offsets.push(offset); offset += line.length + 1; }
  const blocks: MessageBlock[] = [];
  let plainStart = 0;
  const flush = (end: number) => { if (text.slice(plainStart, end).trim()) blocks.push({ kind: "text", text: text.slice(plainStart, end), start: plainStart, end }); };
  for (let index = 0; index < lines.length; index++) {
    const fence = lines[index].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      flush(offsets[index]);
      const closing = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}[ \\t]*$`);
      let end = index + 1;
      while (end < lines.length && !closing.test(lines[end])) end++;
      const bodyStart = Math.min(text.length, offsets[index] + rawLines[index].length + 1);
      const blockEnd = end < lines.length ? offsets[end] + rawLines[end].length : text.length;
      blocks.push({ kind: "code", text: text.slice(bodyStart, end < lines.length ? offsets[end] : text.length),
        language: fence[2].trim().split(/\s+/)[0].slice(0, 40), start: offsets[index], end: blockEnd });
      plainStart = blockEnd; index = end; continue;
    }
    const headers = tableCells(lines[index]), separators = tableCells(lines[index + 1] ?? "");
    if (!headers?.length || !separators || separators.length !== headers.length || !separators.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    flush(offsets[index]);
    const rows: string[][] = [];
    let end = index + 2;
    for (; end < lines.length; end++) {
      const row = tableCells(lines[end]);
      if (!row || row.length !== headers.length) break;
      rows.push(row);
    }
    const blockEnd = offsets[end - 1] + rawLines[end - 1].length;
    blocks.push({ kind: "table", headers, rows, align: separators.map((cell) => cell.endsWith(":") ? cell.startsWith(":") ? "center" : "right" : "left"), start: offsets[index], end: blockEnd });
    plainStart = blockEnd; index = end - 1;
  }
  flush(text.length);
  return blocks;
}

function sourceParts(text: string): MessagePart[] {
  return messageBlocks(text).flatMap((block) => block.kind === "code" ? [] : messageParts(block.kind === "text" ? block.text : [block.headers, ...block.rows].flat().join("\n")));
}

async function copyCode(text: string, button: HTMLButtonElement): Promise<void> {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; } } catch { /* Older or restricted pages can still support a user-initiated copy. */ }
  const document = button.ownerDocument, field = document.createElement("textarea");
  field.value = text; field.readOnly = true; field.setAttribute("aria-hidden", "true");
  field.style.cssText = "position:fixed;left:-10000px;top:0;opacity:0";
  button.parentElement!.append(field);
  try { field.select(); if (!document.execCommand?.("copy")) throw new Error("Copy unavailable"); }
  finally { field.remove(); button.focus({ preventScroll: true }); }
}

function CodeBlock({ text, language }: { text: string; language: string }) {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  return <section className="message-code" aria-label="Code block">
    <div className="message-code-header"><span>{language || "Code"}</span><button type="button" aria-label="Copy code" disabled={status === "copying"}
      onClick={(event) => { event.stopPropagation(); const button = event.currentTarget; setStatus("copying"); void copyCode(text, button).then(() => setStatus("copied"), () => setStatus("failed")); }}>{status === "copying" ? "Copying…" : status === "copied" ? "Copied" : "Copy"}</button></div>
    <pre tabIndex={0} aria-label={language ? `${language} code` : "Code"}><code>{text}</code></pre>
    <span className="message-copy-status" role="status">{status === "failed" ? "Couldn’t copy. Select the code to copy it." : status === "copied" ? "Code copied." : ""}</span>
  </section>;
}

/** Keep the answer visible while making a long explanation an optional expansion. */
export function messagePreview(text: string): { preview: string; rest: string } {
  if (text.length <= 600) return { preview: text, rest: "" };
  const paragraph = text.indexOf("\n\n");
  let split = paragraph >= 80 && paragraph <= 400 ? paragraph : text.lastIndexOf(" ", 350);
  if (split < 80) split = 350;
  // Do not cut a source reference in half.
  for (const match of text.matchAll(/\[((?:\\[\\\[\]]|[^\]\\\n]){1,600})\]\(([^()\s]{1,800})\)/g)) {
    if (match.index < split && match.index + match[0].length > split) split = match.index >= 80 ? match.index : match.index + match[0].length;
  }
  // A code fence or table must stay whole when an explanation is collapsed.
  for (const block of messageBlocks(text)) {
    if (block.kind !== "text" && block.start < split && block.end > split) split = block.start >= 80 ? block.start : block.end;
  }
  return { preview: text.slice(0, split).trimEnd(), rest: text.slice(split).trimStart() };
}

export function MessageContent({ text, compact = false, onDocumentPage }: { text: string; compact?: boolean; onDocumentPage: (documentId: string, page: number) => void }) {
  const renderParts = (parts: MessagePart[]): ReactNode[] => parts.map((part, index) => {
    if (part.kind === "text") return part.text;
    if (part.kind === "web") return <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>{part.label}</a>;
    return <a key={index} href={`#document-${encodeURIComponent(part.documentId)}-page-${part.page}`} onAuxClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); onDocumentPage(part.documentId, part.page); }}>{part.label}</a>;
  });
  const renderBlocks = (value: string) => messageBlocks(value).map((block, index) => {
    if (block.kind === "text") return <p key={index}>{renderParts(messageParts(block.text))}</p>;
    if (block.kind === "code") return <CodeBlock key={`${index}:${block.start}`} text={block.text} language={block.language} />;
    return <div key={index} className="message-table" role="region" aria-label="Table" tabIndex={0}><table><thead><tr>{block.headers.map((cell, column) => <th key={column} scope="col" style={{ textAlign: block.align[column] }}>{renderParts(messageParts(cell))}</th>)}</tr></thead>
      <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, column) => <td key={column} style={{ textAlign: block.align[column] }}>{renderParts(messageParts(cell))}</td>)}</tr>)}</tbody></table></div>;
  });
  const { preview, rest } = compact ? messagePreview(text) : { preview: text, rest: "" };
  if (!rest) return <>{renderBlocks(text)}</>;
  const visibleSources = new Set(sourceParts(preview).filter(part => part.kind !== "text").map(part => part.kind === "web" ? part.href : `${part.documentId}:${part.page}`));
  const hiddenSources = sourceParts(rest).filter(part => {
    if (part.kind === "text") return false;
    const key = part.kind === "web" ? part.href : `${part.documentId}:${part.page}`;
    if (visibleSources.has(key)) return false;
    visibleSources.add(key); return true;
  });
  return <>{renderBlocks(preview)}
    {!!hiddenSources.length && <div className="chat-sources" aria-label="Sources">{hiddenSources.map((part, index) => <span key={index}>{renderParts([part])}</span>)}</div>}
    <details className="chat-more"><summary>More</summary>{renderBlocks(rest)}</details>
  </>;
}
