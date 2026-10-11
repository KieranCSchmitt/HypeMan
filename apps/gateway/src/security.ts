import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IncomingMessage } from "node:http";
import { HYPEMAN_EXTENSION_ORIGIN } from "@core";

export function validToken(given: unknown, expected: string): boolean {
  if (typeof given !== "string" || !given || !expected) return false;
  const a = Buffer.from(given),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function authenticated(req: IncomingMessage, token: string): boolean {
  const match = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? "");
  return validToken(match?.[1], token);
}
/** Browser-controlled Origin is required to discover the local connection secret.
 * CLI requests without an Origin and ordinary web/other extension origins do not qualify.
 */
export function firstPartyExtension(origin: string | undefined): boolean {
  return origin === HYPEMAN_EXTENSION_ORIGIN;
}
/** No Origin is allowed for local CLI clients; browser requests must identify a trusted origin. */
export function allowedOrigin(origin: string | undefined, port: number): boolean {
  if (!origin) return true;
  if (/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return true;
  return origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`;
}
export function allowedHost(host: string | undefined, port: number): boolean {
  return host === `localhost:${port}` || host === `127.0.0.1:${port}`;
}
/** Local-only pairing secret, never included in health responses or model context. */
export function loadPairingToken(
  env: NodeJS.ProcessEnv = process.env,
  directory = process.cwd(),
): string {
  const configuredName = "HYPEMAN_TOKEN";
  const configured = env[configuredName]?.trim();
  if (configured) {
    if (!/^[\x21-\x7e]{16,256}$/.test(configured))
      throw new Error(`${configuredName} must be 16–256 printable non-space characters.`);
    return configured;
  }
  const read = (name: string): string | undefined => {
    const path = resolve(directory, name);
    try {
      const info = lstatSync(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1024)
        throw new Error(`Invalid ${name}. Expected a private token file.`);
      const token = readFileSync(path, "utf8").trim();
      if (!/^[a-f0-9]{64}$/.test(token))
        throw new Error(`Invalid ${name}. Remove it to generate a new pairing token.`);
      chmodSync(path, 0o600);
      return token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  };
  const current = read(".hypeman-token");
  if (current) return current;
  const token = randomBytes(32).toString("hex");
  const path = resolve(directory, ".hypeman-token");
  try {
    writeFileSync(path, `${token}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    // Another gateway may have initialized the new location in the meantime.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const initialized = read(".hypeman-token");
    if (initialized) return initialized;
    throw error;
  }
  return token;
}
