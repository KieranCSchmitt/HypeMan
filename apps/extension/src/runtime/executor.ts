import type { Action, ActionResult, PageSnapshot, SessionHandoff } from "@core";
import { delay, check } from "./async";
import { PageObserver, privateField, sameTarget } from "./page";
import type { RuntimeApi } from "./types";
import type { Highlight } from "./overlay";
import { actionTarget } from "./policy";
import { pageState } from "./reliability";
export interface ExecuteContext {
  api: RuntimeApi;
  observer: PageObserver;
  highlight: Highlight;
  page: PageSnapshot;
  signal: AbortSignal;
  allowed: () => boolean;
  reducedMotion: boolean;
  trustedInput: boolean;
  companionHost?: HTMLElement;
  handoff?: SessionHandoff;
  sketch: (action: Extract<Action, { type: "sketch" }>) => void;
  plan: (action: Extract<Action, { type: "plan" }>) => void;
  note: (text: string, excerpt?: string) => Promise<void>;
}
const result = (ok: boolean, message: string, changed = false): ActionResult => ({
  ok,
  message: message.slice(0, 1800),
  changed,
});
function textField(node: Element): node is HTMLInputElement | HTMLTextAreaElement {
  return node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement;
}
function editable(node: Element): boolean {
  return (
    (textField(node) && !node.readOnly && !node.disabled &&
      !(node instanceof HTMLInputElement && ["checkbox", "radio", "file", "button", "submit", "reset", "image"].includes(node.type))) ||
    node.getAttribute("contenteditable") === "true"
  );
}
function dispatchText(node: Element, text: string): void {
  (node as HTMLElement).focus({ preventScroll: true });
  if (textField(node)) {
    const prototype =
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(node, text);
  } else node.textContent = text;
  node.dispatchEvent(
    new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }),
  );
  node.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}
function click(node: Element): void {
  const rect = node.getBoundingClientRect();
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: rect.x + rect.width / 2,
    clientY: rect.y + rect.height / 2,
    button: 0,
  };
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"])
    node.dispatchEvent(
      type.startsWith("pointer") && typeof PointerEvent !== "undefined"
        ? new PointerEvent(type, init)
        : new MouseEvent(type, init),
    );
  (node as HTMLElement).focus?.({ preventScroll: true });
  if (typeof (node as HTMLElement).click === "function") (node as HTMLElement).click();
  else node.dispatchEvent(new MouseEvent("click", init));
}

/** Read the browser's default link behavior after site handlers have run. */
function nativeLinkDestination(
  event: MouseEvent | undefined,
  anchor: HTMLAnchorElement | undefined,
  sourceUrl: string,
): string | undefined {
  if (
    !event ||
    !anchor ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey ||
    anchor.hasAttribute("download")
  )
    return;
  const target =
    anchor.target || document.querySelector("base[target]")?.getAttribute("target") || "_self";
  if (target.toLowerCase() !== "_self") return;
  try {
    const destination = new URL(anchor.href, document.baseURI);
    const current = new URL(sourceUrl);
    if (!/^https?:$/.test(destination.protocol)) return;
    const url = destination.href;
    destination.hash = current.hash = "";
    // Fragment-only links stay in this document and continue through observation.
    if (destination.href !== current.href) return url;
  } catch {
    // A page may replace its link with an invalid address during the click.
  }
}

