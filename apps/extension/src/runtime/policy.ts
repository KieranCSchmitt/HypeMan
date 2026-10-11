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
function review(label: string, page: PageSnapshot, form?: HTMLFormElement | null): string {
  const fields = form ? Array.from(form.elements).flatMap((control) => {
    if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) ||
      privateField(control) || !control.value || ["submit", "button", "hidden", "password", "file"].includes(control.type)) return [];
    const name = control.getAttribute("aria-label") || control.labels?.[0]?.textContent || control.name;
    return name ? [`${name.trim().slice(0, 40)}: ${control.value.slice(0, 80)}`] : [];
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
    [/\b(pay|buy|purchase|place order|checkout)\b/i, "Pay"], [/\b(register|enroll|sign up)\b/i, "Register"],
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
  if (
    click &&
    item &&
    CONSEQUENTIAL.test(item.name) &&
    !/^save draft$/i.test(item.name.trim()) &&
    !VIEW_CHANGE.test(item.name.trim()) &&
    !registrationFormLink(item, node)
  )
    return { allowed: true, confirmation: review(item.name, page, (node as HTMLButtonElement | undefined)?.form) };
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
        return { allowed: true, confirmation: review(item?.role === "button" ? item.name : "Submit form", page, form) };
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
