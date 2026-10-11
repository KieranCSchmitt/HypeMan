import type { ReactNode } from "react";

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

/** Deliberately recognizes source links only; HTML and other Markdown remain ordinary text. */
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
  return { preview: text.slice(0, split).trimEnd(), rest: text.slice(split).trimStart() };
}

export function MessageContent({ text, compact = false, onDocumentPage }: { text: string; compact?: boolean; onDocumentPage: (documentId: string, page: number) => void }) {
  const renderParts = (parts: MessagePart[]): ReactNode[] => parts.map((part, index) => {
    if (part.kind === "text") return part.text;
    if (part.kind === "web") return <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>{part.label}</a>;
    return <a key={index} href={`#document-${encodeURIComponent(part.documentId)}-page-${part.page}`} onAuxClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); onDocumentPage(part.documentId, part.page); }}>{part.label}</a>;
  });
  const { preview, rest } = compact ? messagePreview(text) : { preview: text, rest: "" };
  if (!rest) return <p>{renderParts(messageParts(text))}</p>;
  const visibleSources = new Set(messageParts(preview).filter(part => part.kind !== "text").map(part => part.kind === "web" ? part.href : `${part.documentId}:${part.page}`));
  const hiddenSources = messageParts(rest).filter(part => {
    if (part.kind === "text") return false;
    const key = part.kind === "web" ? part.href : `${part.documentId}:${part.page}`;
    if (visibleSources.has(key)) return false;
    visibleSources.add(key); return true;
  });
  return <><p>{renderParts(messageParts(preview))}</p>
    {!!hiddenSources.length && <div className="chat-sources" aria-label="Sources">{hiddenSources.map((part, index) => <span key={index}>{renderParts([part])}</span>)}</div>}
    <details className="chat-more"><summary>More</summary><p>{renderParts(messageParts(rest))}</p></details>
  </>;
}
