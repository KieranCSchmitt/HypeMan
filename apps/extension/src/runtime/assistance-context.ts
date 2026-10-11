import type { PageSnapshot } from "@core";
import { privateField } from "./page";

export interface PracticeContext {
  key: string;
  page: PageSnapshot;
  concept: string;
}
export interface SelectionContext extends PracticeContext {
  selected: string;
}

const EXCLUDED =
  'script,style,noscript,template,[hidden],[aria-hidden="true"],[data-private],[inert],textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]';
const NON_CONTENT =
  'button,[role="button"],nav,header,footer,[role="navigation"],[role="menu"],[role="menubar"],[role="alert"],[role="status"],[aria-live],output,progress,meter,time,[role="timer"],[data-timer],[data-clock],.timer,.clock';
const FEEDBACK =
  /^(?:(?:oops|sorry)[!.,:]?\s+)?(?:incorrect|correct|wrong(?: answer)?|not quite|not correct|not right|try again|that(?:['’]s| is) (?:right|correct)|well done|nice work|you got it)(?=$|[!.,:;]|\s+(?:please|try|check|you|your|remember)\b)/i;
const QUESTION =
  /\b(?:solve|simplify|calculate|evaluate|find|compute|factor|expand|complete|identify|choose|select|write|explain|convert|what|which|why|how|who|where|when|question)\b/i;
const ASSESSMENT = /\b(?:quiz|practice|exercise|assessment|test|problem|question|homework|worksheet)\b/i;
const ANSWER = /\b(?:answer|solution|response)\b/i;
const ORDINARY_FORM =
  /\b(?:search|sign ?in|log ?in|newsletter|subscribe|contact us|shipping|billing|checkout|reset password|create account|username|full name|first name|last name|email|e-mail|phone|address)\b/i;
const compact = (value: string | null | undefined, limit = 1200) =>
  (value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);

function visible(element: Element): boolean {
  if (element.closest('[hidden],[aria-hidden="true"],script,style,noscript')) return false;
  if (typeof element.checkVisibility === "function")
    return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const view = element.ownerDocument.defaultView;
  for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = view?.getComputedStyle(ancestor);
    if (
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      style?.visibility === "collapse" ||
      style?.opacity === "0"
    ) return false;
  }
  return !element.ownerDocument.documentElement.getClientRects().length || !!element.getClientRects().length;
}

function forbidden(element: Element, excludedHost?: Element): boolean {
  if (excludedHost?.contains(element) || element.closest(EXCLUDED)) return true;
  const label = element.closest("label") as HTMLLabelElement | null;
  return !!label?.control && privateField(label.control);
}

/** Bounded DOM text, never input values. Feedback and clocks cannot change a question key. */
function textOf(scope: Element, excludedHost?: Element, answer?: Element, limit = 1200, inline = false): string {
  if (forbidden(scope, excludedHost) || scope.matches(NON_CONTENT) ||
    FEEDBACK.test(compact(scope.textContent, 301)) || !visible(scope)) return "";
  const document = scope.ownerDocument;
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        if (element === answer) return NodeFilter.FILTER_ACCEPT;
        if (
          element.matches("input") || forbidden(element, excludedHost) ||
          element.matches(NON_CONTENT) || !visible(element) ||
          FEEDBACK.test(compact(element.textContent, 301))
        ) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_SKIP;
      }
      return FEEDBACK.test(compact(node.textContent, 301))
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  let text = "";
  let node: Node | null;
  let examined = 0;
  while ((node = walker.nextNode()) && examined++ < 500 && text.length <= limit) {
    text += node === answer ? " [answer] " : `${node.textContent ?? ""}${inline ? "" : " "}`;
  }
  return compact(text, limit);
}

function headingsFor(document: Document, node: Node, excludedHost?: Element): string[] {
  const headings: string[] = [];
  let nearest = "";
  for (const heading of Array.from(document.querySelectorAll("h1,h2,h3")).slice(0, 64)) {
    if (forbidden(heading, excludedHost) || !visible(heading)) continue;
    const text = textOf(heading, excludedHost, undefined, 160);
    if (!text) continue;
    if (heading.tagName === "H1" && !headings.length) headings.push(text);
    if (heading === node || heading.contains(node) ||
      (heading.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) nearest = text;
  }
  if (nearest && !headings.includes(nearest)) headings.push(nearest);
  return headings.slice(0, 2);
}

function snapshot(page: PageSnapshot, text: string, headings: string[], selection = ""): PageSnapshot {
  // Intentionally do not spread the original snapshot: it can contain unrelated
  // page text, field values, target IDs, video captions, and feedback.
  return {
    url: page.url,
    title: compact(page.title, 200),
    headings,
    text,
    selection,
    elements: [],
    errors: [],
    successes: [],
    frames: { count: 0, inaccessible: 0 },
    capturedAt: page.capturedAt,
    revision: 0,
  };
}

function mathQuestion(text: string): boolean {
  // Both a quantity/variable and an operator are needed. Dates, product prices,
  // and ordinary prose beside a field should not spend an inference request.
  return /(?:\d|\b[a-z]\b)/i.test(text) &&
    /(?:[=÷×]|\d\s*[+*/−-]\s*(?:\d|\[answer\])|\b[a-z]\s*[+−-]\s*\d)/i.test(text);
}

function questionText(text: string): boolean {
  const meaningful = text.replace(/\[answer\]/g, "").replace(/\b(?:your|enter|type|answer|response|solution)\b/gi, "").trim();
  return meaningful.length >= 4 && (mathQuestion(text) || (meaningful.length >= 12 && QUESTION.test(text)));
}

function answerMetadata(field: HTMLInputElement): string {
  return compact([
    field.getAttribute("aria-label"), field.getAttribute("placeholder"), field.name,
    ...Array.from(field.labels ?? []).map((label) => label.textContent),
    ...(field.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean)
      .map((id) => field.ownerDocument.getElementById(id)?.textContent),
  ].join(" "), 350);
}

/** Only recognizable, visible practice questions are eligible for speculative help. */
export function getPracticeContext(
  document: Document,
  excludedHost: Element | undefined,
  page: PageSnapshot,
): PracticeContext | null {
  for (const field of Array.from(document.querySelectorAll<HTMLInputElement>("input")).slice(0, 160)) {
    if (!/^(?:text|number)$/.test(field.type) || field.disabled || field.readOnly ||
      field.getRootNode() !== document || forbidden(field, excludedHost) || privateField(field) ||
      field.closest('nav,header,footer,[role="search"],[role="navigation"]') || !visible(field)) continue;
    const rect = field.getBoundingClientRect();
    if (document.documentElement.getClientRects().length &&
      (rect.bottom <= 0 || rect.right <= 0 || rect.top >= (document.defaultView?.innerHeight ?? Infinity) ||
        rect.left >= (document.defaultView?.innerWidth ?? Infinity))) continue;
    const metadata = answerMetadata(field);
    if (ORDINARY_FORM.test(metadata)) continue;
    const headings = headingsFor(document, field, excludedHost);
    const assessment = ASSESSMENT.test(headings.join(" "));
    let scope: Element | null = field.parentElement;
    for (let depth = 0; scope && scope !== document.documentElement && depth < 6; depth++, scope = scope.parentElement) {
      if (forbidden(scope, excludedHost)) break;
      const options: string[] = [];
      // Prefer a nearby dedicated prompt over a whole form/main container. This
      // keeps counters, unrelated notes, and later result messages out of the key.
      if (!scope.matches("body,form,main,article,section") && scope.querySelectorAll("input").length <= 4)
        options.push(textOf(scope, excludedHost, field, 1000));
      const siblingStarts = depth === 0
        ? [field.previousElementSibling, scope.previousElementSibling]
        : [scope.previousElementSibling];
      for (let sibling of siblingStarts) {
        for (let index = 0; sibling && index < 3; index++, sibling = sibling.previousElementSibling) {
          if (sibling.matches("form,input,textarea,select,button,nav,header,footer")) continue;
          options.push(textOf(sibling, excludedHost, undefined, 1000));
        }
      }
      if (scope !== document.body) options.push(textOf(scope, excludedHost, field, 1000));
      const question = options.find((text) => questionText(text) &&
        !ORDINARY_FORM.test(text) &&
        (mathQuestion(text) || ANSWER.test(metadata) || assessment || ASSESSMENT.test(text)));
      if (!question) continue;
      const concept = headings.at(-1) || compact(page.title, 160) || "Practice question";
      return {
        key: JSON.stringify(["practice", page.url, headings, question]),
        concept,
        page: snapshot(page, question, headings),
      };
    }
  }
  return null;
}

/** A selected word/phrase is explicit interest, but only ordinary top-frame text is readable. */
export function getSelectionContext(
  document: Document,
  excludedHost: Element | undefined,
  page: PageSnapshot,
): SelectionContext | null {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const root = range.commonAncestorContainer;
  if (range.startContainer.ownerDocument !== document || range.endContainer.ownerDocument !== document ||
    root.getRootNode() !== document) return null;
  const protectedContent = (node: Node) => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    if (!element || excludedHost?.contains(element) || element.closest(
      'script,style,noscript,template,[data-private],[inert],input,textarea,select,button,[role="button"],[role="textbox"],[contenteditable]:not([contenteditable="false"])',
    )) return true;
    const label = element.closest("label") as HTMLLabelElement | null;
    return !!label?.control && privateField(label.control);
  };
  const rootElement = root.nodeType === Node.ELEMENT_NODE ? root as Element : root.parentElement!;
  if (protectedContent(range.startContainer) || protectedContent(range.endContainer) ||
    protectedContent(root) || !visible(rootElement)) return null;
  // Endpoints alone are insufficient: a range can cross a private/editable span.
  // Hidden public decoration is skipped, rather than cancelling a real selection.
  // Reconstruct from readable text nodes so its hidden text cannot enter the payload.
  let unsafe = false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
      if (protectedContent(node)) {
        unsafe = true;
        return NodeFilter.FILTER_ACCEPT;
      }
      const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
      if (!element || !visible(element)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let raw = "";
  const append = (node: Node) => {
    const text = node.textContent ?? "";
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : text.length;
    raw += text.slice(start, end);
  };
  if (root.nodeType === Node.TEXT_NODE && visible(root.parentElement!)) append(root);
  let node: Node | null;
  let examined = 0;
  while ((node = walker.nextNode())) {
    if (++examined > 1000 || raw.length > 2400 || unsafe) return null;
    if (node.nodeType === Node.TEXT_NODE) append(node);
  }
  if (unsafe) return null;
  const selected = compact(raw, 601);
  if (selected.length < 2 || selected.length > 600 || raw.length > 2400) return null;
  const element = rootElement;
  const scope = element.closest("p,li,dd,dt,blockquote,figcaption,h1,h2,h3,article,section,main") ?? element;
  const nearby = textOf(scope, excludedHost, undefined, 6000, true);
  const offset = nearby.indexOf(selected);
  const padding = Math.floor((1200 - selected.length) / 2);
  const start = Math.max(0, offset - padding);
  const context = offset >= 0 ? nearby.slice(start, start + 1200).trim() : selected;
  const headings = headingsFor(document, range.startContainer, excludedHost);
  return {
    key: JSON.stringify(["selection", page.url, headings, selected, context]),
    selected,
    concept: headings.at(-1) || compact(page.title, 160) || "Selected text",
    page: snapshot(page, context, headings, selected),
  };
}
