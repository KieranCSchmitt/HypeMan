/** Page understanding is deliberately DOM-only. Nothing leaves the tab until a task asks. */
import type { PageSnapshot, PageTarget as Target, VideoState } from "@core";
export type { PageSnapshot, PageTarget as Target } from "@core";
const INTERACTIVE =
  'a[href],button,input,textarea,select,[role="button"],[role="link"],[role="textbox"],[role="option"],[role="checkbox"],[contenteditable="true"],video';
const PRIVATE =
  /password|passcode|\bpin\b|pin.?code|\botp\b|one.?time|verification|security.?code|auth.?code|credit.?card|card.?number|cvv|cvc|social.?security|\bssn\b|payment|\biban\b/i;
const compact = (value: string | null | undefined, limit = 250) =>
  (value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
const FAILED_NOTICE =
  /\b(error|invalid|incorrect|wrong|failed|try again|not quite|not correct|not right|not complete|not registered|not saved|unsuccessful)\b/i;
const SUCCESS_NOTICE =
  /\b(success(?:ful|fully)?|complete(?:d)?|confirmed|registered|saved|correct|submitted|sent|delivered|deleted|removed|published|reserved|enrolled|that['’]s right|well done|nice work|you got it)\b/i;
// Unlabelled feedback must start with a short result, not merely mention one in
// an article, question, or instruction. ARIA notices retain broader support for
// ordinary task results such as "Registration confirmed".
const ORDINARY_FEEDBACK =
  /^(?:(?:oops|sorry)[!.,:]?\s+)?(?:(?:incorrect|correct|wrong)(?: (?:answer|response|solution))?|not (?:quite|correct|right)|(?:please\s+)?try again|that(?:['’]s| is) (?:right|correct|not (?:right|correct))|well done|nice work|you got it)(?=$|[!.,:;?\-–—]|\s+(?:please|try|check|you|your|remember|take|give|start|let['’]s)\b)/i;
const FEEDBACK_EXCLUDED =
  'script,style,noscript,template,input,textarea,select,[contenteditable],[data-private],[inert],[aria-live="off"],button,a,[role="button"],[role="link"],[role="menu"],[role="menubar"],[role="navigation"],nav,header,footer,blockquote,q,pre,code';
const FEEDBACK_BLOCKS = /^(DIV|P|SECTION|ARTICLE|LI|UL|OL|FORM|TABLE|DL|DD|DT|HEADER|FOOTER|NAV)$/;

function feedbackNotices(document: Document, excludedHost?: Element): string[] {
  const notices = new Set<string>();
  const captured = new Set<Element>();
  const eligible = (element: Element) =>
    !excludedHost?.contains(element) &&
    !element.closest(FEEDBACK_EXCLUDED) &&
    visible(element);
  const textOf = (element: Element, limit: number) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let text = "";
    let node: Node | null;
    let examined = 0;
    while ((node = walker.nextNode()) && examined++ < 128) {
      const parent = node.parentElement;
      if (!parent || !eligible(parent)) continue;
      text += `${node.textContent ?? ""} `;
      if (text.length > limit) break;
    }
    return compact(text, limit + 1);
  };
  let semanticCount = 0;
  for (const element of document.querySelectorAll('[role="alert"],[role="status"],[aria-live]')) {
    if (semanticCount++ === 250 || notices.size === 30) break;
    if (!eligible(element) || element.getAttribute("aria-live") === "off") continue;
    const text = textOf(element, 300);
    if (text && text.length <= 300) {
      notices.add(text);
      captured.add(element);
    }
  }
  // Bound both traversal and text size. Prefer the smallest feedback block over
  // page containers so headings, lesson prose, and controls cannot become hints.
  const root = document.body ?? document.documentElement;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let element: Element | null;
  let examined = 0;
  while ((element = walker.nextNode() as Element | null) && examined++ < 4000 && notices.size < 30) {
    if (!/^(DIV|P|SPAN|OUTPUT|STRONG|B|EM|SMALL|LABEL|LI|DD)$/.test(element.tagName)) continue;
    let alreadyCaptured = false;
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (captured.has(ancestor)) {
        alreadyCaptured = true;
        break;
      }
    }
    if (alreadyCaptured) continue;
    if (Array.from(element.children).some((child) => FEEDBACK_BLOCKS.test(child.tagName))) continue;
    if (!eligible(element)) continue;
    const text = textOf(element, 180);
    if (!text || text.length > 180 || !ORDINARY_FEEDBACK.test(text)) continue;
    const context = element.parentElement?.closest("p,div,label,li,dd,output");
    if (
      context &&
      Array.from(context.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && compact(node.textContent),
      ) &&
      !ORDINARY_FEEDBACK.test(textOf(context, 180))
    )
      continue;
    // A semantic notice may wrap several inline text nodes; keep its complete
    // message rather than duplicating partial children such as "Incorrect".
    notices.add(text);
    captured.add(element);
  }
  return Array.from(notices);
}

export function privateField(element: Element): boolean {
  const input = element as HTMLInputElement;
  const metadata = [
    input.type,
    input.name,
    input.id,
    element.getAttribute("autocomplete"),
    element.getAttribute("aria-label"),
    element.getAttribute("placeholder"),
    ...Array.from(input.labels ?? []).map((label) => label.textContent),
  ].join(" ");
  return (
    input.type === "password" ||
    /^(cc-|one-time-code|current-password|new-password)/i.test(
      element.getAttribute("autocomplete") ?? "",
    ) ||
    PRIVATE.test(metadata)
  );
}

function nameOf(element: Element): string {
  const labelled = (element.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "")
    .join(" ");
  const input = element as HTMLInputElement;
  return compact(
    element.getAttribute("aria-label") ||
      labelled ||
      Array.from(input.labels ?? [])
        .map((label) => label.textContent)
        .join(" ") ||
      element.textContent ||
      element.getAttribute("placeholder") ||
      element.getAttribute("title") ||
      (element.tagName === "INPUT" && ["submit", "button", "reset"].includes(input.type)
        ? input.value
        : "") ||
      element.tagName.toLowerCase(),
  );
}
function roleOf(element: Element): string {
  const explicit = element.getAttribute("role");
  if (explicit) return explicit;
  const tag = element.tagName;
  if (tag === "A") return "link";
  if (tag === "BUTTON") return "button";
  if (tag === "SELECT") return "combobox";
  if (tag === "VIDEO") return "video";
  if (tag === "INPUT") {
    const type = (element as HTMLInputElement).type;
    if (["checkbox", "radio"].includes(type)) return type;
    if (["submit", "button", "reset", "image"].includes(type)) return "button";
  }
  return "textbox";
}
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
    )
      return false;
  }
  // DOM-only test environments have no layout. In a browser, require a rendered box.
  return (
    !element.ownerDocument.documentElement.getClientRects().length ||
    !!element.getClientRects().length
  );
}
export function sameTarget(before: Target, after: Target | undefined): boolean {
  return (
    !!after &&
    before.id === after.id &&
    before.name === after.name &&
    before.role === after.role &&
    before.href === after.href &&
    before.sensitive === after.sensitive &&
    before.disabled === after.disabled &&
    before.value === after.value
  );
}

