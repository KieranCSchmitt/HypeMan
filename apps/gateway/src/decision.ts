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
/** Validate the provider's flat action contract and canonical injected actions at one boundary. */
export function adaptDecision(value: unknown, page: PageSnapshot): AdaptedDecision {
  if (
    !isRecord(value) ||
    (value.say != null && typeof value.say !== "string") ||
    (value.done !== undefined && typeof value.done !== "boolean")
  )
    throw invalid();
  const raw = isRecord(value.action)
    ? value.action
    : typeof value.action === "string"
      ? { ...value, type: value.action }
      : null;
  if (
    !raw ||
    [value, raw].some((fields) => ["x", "y", "toX", "toY"].some((key) => fields[key] != null))
  )
    throw invalid();
  // Providers may leave unused fields null; required fields still need valid values.
  const action = parseAction(
    Object.fromEntries(Object.entries(raw).filter(([, field]) => field !== null)),
  );
  if (!action) throw invalid();
  if (action.type === "video" && (action.command === "seek" || action.command === "speed")) {
    if (
      action.value === undefined ||
      (action.command === "speed" && (action.value < 0.25 || action.value > 4))
    )
      throw invalid();
  }
  if (action.type === "pointer" && action.command === "drag" && !action.toTarget) throw invalid();
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
