import type { Action } from "@core";
import type { PageObserver, PageSnapshot, Target } from "./page";
import { privateField } from "./page";

export interface ActionPolicy {
  allowed: boolean;
  confirmation?: string;
  reason?: string;
}
const CONSEQUENTIAL =
  /\b(submit|send|invite|buy|purchase|checkout|pay|place order|delete|remove|discard|publish|post|share|register|enroll|book|reserve|subscribe|unsubscribe|sign up|create account|accept terms|save changes|cancel (?:booking|reservation|subscription)|confirm (?:order|registration|payment|booking|reservation))\b/i;
const ENTER = /(^|\+)(enter|return)$/i;
const PAYMENT_TEXT = /^(?:\d[ -]?){13,19}$/;
const VIEW_CHANGE = /^(?:remove|clear|reset)(?: all)? (?:the )?(?:filters?|sort|selection|search|highlights?)$/i;
const SEARCH = /\b(search|find|look up|get forecast)\b/i;
const PRIVATE_SEARCH = /\b(account|admin|auth|checkout|inbox|login|log in|messages?|password|payments?|profile|sign in)\b/i;
const MUTATING_PATH = /(?:^|\/)(?:delete|remove|discard|publish|send|submit|save|checkout|pay|payment|purchase|buy|register|enroll|subscribe|unsubscribe|book|reserve|confirm|commit|create|update)(?:[\/_.-]|$)/i;

function actionControl(action: Action, node?: Element | null): Element | null {
  const enter = action.type === "key" && ENTER.test(action.key.replace(/\s/g, ""));
  return (node ?? (enter ? document.activeElement : null))?.closest(
    "button,input,textarea,select,[role='button'],[contenteditable='true']",
  ) ?? null;
}
function controlForm(control: Element | null): HTMLFormElement | null {
  return (control as HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null)?.form
    ?? control?.closest("form") ?? null;
}
function formDestination(form: HTMLFormElement, control: Element | null) {
  const submitter = control instanceof HTMLButtonElement ||
    (control instanceof HTMLInputElement && ["submit", "image"].includes(control.type));
  const method = (submitter && control.hasAttribute("formmethod")
    ? control.getAttribute("formmethod") : form.getAttribute("method")) ?? "get";
  const action = submitter && control.hasAttribute("formaction")
    ? (control as HTMLButtonElement | HTMLInputElement).formAction : form.action;
  const target = submitter && control.hasAttribute("formtarget")
    ? control.getAttribute("formtarget") : form.target;
  return { method: method.toLowerCase(), action, target };
}

/** A search label alone cannot waive confirmation for a POST or private form. */
function publicSearch(form: HTMLFormElement, control: Element | null, label: string): boolean {
  // A search form can have other submit controls. Only the generic submission
  // label or an explicitly search-only submission inherits its GET exemption.
  const normalizedLabel = label.trim().replace(/\s+/g, " ");
  if (/\bsubmit\b/i.test(normalizedLabel) && !/^submit(?: (?:search|query))?$/i.test(normalizedLabel)) return false;
  const destination = formDestination(form, control);
  if (destination.method !== "get") return false;
  let url: URL;
  try { url = new URL(destination.action, form.ownerDocument.baseURI); } catch { return false; }
  if (!/^https?:$/.test(url.protocol)) return false;
  if (MUTATING_PATH.test(url.pathname) || Array.from(url.searchParams).some(([name, value]) =>
    /^(?:action|command|operation|do|method)$/i.test(name) && /delete|remove|save|send|submit|publish|confirm|create|update|pay|book|reserve/i.test(value))) return false;
  const controls = Array.from(form.elements);
  if (controls.some((field) => privateField(field) ||
    (field instanceof HTMLInputElement && field.type === "file"))) return false;
  const metadata = [label, form.getAttribute("role"), form.getAttribute("aria-label"),
    form.id, form.name, url.pathname, form.ownerDocument.location?.pathname,
    ...controls.map((field) => `${field.getAttribute("name") ?? ""} ${field.getAttribute("aria-label") ?? ""}`),
  ].join(" ").replace(/([a-z])([A-Z])/g, "$1 $2");
  // Generic “Submit” is fine inside an otherwise verified public GET search;
  // more specific consequential actions always retain their review.
  if (CONSEQUENTIAL.test(metadata.replace(/\bsubmit\b/gi, "")) || PRIVATE_SEARCH.test(metadata)) return false;
  return form.getAttribute("role") === "search" || SEARCH.test(metadata) || controls.some((field) =>
    field instanceof HTMLInputElement && (field.type === "search" || /^(?:q|query|search|keywords?|searchterm)$/i.test(field.name)));
}