export class PageObserver {
  private ids = new WeakMap<Element, string>();
  private nodes = new Map<string, WeakRef<Element>>();
  private nextId = 1;
  private observer: MutationObserver | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private removers: Array<() => void> = [];
  private lastUrl = "";
  private listener: (() => void) | null = null;
  private revision = 0;
  constructor(
    private document: Document = window.document,
    private excludedHost?: Element,
  ) {}

  resolve(id: string): Element | null {
    const element = this.nodes.get(id)?.deref();
    if (element?.isConnected) return element;
    this.nodes.delete(id);
    return null;
  }
  targetAt(x: number, y: number): Element | null {
    const element = this.document.elementFromPoint?.(x, y);
    if (!element || this.excludedHost?.contains(element)) return null;
    return element.closest(INTERACTIVE) ?? element;
  }
  private idFor(element: Element): string {
    let id = this.ids.get(element);
    if (!id) {
      id = `e${this.nextId++}`;
      this.ids.set(element, id);
    }
    this.nodes.set(id, new WeakRef(element));
    return id;
  }
  describe(element: Element): Target {
    const rect = element.getBoundingClientRect();
    const sensitive = privateField(element);
    const input = element as HTMLInputElement;
    return {
      id: this.idFor(element),
      name: nameOf(element),
      role: roleOf(element),
      tag: element.tagName.toLowerCase(),
      disabled: !!input.disabled || element.getAttribute("aria-disabled") === "true",
      sensitive,
      ...(!sensitive &&
      (element.tagName === "INPUT" ||
        element.tagName === "TEXTAREA" ||
        element.tagName === "SELECT")
        ? { value: compact(input.value, 500) }
        : {}),
      ...(element instanceof HTMLAnchorElement ? { href: element.href } : {}),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  }
  snapshot(): PageSnapshot {
    const document = this.document;
    for (const [id, ref] of this.nodes) if (!ref.deref()?.isConnected) this.nodes.delete(id);
    const elements: Target[] = [];
    for (const element of document.querySelectorAll(INTERACTIVE)) {
      if (this.excludedHost?.contains(element) || !visible(element)) continue;
      elements.push(this.describe(element));
      if (elements.length === 180) break;
    }
    const body = document.body ?? document.documentElement;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (
          !parent ||
          this.excludedHost?.contains(parent) ||
          parent.closest("script,style,noscript,textarea,input,[contenteditable],[data-private]") ||
          !visible(parent)
        )
          return NodeFilter.FILTER_REJECT;
        return compact(node.textContent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    let text = "";
    let node: Node | null;
    while ((node = walker.nextNode()) && text.length < 9000)
      text += `${compact(node.textContent, 1000)}\n`;
    let inaccessible = 0;
    const frames = Array.from(document.querySelectorAll("iframe"));
    for (const frame of frames) {
      try {
        if (!frame.contentDocument?.documentElement) inaccessible++;
      } catch {
        inaccessible++;
      }
    }
    const notices = feedbackNotices(document, this.excludedHost);
    const failed = (text: string) => FAILED_NOTICE.test(text);
    const video = this.videoState();
    return {
      revision: this.revision,
      ...(video ? { video } : {}),
      url: document.location.href,
      title: compact(document.title, 300),
      headings: Array.from(document.querySelectorAll("h1,h2,h3"))
        .filter((el) => !this.excludedHost?.contains(el) && visible(el))
        .slice(0, 20)
        .map((el) => compact(el.textContent)),
      text: text.slice(0, 9000),
      elements,
      errors: notices.filter(failed),
      successes: notices.filter(
        (text) =>
          !failed(text) &&
          SUCCESS_NOTICE.test(text),
      ),
      selection: compact(document.getSelection()?.toString(), 1200),
      frames: { count: frames.length, inaccessible },
      capturedAt: Date.now(),
    };
  }
  videoState(): VideoState | null {
    const document = this.document;
    const video = Array.from(document.querySelectorAll("video")).find(
      (el) => !this.excludedHost?.contains(el) && visible(el),
    );
    const segments = video
      ? Array.from(video.textTracks)
          .flatMap((track) =>
            Array.from(track.cues ?? [])
              .slice(0, 300)
              .map((cue) => ({
                start: cue.startTime,
                end: cue.endTime,
                text: compact((cue as VTTCue).text, 1000),
              })),
          )
          .filter((cue) => cue.text)
      : [];
    const chapters = video
      ? Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="t="],a[href*="start="]'))
          .flatMap((anchor) => {
            const text = compact(anchor.textContent, 160);
            if (!/^\d{1,2}:\d{2}(?::\d{2})?\b/.test(text)) return [];
            try {
              const url = new URL(anchor.href),
                here = new URL(document.location.href);
              if (
                url.origin !== here.origin ||
                url.pathname !== here.pathname ||
                url.searchParams.get("v") !== here.searchParams.get("v")
              )
                return [];
              const time = url.searchParams.get("t") ?? url.searchParams.get("start") ?? "";
              const start = /^\d+s?$/.test(time) ? parseInt(time) : NaN;
              return Number.isFinite(start)
                ? [{ start, title: text.replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*/, "") || text }]
                : [];
            } catch {
              return [];
            }
          })
          .slice(0, 80)
      : [];
    return video
      ? {
          id: this.idFor(video),
          title: compact(document.title, 300),
          time: video.currentTime,
          duration: Number.isFinite(video.duration) ? video.duration : 0,
          paused: video.paused,
          rate: video.playbackRate,
          segments,
          chapters,
        }
      : null;
  }
  watch(listener: () => void): void {
    this.stop();
    this.listener = listener;
    this.lastUrl = this.document.location.href;
    const queue = () => {
      this.revision++;
      if (this.debounce) return;
      this.debounce = setTimeout(() => {
        this.debounce = null;
        this.listener?.();
      }, 250);
    };
    this.observer = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            record.target !== this.excludedHost && !this.excludedHost?.contains(record.target),
        )
      )
        queue();
    });
    this.observer.observe(this.document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "disabled",
        "aria-disabled",
        "aria-invalid",
        "aria-label",
        "href",
        "hidden",
        "aria-hidden",
        "role",
        "aria-live",
        "class",
        "style",
      ],
    });
    const checkUrl = () => {
      if (this.document.location.href !== this.lastUrl) {
        this.lastUrl = this.document.location.href;
        queue();
      }
    };
    const view = this.document.defaultView!;
    for (const event of ["popstate", "hashchange"]) {
      view.addEventListener(event, checkUrl);
      this.removers.push(() => view.removeEventListener(event, checkUrl));
    }
    for (const event of ["play", "pause", "seeked", "ratechange", "timeupdate", "loadedmetadata"]) {
      this.document.addEventListener(event, queue, true);
      this.removers.push(() => this.document.removeEventListener(event, queue, true));
    }
    this.poll = setInterval(checkUrl, 500);
    queue();
  }
  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.debounce) clearTimeout(this.debounce);
    if (this.poll) clearInterval(this.poll);
    this.debounce = null;
    this.poll = null;
    this.listener = null;
    for (const remove of this.removers.splice(0)) remove();
  }
}