/** Executes only against the observed node, revalidating after waits and confirmations. */
export async function execute(action: Action, context: ExecuteContext): Promise<ActionResult> {
  const { observer, signal, page, api } = context;
  const id = actionTarget(action);
  const expected = id == null ? undefined : page.elements.find((target) => target.id === id);
  const node = id == null ? null : observer.resolve(id);
  const verify = (ownValueChange = false) => {
    check(signal);
    if (!context.allowed()) throw new DOMException("Paused on this site", "AbortError");
    if (document.location.href !== page.url)
      throw new Error("The page changed. Observe again before acting.");
    const actual = node?.isConnected ? observer.describe(node) : undefined;
    const compare =
      ownValueChange && expected && actual ? { ...expected, value: actual.value,
        ...(node?.getAttribute("contenteditable") === "true" ? { name: actual.name } : {}) } : expected;
    if (id && (!node?.isConnected || !compare || !sameTarget(compare, actual)))
      throw new Error("The target changed. Observe again before acting.");
  };
  verify();
  const ready = async () => {
    if (node) {
      node.scrollIntoView?.({
        block: "center",
        behavior: context.reducedMotion ? "auto" : "smooth",
      });
      await delay(context.reducedMotion ? 0 : 180, signal);
      verify();
      context.highlight.show(node);
    }
  };
  const settle = async (minimum = 180) => {
    // Wait for a meaningful DOM/field/navigation change, then a short quiet period.
    // A static page is bounded too: lack of a visible effect is not success evidence.
    const started = Date.now();
    const initial = pageState(page);
    let snapshot = observer.snapshot();
    let previous = pageState(snapshot);
    let quietSince = Date.now();
    while (Date.now() - started < 1500) {
      check(signal);
      if (!context.allowed()) throw new DOMException("Paused on this site", "AbortError");
      if (snapshot.url !== page.url) return snapshot;
      const busy = Array.from(document.querySelectorAll('[aria-busy="true"]')).some((element) =>
        !context.companionHost?.contains(element));
      if (previous !== initial && !busy && Date.now() - started >= minimum && Date.now() - quietSince >= 120)
        return snapshot;
      await delay(60, signal);
      snapshot = observer.snapshot();
      const next = pageState(snapshot);
      if (next !== previous) quietSince = Date.now();
      previous = next;
    }
    return snapshot;
  };
  const withoutCompanion = async <T>(dispatch: () => T | Promise<T>): Promise<T> => {
    // Use the runtime's exact host reference. A webpage element with our ID
    // must never be treated as extension UI or bypass the occlusion check.
    const host = context.companionHost;
    if (!host?.isConnected) return dispatch();
    const previous = host.style.getPropertyValue("display");
    const priority = host.style.getPropertyPriority("display");
    host.style.setProperty("display", "none", "important");
    try { return await dispatch(); }
    finally {
      if (previous) host.style.setProperty("display", previous, priority);
      else host.style.removeProperty("display");
    }
  };
  const covered = (target: Element, rect = target.getBoundingClientRect()) => {
    const top = document.elementFromPoint?.(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return !!top && top !== target && !target.contains(top) && !top.contains(target);
  };
  switch (action.type) {
    case "tool":
      return { ok: false, changed: false, message: "Tool operations must run through the conversation controller." };
    case "observe":
      return result(true, node ? (node.textContent ?? "").slice(0, 2500) : "Page observed");
    case "point":
      await ready();
      return result(true, `Highlighted ${expected?.name ?? "the target"}`, true);
    case "click": {
      await ready();
      verify();
      let clickEvent: MouseEvent | undefined;
      let link: HTMLAnchorElement | undefined;
      const capture = (event: Event) => {
        if (!(event instanceof MouseEvent)) return;
        clickEvent = event;
        link = event
          .composedPath()
          .find((part): part is HTMLAnchorElement => part instanceof HTMLAnchorElement);
      };
      const activated = await withoutCompanion(async () => {
        if (covered(node!)) return false;
        await api.request({ type: "session.set", handoff: context.handoff ?? null }, signal);
        verify();
        const rect = node!.getBoundingClientRect();
        if (covered(node!, rect)) return false;
        let trusted = false;
        node!.addEventListener("click", capture, true);
        try {
          if (action.trusted && context.trustedInput) {
            const response = await api.request<{ ok: boolean }>(
                {
                  type: "input",
                  ops: [{ kind: "click", x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, button: "left", count: 1 }],
                },
                signal,
              );
            trusted = response.ok;
            if (!trusted) { verify(); if (covered(node!)) return false; }
          }
          if (!trusted) click(node!);
        } finally {
          node!.removeEventListener("click", capture, true);
        }
        return true;
      });
      if (!activated) return result(false, "Another control covers the target. Close it first.");
      const pendingDestination = nativeLinkDestination(clickEvent, link, page.url);
      const after = pendingDestination ? observer.snapshot() : await settle();
      const navigation = after.url !== page.url || !!pendingDestination;
      const changed =
        after.url !== page.url ||
        after.text !== page.text ||
        JSON.stringify(after.elements) !== JSON.stringify(page.elements);
      if (!pendingDestination) await api.request({ type: "session.set", handoff: null }, signal);
      return {
        ...result(
          true,
          pendingDestination && after.url === page.url
            ? "Link navigation requested; verify the destination before continuing"
            : changed
              ? "Control activated; page change verified"
              : "Control activated; no visible page change",
          changed,
        ),
        navigation,
        url: pendingDestination ?? after.url,
      };
    }
    case "type": {
      if (!node || privateField(node) || !editable(node))
        return result(false, "That field cannot be filled automatically.");
      await ready();
      verify();
      dispatchText(node, action.text);
      await settle(300);
      verify(true);
      const value = textField(node) ? node.value : (node.textContent ?? "");
      return result(
        value === action.text,
        value === action.text ? "Field value verified" : "The page changed the value after typing",
        value === action.text,
      );
    }
    case "select": {
      if (!(node instanceof HTMLSelectElement) || privateField(node))
        return result(false, "Choose this option yourself; the control is not a standard select.");
      const option = Array.from(node.options).find(
        (option) =>
          option.value === action.value ||
          option.textContent?.trim().toLowerCase() === action.value.toLowerCase(),
      );
      if (!option) return result(false, "That option is unavailable.");
      await ready();
      verify();
      node.value = option.value;
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
      await settle(300);
      verify(true);
      return result(node.value === option.value,
        node.value === option.value ? "Selected option verified" : "The page rejected the selected option",
        node.value === option.value);
    }
    case "scroll": {
      await ready();
      verify();
      if (!node)
        window.scrollBy({
          top: Math.max(-2000, Math.min(2000, action.amount ?? 600)),
          behavior: context.reducedMotion ? "auto" : "smooth",
        });
      return result(true, node ? "Target brought into view" : "Page scrolled", true);
    }
    case "navigate": {
      verify();
      await api.request(
        {
          type: "nav.navigate",
          url: action.url,
          newTab: !!action.newTab,
          handoff: context.handoff,
        },
        signal,
      );
      if (!action.newTab) {
        await delay(250, signal);
        if (document.location.href !== page.url) {
          await api.request({ type: "session.set", handoff: null }, signal);
          return {
            ...result(true, "Destination view observed", true),
            url: document.location.href,
          };
        }
      }
      return {
        ...result(
          true,
          "Navigation requested; the destination will be observed before the next step",
          false,
        ),
        navigation: true,
        url: action.url,
      };
    }
    case "back": {
      await api.request({ type: "session.set", handoff: context.handoff }, signal);
      verify();
      await api.request({ type: "nav.back", handoff: context.handoff }, signal);
      return { ...result(true, "Back navigation requested", false), navigation: true };
    }
    case "switchTab":
      await api.request(
        { type: "nav.switch", tabId: action.tabId, handoff: context.handoff },
        signal,
      );
      return { ...result(true, "Tab selected", true), navigation: true };
    case "key": {
      await ready();
      verify();
      const target = node ?? document.activeElement;
      if (!target || privateField(target))
        return result(false, "Please operate the private field yourself.");
      if (context.companionHost && (target === context.companionHost || target.getRootNode() === context.companionHost.shadowRoot))
        return result(false, "Choose the page control before sending a keyboard action.");
      (target as HTMLElement).focus?.();
      const parts = action.key.split("+");
      const key = parts.pop()!;
      const init = {
        key,
        code: key === "Enter" ? "Enter" : key,
        bubbles: true,
        cancelable: true,
        ctrlKey: parts.includes("Control"),
        metaKey: parts.includes("Meta"),
        shiftKey: parts.includes("Shift"),
        altKey: parts.includes("Alt"),
      };
      await api.request({ type: "session.set", handoff: context.handoff }, signal);
      verify();
      const proceed = target.dispatchEvent(new KeyboardEvent("keydown", init));
      target.dispatchEvent(new KeyboardEvent("keyup", init));
      const form = (target as HTMLInputElement).form;
      if (key === "Enter" && proceed && form && !(target instanceof HTMLTextAreaElement))
        form.requestSubmit();
      const after = await settle();
      const navigation = after.url !== page.url;
      if (!navigation) await api.request({ type: "session.set", handoff: null }, signal);
      return {
        ...result(true, `Pressed ${action.key}`, after.text !== page.text),
        navigation,
        url: after.url,
      };
    }
    case "pointer": {
      await ready();
      verify();
      const rect = node!.getBoundingClientRect();
      const init = {
        bubbles: true,
        cancelable: true,
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
      };
      if (action.command === "doubleClick") {
        click(node!);
        click(node!);
        node!.dispatchEvent(new MouseEvent("dblclick", { ...init, detail: 2 }));
      } else if (action.command === "rightClick")
        node!.dispatchEvent(new MouseEvent("contextmenu", { ...init, button: 2 }));
      else if (action.command === "hover")
        for (const type of ["mouseover", "mouseenter", "mousemove"])
          node!.dispatchEvent(new MouseEvent(type, init));
      else {
        const destination = action.toTarget ? observer.resolve(action.toTarget) : null;
        const expectedDestination = page.elements.find((target) => target.id === action.toTarget);
        if (
          !destination ||
          !expectedDestination ||
          !sameTarget(expectedDestination, observer.describe(destination))
        )
          return result(false, "The drop target changed or is unavailable.");
        const to = destination.getBoundingClientRect();
        node!.dispatchEvent(new MouseEvent("mousedown", { ...init, buttons: 1 }));
        destination.dispatchEvent(
          new MouseEvent("mousemove", {
            ...init,
            clientX: to.x + to.width / 2,
            clientY: to.y + to.height / 2,
            buttons: 1,
          }),
        );
        destination.dispatchEvent(
          new MouseEvent("mouseup", {
            ...init,
            clientX: to.x + to.width / 2,
            clientY: to.y + to.height / 2,
          }),
        );
      }
      const after = await settle();
      return result(
        true,
        `${action.command} dispatched`,
        after.text !== page.text || after.revision !== page.revision,
      );
    }
    case "video": {
      const video = document.querySelector("video");
      if (!video) return result(false, "No accessible video is on this page.");
      if (action.command === "play") await video.play();
      if (action.command === "pause") video.pause();
      if (action.command === "seek")
        video.currentTime = Math.max(
          0,
          Math.min(Number.isFinite(video.duration) ? video.duration : Infinity, action.value ?? 0),
        );
      if (action.command === "speed")
        video.playbackRate = Math.max(0.25, Math.min(4, action.value ?? 1));
      return result(
        true,
        `Video ${action.command} verified at ${Math.round(video.currentTime)} seconds`,
        true,
      );
    }
    case "sketch":
      context.sketch(action);
      return result(true, "Sketch displayed", true);
    case "plan":
      context.plan(action);
      return result(true, "Learning plan displayed", true);
    case "note":
      try {
        await context.note(action.text, action.excerpt);
        return result(true, "Source note saved", true);
      } catch (error) {
        check(signal);
        return result(false, error instanceof Error ? error.message : "The source note could not be saved.");
      }
    case "wait":
      await delay(Math.max(0, Math.min(5000, action.ms)), signal);
      return result(true, "Wait complete");
    case "say":
      return result(true, action.text);
    case "ask":
      return result(true, action.question);
    case "finish":
      return result(true, action.summary);
  }
}
