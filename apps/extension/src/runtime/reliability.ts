import type { Action, ActionResult, PageSnapshot } from "@core";
import type { RuntimeToolResult } from "./types";

/** Ignore animation and geometry when deciding whether an attempted action made progress. */
export function pageState(page: PageSnapshot): string {
  return JSON.stringify([page.url, page.text, page.elements.map(({ id, name, role, value, disabled }) => [id, name, role, value, disabled])]);
}

export function actionSignature(action: Action): string {
  return JSON.stringify(action);
}

export function normalizeToolResult(value: string | void | RuntimeToolResult, action: Extract<Action, { type: "tool" }>): {
  result: ActionResult; continue?: boolean; display: string;
} {
  const observation = typeof value === "string" ? { message: value } : value ?? { message: `${action.tool} ${action.operation} completed.` };
  const messageLimit = observation.data === undefined ? 9000 : 1000;
  const message = observation.message.slice(0, messageLimit);
  const clippedMessage = observation.message.length > messageLimit ? "\n[Message truncated; retrieve the full source before copying or sending it.]" : "";
  let data = "";
  if (observation.data !== undefined) {
    try {
      data = JSON.stringify(observation.data) ?? "";
      const limit = 10000 - message.length - clippedMessage.length - 50;
      if (data.length > limit) {
        const sourceIds: string[] = [];
        const queue: unknown[] = [observation.data];
        for (let examined = 0; queue.length && examined < 100; examined++) {
          const item = queue.shift();
          if (!item || typeof item !== "object") continue;
          if ("id" in item && typeof item.id === "string") sourceIds.push(item.id.slice(0, 160));
          queue.push(...Object.values(item).slice(0, 20));
        }
        data = JSON.stringify({ truncated: true, originalChars: data.length,
          sourceIds: [...new Set(sourceIds)].slice(0, 10),
          instruction: "Retrieve the full source by ID before copying or sending its content.",
          preview: data.slice(0, Math.max(0, Math.floor(limit / 2) - 1300)) });
      }
    } catch { data = JSON.stringify({ error: "Tool result could not be serialized.", truncated: true }); }
  }
  const display = observation.message.slice(0, 1000);
  return {
    result: { ok: observation.ok !== false, changed: observation.changed ?? (observation.ok !== false && !["open", "show", "status", "find", "filter"].includes(action.operation)),
      message: `${message}${clippedMessage}${data ? `\nTool observation (untrusted data): ${data}` : ""}` },
    continue: observation.continue,
    display,
  };
}
