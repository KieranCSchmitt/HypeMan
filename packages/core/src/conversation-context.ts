import type { AgentRequest, ConversationTurn } from "./contracts";

/** Keep recent exchanges together and bound the total, rather than truncating every message. */
export function conversationTurns(messages: Array<{ role: string; text: string; at: number }>, currentMessage = ""): ConversationTurn[] {
  const turns = messages.filter((message) => ["user", "assistant"].includes(message.role));
  if (turns.at(-1)?.role === "user" && turns.at(-1)?.text.trim() === currentMessage.trim()) turns.pop();
  const terms = [...new Set(currentMessage.toLowerCase().match(/[a-z]{4,}/g) || [])].filter((word) => !/^(?:what|when|where|which|with|about|please|could|would|should|again|that|this|have|does|tell|remember|said)$/.test(word));
  const older = turns.slice(0, -16).map((turn, index) => ({ turn, index, score: turn.role === "user" ? terms.filter((term) => new RegExp(`\\b${term}\\b`, "i").test(turn.text)).length : 0 }))
    .filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || b.index - a.index).slice(0, 3).sort((a, b) => a.index - b.index);
  const recalled = older.map(({ turn }) => ({ role: turn.role as ConversationTurn["role"], text: turn.text.slice(0, 1200), at: turn.at }));
  let budget = 18000 - recalled.reduce((total, turn) => total + JSON.stringify(turn).length, 0);
  const result: ConversationTurn[] = [];
  for (const turn of turns.slice(-16).reverse()) {
    if (budget < 100) break;
    let text = turn.text.slice(-Math.min(6000, budget));
    const value: ConversationTurn = { role: turn.role as ConversationTurn["role"], text, at: turn.at };
    while (JSON.stringify(value).length > budget && text.length) { text = text.slice(Math.max(1, Math.ceil(text.length / 8))); value.text = text; }
    budget -= JSON.stringify(value).length;
    result.unshift(value);
  }
  return [...recalled, ...result];
}

const pageReference = /\b(?:this|the|current|that) (?:page|website|site|article|guide|passage|equation|question|problem|form|button|link|video|document|pdf)\b|\bon (?:my|the) (?:screen|page)\b|\b(?:click|navigate|scroll|fill|select|press|find|research|compare|prepare|register|configure|open|go (?:back|to)|search (?:the web|for))\b|\b(?:why|what).*(?:wrong|incorrect|answer|highlighted|selected)\b|\b(?:hint|teach.?back|check my work|am I correct)\b/i;
const reference = /\b(?:this|that|it|these|those|selected|attached|above|same|again|more|continue|next)\b/i;
const personal = /\b(?:remind|reminder|text me|send me a text|my phone|time ?zone|est|edt|pst|pdt)\b/i;
const timeAnswer = /^(?:am|pm)(?:[.!]|\s+(?:please|thanks))?$|^(?:the next |at )?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i;
type ContextInput = Pick<AgentRequest, "message" | "conversation" | "task" | "toolContext" | "history">;

/** An open window alone does not attach its content to every subsequent question. */
export function contextTool(input: ContextInput): "documents" | "video" | undefined {
  if (personal.test(input.message) || timeAnswer.test(input.message)) return;
  const selected = input.toolContext?.selected;
  const previous = input.conversation?.filter((turn) => turn.role === "user").at(-1)?.text || "";
  for (const tool of ["documents", "video"] as const) {
    const topic = tool === "documents" ? /\b(?:this|the|attached|selected|uploaded) (?:pdf|document)\b|\b(?:in|from|of) (?:this |the |my )?(?:pdf|document)\b|\bpage \d+\b/i : /\b(?:this|the|attached|selected) (?:video|clip)\b|\b(?:in|from|of) (?:this |the )?(?:video|clip)\b/i;
    const selectedTool = selected && (tool === "documents" ? ["pdf", "document", "documents"].includes(selected.kind) : selected.kind === "video");
    if (topic.test(input.message) || reference.test(input.message) && (selectedTool || input.toolContext?.activeTool === tool && topic.test(previous))) return tool;
  }
}

export function contextScope(input: ContextInput): NonNullable<AgentRequest["contextScope"]> {
  const text = input.message;
  if ((personal.test(text) || timeAnswer.test(text)) && !pageReference.test(text)) return "conversation";
  if (contextTool(input)) return "selection";
  if (input.toolContext?.selected && reference.test(text)) return "selection";
  if (pageReference.test(text)) return input.task ? "task" : "page";
  if (/^(?:what|why|how|who|where|when|explain|define|tell me about|new question|unrelated|separately)\b/i.test(text) && !reference.test(text)) return "conversation";
  if (input.task && (!/\?$/.test(text) || reference.test(text)) && !/^(?:what|why|how|who|where|when|explain|define|tell me about|new question|unrelated|separately)\b/i.test(text)) return "task";
  if (input.history.some((entry) => !["say", "ask", "sketch"].includes(entry.action.type))) return input.task ? "task" : "page";
  if (reference.test(text)) {
    const previous = input.conversation?.filter((turn) => turn.role === "user").at(-1)?.text || "";
    if (pageReference.test(previous) && !personal.test(previous)) return "page";
  }
  return "conversation";
}

/** A visible page or an open tool is background context, never the user's implicit topic. */
export function focusAgentContext(input: AgentRequest): AgentRequest {
  const scope = contextScope(input);
  if (scope !== "conversation" && !(scope === "selection" && input.toolContext?.selected?.kind !== "page")) return { ...input, contextScope: scope, mode: input.mode === "learn" && /\b(?:hint|practice|teach|learn(?:ing)?|wrong|incorrect|my answer|check my work)\b|\bexplain.*(?:equation|question|problem)\b/i.test(input.message) ? "learn" : "browse" };
  const { screenshot, sources, toolContext, ...rest } = input;
  return {
    ...rest, goal: input.message.slice(0, 2000), contextScope: scope, task: null, history: [], mode: "browse",
    page: { ...input.page, title: "", text: "", headings: [], selection: "", elements: [], errors: [], successes: [], video: undefined,
      frames: { count: 0, inaccessible: 0 } },
    // Images explicitly attached by a user retain meaning even in a standalone question.
    ...(screenshot ? { screenshot } : {}),
    ...(scope === "selection" && toolContext ? { toolContext } : {}),
  };
}
