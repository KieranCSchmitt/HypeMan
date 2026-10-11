import type { BrowserTask, PageSnapshot } from "@core";

/** Learning preferences also power passive hints; explicit projects still use browse mode. */
export function projectIntent(message: string): boolean {
  if (/\b(?:learning|study|lesson) plan\b|\bhint\b/i.test(message)) return false;
  return /\b(?:project|workflow|multi[ -]?step|multiple (?:steps|websites|sites))\b|\bfirst\b[\s\S]+\bthen\b|\b(?:find|compare|research)\b[\s\S]+(?:\b(?:then|and)\b|[,;])[\s\S]+\b(?:prepare|register|book|apply|send|create|build|draft|write|publish|configure|choose|select)\b/i.test(message);
}

/** Planning alone is an explicit request; practical projects otherwise begin immediately. */
export function projectShouldWait(message: string): boolean {
  return /\b(?:wait for me|wait for (?:my|our) (?:approval|confirmation|go[- ]ahead)|(?:just|only) (?:make|create|give|show|write|draft)(?: me)? (?:a |the )?plan|(?:make|create|give|show|write|draft)(?: me)? (?:a |the )?plan only|(?:don['’]t|do not) (?:start|act|execute|browse|open|navigate)|(?:i['’]ll|i will|let me) (?:do|handle) (?:the work|the steps|it myself))\b/i.test(message);
}

export function currentMilestone(task: BrowserTask | null) {
  return task?.status === "running" ? task.steps.find((step) => step.status === "doing") : undefined;
}

/** Ignore animation, scroll, timestamps and target geometry when deciding whether to assess. */
export function projectPageKey(page: PageSnapshot): string {
  return JSON.stringify([page.url, page.title, page.text,
    page.elements.map(({ id, name, value, disabled }) => [id, name, value, disabled])]);
}

/** Deliberate chat acknowledgements are evidence; unrelated uses of “done” are not. */
export function confirmsMilestone(message: string, task: BrowserTask | null): boolean {
  const step = currentMilestone(task);
  if (!step || !task) return false;
  const index = task.steps.indexOf(step) + 1;
  const match = /^(?:(?:i(?:['’]ve| have)?|we(?:['’]ve| have)?)\s+)?(?:finished|completed|done)(?:\s+(?:with\s+)?(?:step\s+)?(\d+|this(?: step)?|that(?: step)?|the (?:current|first) step))?(?:\s*[,;—-]?\s*(?:next|continue|move on)(?:\s+please)?)?[.!]?$/i.exec(message.trim());
  if (!match) return false;
  if (match[1] === "the first step") return index === 1;
  return !match[1] || !/^\d+$/.test(match[1]) || Number(match[1]) === index;
}
