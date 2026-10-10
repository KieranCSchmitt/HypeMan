import { isRecord, parseAction, type Action, type PageSnapshot } from "@core";
import { GatewayError } from "./errors";

export interface AdaptedDecision {
  action: Action;
  say?: string;
  done: boolean;
}
const invalid = () =>
  new GatewayError(
    502,
    "The model proposed an invalid browser action; nothing was executed.",
    "invalid_provider_output",
  );
/** Provider envelopes stay flat; only this boundary knows historical action names. */
export function adaptDecision(value: unknown, page: PageSnapshot): AdaptedDecision {
  if (
    !isRecord(value) ||
    (value.say != null && typeof value.say !== "string") ||
    (value.done !== undefined && typeof value.done !== "boolean")
  )
    throw invalid();
  const action = isRecord(value.action) ? parseAction(value.action) : parseFlatAction(value, page);
  if (!action) throw invalid();
  for (const key of ["target", "toTarget"] as const) {
    if (key in action) {
      const id = (action as Action & { target?: string; toTarget?: string })[key];
      if (id && !page.elements.some((element) => element.id === id))
        throw new GatewayError(
          502,
          "The model referenced a stale target; observe the page again.",
          "stale_target",
        );
    }
  }
  return {
    action,
    ...(typeof value.say === "string" ? { say: value.say.slice(0, 1000) } : {}),
    done: value.done === true,
  };
}

function parseFlatAction(raw: Record<string, unknown>, page: PageSnapshot): Action | null {
  const field = (...keys: string[]): unknown => {
    for (const key of keys) if (raw[key] !== undefined && raw[key] !== null) return raw[key];
    return undefined;
  };
  const target = (key = "target", legacy = "elementId") => {
    const id = field(key, legacy);
    // Numeric legacy IDs must identify an actual element. Never guess an index or prefix.
    return typeof id === "number" && Number.isInteger(id) ? String(id) : id;
  };
  const type = raw.action;
  if (typeof type !== "string") return null;
  // Coordinate-only outputs cannot be tied to the current semantic observation.
  if (["x", "y", "toX", "toY"].some((key) => raw[key] != null)) return null;
  const optionalTarget = target() === undefined ? {} : { target: target() };
  const text = field("text", "say");
  let candidate: unknown;
  switch (type) {
    case "say":
    case "speak":
    case "explain":
      candidate = { type: "say", text };
      break;
    case "point":
    case "point_to":
    case "highlight":
      candidate = {
        type: "point",
        target: target(),
        ...(field("quote") === undefined ? {} : { quote: field("quote") }),
      };
      break;
    case "click":
      candidate = {
        type,
        target: target(),
        ...(field("trusted") === undefined ? {} : { trusted: field("trusted") }),
      };
      break;
    case "type":
    case "clear":
      candidate = { type: "type", target: target(), text: type === "clear" ? "" : raw.text };
      break;
    case "select":
      candidate = { type, target: target(), value: field("value") };
      break;
    case "key":
    case "press_key":
    case "press_enter":
      candidate = {
        type: "key",
        ...optionalTarget,
        key: type === "press_enter" ? "Enter" : field("key", "text"),
      };
      break;
    case "scroll":
    case "scroll_to": {
      const amount =
        field("amount") ?? (raw.direction === "up" || raw.direction === "down" ? 500 : undefined);
      if (
        (raw.direction != null && raw.direction !== "up" && raw.direction !== "down") ||
        (amount !== undefined && (typeof amount !== "number" || !Number.isFinite(amount)))
      )
        return null;
      candidate = {
        type: "scroll",
        ...optionalTarget,
        ...(amount === undefined
          ? {}
          : {
              amount:
                raw.direction === "up"
                  ? -Math.abs(amount as number)
                  : raw.direction === "down"
                    ? Math.abs(amount as number)
                    : amount,
            }),
      };
      break;
    }
    case "navigate":
    case "open_tab":
      candidate = {
        type: "navigate",
        url: field("url"),
        ...(type === "open_tab"
          ? { newTab: true }
          : field("newTab") === undefined
            ? {}
            : { newTab: field("newTab") }),
      };
      break;
    case "back":
    case "go_back":
      candidate = { type: "back" };
      break;
    case "switchTab":
    case "switch_tab":
      candidate = { type: "switchTab", tabId: field("tabId") };
      break;
    case "observe":
      candidate = { type, ...optionalTarget };
      break;
    case "wait":
      candidate = { type, ms: field("ms", "amount") };
      break;
    case "ask":
    case "ask_user":
    case "ask_confirmation":
      // A legacy pendingAction is deliberately not staged or executed by a question.
      candidate = { type: "ask", question: field("question", "text", "say") };
      break;
    case "finish":
      candidate = { type, summary: field("summary", "text", "say") };
      break;
    case "note":
      candidate = {
        type,
        text: raw.text,
        ...(field("excerpt") === undefined ? {} : { excerpt: field("excerpt") }),
      };
      break;
    case "plan":
    case "make_plan":
    case "show_plan":
      candidate = { type: "plan", goal: field("goal", "text"), steps: raw.steps };
      break;
    case "sketch": {
      if (raw.value != null && raw.value !== "add") return null;
      candidate = {
        type,
        title: field("title") ?? "HypeMan sketch",
        lines:
          field("lines") ?? (typeof raw.text === "string" ? raw.text.split(/\r?\n/) : undefined),
        ...(field("shapes") === undefined ? {} : { shapes: field("shapes") }),
      };
      break;
    }
    case "video": {
      const command = field("command", "value");
      const numeric =
        raw.command == null ? videoNumber(field("text"), page.video?.time) : field("value");
      candidate = { type, command, ...(numeric === undefined ? {} : { value: numeric }) };
      if ((command === "seek" || command === "speed") && numeric === undefined) return null;
      if (command === "speed" && (typeof numeric !== "number" || numeric < 0.25 || numeric > 4))
        return null;
      break;
    }
    case "pointer":
      candidate = {
        type,
        command: field("command"),
        target: target(),
        ...(target("toTarget", "toElementId") === undefined
          ? {}
          : { toTarget: target("toTarget", "toElementId") }),
      };
      break;
    case "hover":
    case "double_click":
    case "right_click":
    case "drag":
      candidate = {
        type: "pointer",
        command: {
          hover: "hover",
          double_click: "doubleClick",
          right_click: "rightClick",
          drag: "drag",
        }[type],
        target: target(),
        ...(target("toTarget", "toElementId") === undefined
          ? {}
          : { toTarget: target("toTarget", "toElementId") }),
      };
      break;
    case "look_up":
      candidate =
        typeof raw.text === "string" && raw.text.trim()
          ? {
              type: "navigate",
              url: `https://www.google.com/search?q=${encodeURIComponent(raw.text)}`,
              newTab: true,
            }
          : null;
      break;
    default:
      return null;
  }
  return parseAction(candidate);
}

function videoNumber(value: unknown, currentTime?: number): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const text = value.trim();
  if (/^[+-]\d+(?:\.\d+)?$/.test(text))
    return currentTime === undefined ? undefined : currentTime + Number(text);
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (!/^\d{1,3}:\d{2}(?::\d{2})?$/.test(text)) return undefined;
  const parts = text.split(":").map(Number);
  if (parts.slice(1).some((part) => part >= 60)) return undefined;
  return parts.reduce((seconds, part) => seconds * 60 + part, 0);
}
