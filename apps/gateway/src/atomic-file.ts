import { renameSync } from "node:fs";

const delays = [10, 20, 40, 80, 160];
const transientWindowsErrors = new Set(["EPERM", "EACCES", "EBUSY"]);

/** Replace a private state file atomically. Windows scanners can briefly hold
 * the destination open; retry that lock without deleting the previous file.
 * Non-Windows and permanent errors still fail immediately.
 */
export function replaceFileAtomically(source: string, destination: string, options: {
  platform?: NodeJS.Platform;
  rename?: typeof renameSync;
  wait?: (milliseconds: number) => void;
} = {}): void {
  const windows = (options.platform ?? process.platform) === "win32";
  const rename = options.rename ?? renameSync;
  const wait = options.wait ?? (milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds));
  for (let attempt = 0; ; attempt++) {
    try { rename(source, destination); return; }
    catch (error) {
      if (!windows || !transientWindowsErrors.has((error as NodeJS.ErrnoException).code ?? "") || attempt >= delays.length) throw error;
      wait(delays[attempt]);
    }
  }
}
