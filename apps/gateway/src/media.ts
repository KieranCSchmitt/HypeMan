import { GatewayError } from "./errors";
export type JsonObject = Record<string, unknown>;
export const isObject = (value: unknown): value is JsonObject =>
  !!value && typeof value === "object" && !Array.isArray(value);
export const isText = (value: unknown, max = 20_000): value is string =>
  typeof value === "string" && value.length <= max;
export const isNumber = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
export const isImage = (value: unknown): value is string =>
  isText(value, 5_500_000) &&
  /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
export const isWebUrl = (value: unknown): value is string => {
  if (!isText(value, 8192)) return false;
  try {
    const parsed = new URL(value);
    return /^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
};
export function requireInput(
  valid: boolean,
  message = "Request contains missing, malformed, or oversized fields.",
): asserts valid {
  if (!valid) throw new GatewayError(400, message, "invalid_input");
}
export function requireObject(value: unknown): JsonObject {
  requireInput(isObject(value), "Expected a JSON object.");
  return value;
}
export function stringList(value: unknown, max = 100): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every((x) => isText(x, 2000));
}
