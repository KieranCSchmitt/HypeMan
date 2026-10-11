import type { ActionResult, HistoryEntry, PageSnapshot } from "./contracts";

const outcomes = [
  { kind: "purchase", goal: /\b(buy|purchase|pay|checkout|place (?:an? |the )?order)\b/i, success: /\b(order|payment|purchase)\b.*\b(confirmed|complete|completed|successful|received|placed)\b|\b(thank you|thanks)\b.*\border\b/i },
  { kind: "registration", goal: /\b(register|registration|enroll|enrollment|sign up|create account)\b/i, success: /\b(registration|enrollment|account)\b.*\b(confirmed|complete|completed|successful|created|received)\b|\b(registered|enrolled)\b/i },
  { kind: "booking", goal: /\b(book|reserve|reservation|schedule an? appointment)\b/i, success: /\b(booking|reservation|appointment)\b.*\b(confirmed|complete|completed|successful|reserved|scheduled)\b|\b(reserved|booked)\b/i },
  { kind: "message", goal: /\b(send|invite)\b/i, success: /\b(sent|delivered|invitation sent|message received)\b/i },
  { kind: "deletion", goal: /\b(delete|remove|discard|cancel (?:the |my |this )?(?:booking|reservation|subscription))\b/i, success: /\b(deleted|removed|discarded|cancelled|canceled)\b/i },
  { kind: "publication", goal: /\b(publish|post|share)\b/i, success: /\b(published|posted|shared|now live)\b/i },
  { kind: "subscription", goal: /\b(subscribe|unsubscribe)\b/i, success: /\b(subscribed|unsubscribed|subscription (?:confirmed|cancelled|canceled))\b/i },
  { kind: "account", goal: /\b(save changes|change (?:my |the )?(?:account|profile|password))\b/i, success: /\b(changes?|profile|account|password)\b.*\b(saved|updated|changed)\b/i },
  { kind: "submission", goal: /\b(submit|apply|application)\b/i, success: /\b(submitted|submission (?:received|confirmed)|application (?:received|submitted))\b/i },
];

export function completionKind(text: string): string | undefined {
  if (/^(?:remove|clear|reset)(?: all)? (?:the )?(?:filters?|sort|selection|search|highlights?)[.!]?$/i.test(text.trim())) return;
  // Preparing a draft is a separate outcome from committing it.
  if (/\b(?:prepare|draft|fill|review|compare|research)\b/i.test(text) &&
    !/\b(?:then|and|finally)\s+(?:submit|send|register|buy|pay|publish|book|apply)|\b(?:complete|finish|submit|send|purchase|checkout|publish|confirm|register|enroll|buy|pay|book|delete|remove)\b/i.test(text)) return;
  return outcomes.find((outcome) => outcome.goal.test(text))?.kind;
}

