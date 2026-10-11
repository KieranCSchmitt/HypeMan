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

export function MessageContent({ text, onDocumentPage }: { text: string; onDocumentPage: (documentId: string, page: number) => void }) {
  const content: ReactNode[] = messageParts(text).map((part, index) => {
    if (part.kind === "text") return part.text;
    if (part.kind === "web") return <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>{part.label}</a>;
    return <a key={index} href={`#document-${encodeURIComponent(part.documentId)}-page-${part.page}`} onAuxClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); onDocumentPage(part.documentId, part.page); }}>{part.label}</a>;
  });
  return <p>{content}</p>;
}