export class ConfirmationChangedError extends Error {
  constructor(readonly acted = false) {
    super(`The form changed after its review. ${acted ? "The page may have changed; verify it before repeating the action." : "Nothing was submitted; review the updated details before confirming again."}`);
    this.name = "ConfirmationChangedError";
  }
}
export interface ActionApproval {
  /** Local DOM reference and predicate only; never serialize into model context. */
  readonly target: Element | null;
  isCurrent(action: Action): boolean;
}
function fieldState(field: Element): unknown {
  const input = field as HTMLInputElement;
  return [field.tagName, field.id, input.name, input.type, input.disabled,
    input.value, input.checked, field.getAttribute("aria-checked"),
    field.getAttribute("aria-label"), field.getAttribute("aria-labelledby"),
    Array.from(input.labels ?? []).map((label) => label.textContent),
    /^(?:checkbox|radio|switch)$/.test(field.getAttribute("role") ?? "") ? field.textContent : undefined,
    field.getAttribute("contenteditable") === "true" ? field.textContent : undefined,
    field instanceof HTMLSelectElement ? Array.from(field.options).map((option) => [option.value, option.selected]) : undefined,
    field instanceof HTMLInputElement && field.type === "file"
      ? Array.from(field.files ?? []).map((file) => [file.name, file.size, file.type, file.lastModified]) : undefined];
}

