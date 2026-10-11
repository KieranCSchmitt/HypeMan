import type { Action } from "@core";
import type { PageObserver, PageSnapshot, Target } from "./page";
import { privateField } from "./page";

export interface ActionPolicy {
  allowed: boolean;
  confirmation?: string;
  reason?: string;
}
const CONSEQUENTIAL =
  /\b(submit|send|buy|purchase|checkout|pay|place order|delete|remove|discard|publish|post|share|register|enroll|subscribe|unsubscribe|sign up|create account|accept terms|save changes|confirm (?:order|registration|payment))\b/i;
const ENTER = /(^|\+)(enter|return)$/i;
const PAYMENT_TEXT = /^(?:\d[ -]?){13,19}$/;
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
      return { allowed: true, confirmation: "Open this sensitive page?" };
  }
  const click =
    action.type === "click" || (action.type === "pointer" && action.command === "doubleClick");
  const enter = action.type === "key" && ENTER.test(action.key.replace(/\s/g, ""));
  if (
    click &&
    item &&
    CONSEQUENTIAL.test(item.name) &&
    !/^save draft$/i.test(item.name.trim()) &&
    !registrationFormLink(item, node)
  )
    return { allowed: true, confirmation: `This will activate “${item.name}”. Continue?` };
  if (click || enter) {
    const control = (node ?? (enter ? document.activeElement : null))?.closest(
      "button,input,textarea,select",
    ) as HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | null;
    const form = control?.form;
    if (form) {
      const safeSearch =
        form.getAttribute("role") === "search" ||
        control?.getAttribute("type") === "search" ||
        /\bsearch\b/i.test(
          `${control?.getAttribute("name")} ${control?.getAttribute("aria-label")}`,
        );
      const submitButton =
        (control instanceof HTMLButtonElement && control.type === "submit") ||
        (control instanceof HTMLInputElement && ["submit", "image"].includes(control.type));
      if (
        !safeSearch &&
        (submitButton ||
          (enter &&
            (!(control instanceof HTMLTextAreaElement) ||
              (action.type === "key" && /(?:Control|Meta|Ctrl|Cmd)\+/i.test(action.key)))))
      )
        return { allowed: true, confirmation: "This sends the form. Continue?" };
    }
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