const genericWords = new Set("a an the this that these those my your our their chosen selected requested current new now for to of in at on me us myself please best cheapest suitable first second third last option options choice choices one ones registration enrollment workshop workshops event events course courses class classes appointment booking reservation order product item message invitation application account profile subscription document file task project book books table ticket tickets room successfully completed complete confirmed confirmation received sent delivered saved updated submitted is was has been".split(" "));
const subjectWords = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .match(/[\p{L}\p{N}]+/gu)?.filter((word) => /\p{L}/u.test(word) && !genericWords.has(word)) ?? [];
function cleanSubject(value: string | undefined): string | undefined {
  if (!value) return;
  const clean = value.split(/\s+(?:then|after|before|using|with|and\s+(?:then|send|save|book|register|pay|delete|share|publish))\b/i)[0]
    .replace(/^[\s"'“”‘’:—–-]+|[\s"'“”‘’.,!?;:—–-]+$/g, "").trim().slice(0, 200);
  return subjectWords(clean).length ? clean : undefined;
}

/** Bind identifiable objects/recipients; deictic requests keep the held page/control context. */
export function completionSubject(goal: string): string | undefined {
  const quoted = goal.match(/["“]([^"”]{2,200})["”]/)?.[1];
  if (quoted) return cleanSubject(quoted);
  const patterns = [
    /\b(?:register|enroll|sign up)(?:\s+(?:me|us|myself))?\s+(?:for|in|at)\s+(.+)/i,
    /\b(?:registration|enrollment|booking|reservation)\s+for\s+(.+)/i,
    /\b(?:confirm|complete|finish)\s+(?:the\s+)?(.+?)\s+(?:registration|enrollment|booking|reservation|application)\b/i,
    /\b(?:book|reserve|buy|purchase|delete|remove|discard|publish)\s+(.+)/i,
    /\b(?:send|deliver)\b.*?\bto\s+(.+)/i,
    /\binvite\s+(.+)/i,
  ];
  for (const pattern of patterns) {
    const subject = cleanSubject(goal.match(pattern)?.[1]);
    if (subject) return subject;
  }
}

const sameSubject = (expected: string, actual: string) => {
  const words = subjectWords(expected), other = new Set(subjectWords(actual));
  return words.length > 0 && words.every((word) => other.has(word));
};
function noticeSubject(evidence: string): string | undefined {
  const succeeded = "(?:confirmed|completed|successful|received|placed|registered|enrolled|booked|reserved|scheduled|sent|delivered|deleted|removed|discarded|cancelled|canceled|published|posted|shared|subscribed|unsubscribed|saved|updated|submitted)";
  const patterns = [
    new RegExp(`\\b${succeeded}\\s+(?:for|to|in|at|of)\\s+(.+)`, "i"),
    new RegExp(`\\b${succeeded}\\s*[:—–-]\\s*(.+)`, "i"),
    new RegExp(`\\b(?:registration|enrollment|booking|reservation|order|invitation|message|application)\\s+(?:for|to|of)\\s+(.+?)\\s+(?:(?:is|was|has been)\\s+)?${succeeded}\\b`, "i"),
    new RegExp(`^(.+?)\\s+(?:registration|enrollment|booking|reservation|order|invitation|message|application)\\s+(?:(?:is|was|has been)\\s+)?${succeeded}\\b`, "i"),
  ];
  for (const pattern of patterns) {
    const subject = cleanSubject(evidence.match(pattern)?.[1]);
    if (subject) return subject;
  }
}
function safeDestination(value: string | undefined): string | undefined {
  try { if (value && /^https?:$/.test(new URL(value).protocol)) return value; } catch { /* No usable destination. */ }
}

export function pendingCompletion(goal: string, control: string, page: PageSnapshot, destination?: string): ActionResult["pendingCompletion"] {
  const desired = completionKind(goal);
  const actual = completionKind(control);
  const kind = actual && actual !== "submission" ? actual : desired ?? actual;
  const subject = completionSubject(goal) ??
    (/\b(?:this|that|selected|chosen)\b/i.test(goal) ? cleanSubject(page.headings[0]) : undefined);
  const url = safeDestination(destination);
  return kind ? { kind, previous: page.successes.filter((notice) => notice.length <= 600).slice(0, 30), fromUrl: page.url,
    ...(control ? { control: control.slice(0, 300) } : {}), ...(subject ? { subject } : {}),
    ...(url ? { destination: url } : {}) } : undefined;
}

export function freshCompletion(pending: ActionResult["pendingCompletion"], page: PageSnapshot): ActionResult["completion"] {
  if (!pending) return;
  const controlSubject = completionSubject(pending.control ?? "");
  if (pending.subject && controlSubject && !sameSubject(pending.subject, controlSubject)) return;
  if (pending.destination) {
    try { if (new URL(pending.destination).origin !== new URL(page.url).origin) return; }
    catch { return; }
  }
  const outcome = outcomes.find((item) => item.kind === pending.kind);
  const evidence = page.successes.find((notice) => !pending.previous.includes(notice) &&
    notice.length >= 8 && notice.length <= 600 && page.text.includes(notice) && outcome?.success.test(notice) &&
    (!pending.subject || !noticeSubject(notice) || sameSubject(pending.subject, noticeSubject(notice)!)));
  return evidence ? { kind: pending.kind, evidence, url: page.url,
    ...(pending.subject ? { subject: pending.subject } : {}), ...(pending.fromUrl ? { fromUrl: pending.fromUrl } : {}),
    ...(pending.control ? { control: pending.control } : {}), ...(pending.destination ? { destination: pending.destination } : {}) } : undefined;
}

export function matchesCompletion(goal: string, completion: ActionResult["completion"]): boolean {
  const kind = completionKind(goal);
  if (!kind || !completion || completion.kind !== kind) return false;
  const expected = completionSubject(goal);
  if (expected && (!completion.subject || !sameSubject(expected, completion.subject))) return false;
  const controlSubject = completionSubject(completion.control ?? "");
  if (completion.subject && controlSubject && !sameSubject(completion.subject, controlSubject)) return false;
  if (completion.destination) {
    try { if (new URL(completion.destination).origin !== new URL(completion.url).origin) return false; }
    catch { return false; }
  }
  const named = noticeSubject(completion.evidence);
  return !completion.subject || !named || sameSubject(completion.subject, named);
}

export function verifiedCompletion(goal: string, history: HistoryEntry[]): boolean {
  const kind = completionKind(goal);
  return !kind || history.some(({ result }) => result.ok && matchesCompletion(goal, result.completion));
}