/** Capture exactly what was reviewed, including untruncated values and submitter overrides. */
export function captureActionApproval(action: Action, page: PageSnapshot, observer: PageObserver): ActionApproval {
  const id = actionTarget(action);
  const target = id == null ? actionControl(action) : observer.resolve(id);
  const control = actionControl(action, target);
  const form = controlForm(control);
  const actionKey = JSON.stringify(action);
  const state = (snapshot: PageSnapshot) => {
    const controls = form ? Array.from(form.elements) : snapshot.elements.flatMap((item) => {
      const element = observer.resolve(item.id);
      return element?.matches("input,textarea,select,[contenteditable='true'],[role='checkbox'],[role='radio'],[role='switch']") ? [element] : [];
    });
    return JSON.stringify([snapshot.url, target ? [targetFingerprint(observer.describe(target)), target.textContent] : null,
      form ? [form.id, form.getAttribute("method"), form.getAttribute("action"), formDestination(form, control)] : null,
      controls.map(fieldState)]);
  };
  // Values, including private values, stay in this local closure. They are never
  // included in the visible review, returned fingerprint, history or model input.
  const reviewed = state(page);
  return Object.freeze({ target, isCurrent(candidate: Action) {
    if (JSON.stringify(candidate) !== actionKey || document.location.href !== page.url ||
      (target && (!target.isConnected || (id != null && observer.resolve(id) !== target))) ||
      controlForm(actionControl(action, target)) !== form) return false;
    return state(observer.snapshot()) === reviewed;
  } });
}
function review(label: string, page: PageSnapshot, form?: HTMLFormElement | null): string {
  const fields = form ? Array.from(form.elements).flatMap((control) => {
    if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) ||
      privateField(control) || !control.value || ["submit", "button", "hidden", "password", "file"].includes(control.type)) return [];
    const name = control.getAttribute("aria-label") || control.labels?.[0]?.textContent || control.name;
    const value = control instanceof HTMLInputElement && ["checkbox", "radio"].includes(control.type)
      ? control.checked ? control.value : "not selected"
      : control instanceof HTMLSelectElement && control.multiple
        ? Array.from(control.selectedOptions).map((option) => option.value).join(", ") : control.value;
    return name ? [`${name.trim().slice(0, 40)}: ${value.slice(0, 80)}`] : [];
  }).slice(0, 3) : [];
  let site = "this website";
  try { site = new URL(page.url).hostname; } catch { /* Keep the local fallback. */ }
  return `${label.slice(0, 120)} · ${site}${fields.length ? `\n${fields.join(" · ")}` : ""}`;
}
function registrationFormLink(item: Target, node: Element | null | undefined): boolean {
  if (!(node instanceof HTMLAnchorElement) || !item.href || node.hasAttribute("download"))
    return false;
  // These links open an ordinary form; the form's final control is checked separately.
  if (
    !/\b(register|registration|enroll|enrollment|sign up)\b/i.test(item.name) ||
    CONSEQUENTIAL.test(
      item.name.replace(/\b(register|registration|enroll|enrollment|sign up)\b/gi, ""),
    )
  )
    return false;
  try {
    const url = new URL(item.href);
    return (
      /^https?:$/.test(url.protocol) &&
      /\/(?:register|registration|enroll|enrollment|signup|sign-up)(?:\.(?:html?|php))?\/?$/i.test(
        url.pathname,
      ) &&
      !/submit|confirm|complete|commit|action=|delete|payment|checkout/i.test(url.search)
    );
  } catch {
    return false;
  }
}
function destination(url: string): string | null {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? null : "Only ordinary web pages can be opened.";
  } catch {
    return "That URL is invalid.";
  }
}
export function actionTarget(action: Action): string | undefined {
  return "target" in action ? action.target : undefined;
}
export function confirmationLabel(action: Action, page: PageSnapshot): string {
  const name = page.elements.find((item) => item.id === actionTarget(action))?.name ?? "";
  for (const [pattern, label] of [
    [/\b(send|invite)\b/i, "Send"], [/\b(delete|remove|discard)\b/i, "Delete"],
    [/\b(pay|buy|purchase|place order|checkout)\b/i, "Pay"], [/\b(register|registration|enroll|enrollment|sign up)\b/i, "Register"],
    [/\b(book|reserve)\b/i, "Book"], [/\b(publish|post|share)\b/i, "Publish"],
    [/\bunsubscribe\b/i, "Unsubscribe"], [/\bsubscribe\b/i, "Subscribe"], [/\bsave\b/i, "Save"],
  ] as const) if (pattern.test(name)) return label;
  return action.type === "navigate" ? "Continue" : "Submit";
}
export function checkPolicy(
  action: Action,
  page: PageSnapshot,
  observer?: PageObserver,
): ActionPolicy {
  const target = actionTarget(action);
  const item = target == null ? undefined : page.elements.find((element) => element.id === target);
  const node = target == null ? undefined : observer?.resolve(target);
  if (target != null && !item)
    return { allowed: false, reason: "That target has left the page. I need to look again." };
  if (item?.disabled && ["click", "type", "select", "key", "pointer"].includes(action.type))
    return { allowed: false, reason: "That control is disabled." };
  if (["type", "select"].includes(action.type) && (item?.sensitive || (node && privateField(node))))
    return {
      allowed: false,
      reason: "Please enter passwords, payment details, and verification codes yourself.",
    };
  if (action.type === "type" && PAYMENT_TEXT.test(action.text.trim()))
    return { allowed: false, reason: "Please enter payment details yourself." };
  if (action.type === "navigate") {
    const reason = destination(action.url);
    if (reason) return { allowed: false, reason };
    if (/checkout|payment|unsubscribe|delete/i.test(new URL(action.url).pathname))
      return { allowed: true, confirmation: review(`Open ${new URL(action.url).pathname}`, page) };
  }
  const click =
    action.type === "click" || (action.type === "pointer" && action.command === "doubleClick");
  const enter = action.type === "key" && ENTER.test(action.key.replace(/\s/g, ""));
  const control = click || enter ? actionControl(action, node) : null;
  const form = controlForm(control);
  const safeSearch = !!form && publicSearch(form, control, item?.name ?? "");
  if (
    click &&
    item &&
    CONSEQUENTIAL.test(item.name) &&
    !safeSearch &&
    !/^save draft$/i.test(item.name.trim()) &&
    !VIEW_CHANGE.test(item.name.trim()) &&
    !registrationFormLink(item, node)
  )
    return { allowed: true, confirmation: review(item.name, page, form) };
  if (click || enter) {
    if (form) {
      const submitButton =
        (control instanceof HTMLButtonElement && control.type === "submit") ||
        (control instanceof HTMLInputElement && ["submit", "image"].includes(control.type));
      if (
        !safeSearch &&
        (submitButton ||
          (click && SEARCH.test(item?.name ?? "")) ||
          (enter &&
            (!(control instanceof HTMLTextAreaElement) ||
              (action.type === "key" && /(?:Control|Meta|Ctrl|Cmd)\+/i.test(action.key)))))
      )
        return { allowed: true, confirmation: review(item?.role === "button" ? item.name : "Submit form", page, form) };
    } else if (click && SEARCH.test(item?.name ?? "") && !(node instanceof HTMLAnchorElement))
      return { allowed: true, confirmation: review(item!.name, page) };
  }
  return { allowed: true };
}

export function targetFingerprint(target: Target): string {
  return JSON.stringify([
    target.id,
    target.name,
    target.role,
    target.href,
    target.sensitive,
    target.disabled,
  ]);
}
