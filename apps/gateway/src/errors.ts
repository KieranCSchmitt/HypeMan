export class GatewayError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "request_failed",
  ) {
    super(message);
  }
}
export const unavailable = (feature: string, variable: string): never => {
  throw new GatewayError(
    503,
    `${feature} needs ${variable}. Configure the local server, or explicitly set DEMO_MODE=1 for labeled fixtures.`,
    "capability_unavailable",
  );
};
export function abortSignal(parent: AbortSignal, milliseconds = 25_000): AbortSignal {
  return AbortSignal.any([parent, AbortSignal.timeout(milliseconds)]);
}
