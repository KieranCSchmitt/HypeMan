import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaceFileAtomically } from "./atomic-file";

describe("atomic state replacement", () => {
  it("preserves the old state through a Windows lock and then commits the replacement", () => {
    const directory = mkdtempSync(join(tmpdir(), "hypeman-atomic-"));
    const old = join(directory, "state.json"), next = join(directory, "state.tmp");
    writeFileSync(old, "previous"); writeFileSync(next, "updated");
    let attempts = 0;
    const wait = vi.fn(() => expect(readFileSync(old, "utf8")).toBe("previous"));
    try {
      replaceFileAtomically(next, old, { platform: "win32", wait, rename: (source, destination) => {
        if (++attempts < 3) throw Object.assign(new Error("temporary lock"), { code: "EPERM" });
        renameSync(source, destination);
      } });
      expect(attempts).toBe(3); expect(wait.mock.calls.flat()).toEqual([10, 20]);
      expect(readFileSync(old, "utf8")).toBe("updated");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it("bounds persistent locks and never converts them into success", () => {
    const error = Object.assign(new Error("locked"), { code: "EBUSY" });
    const rename = vi.fn(() => { throw error; }), wait = vi.fn();
    expect(() => replaceFileAtomically("new", "old", { platform: "win32", rename, wait })).toThrow(error);
    expect(rename).toHaveBeenCalledTimes(6); expect(wait.mock.calls.flat()).toEqual([10, 20, 40, 80, 160]);
  });
  it("does not retry permanent errors or non-Windows permission failures", () => {
    for (const [platform, code] of [["win32", "ENOENT"], ["linux", "EPERM"]] as const) {
      const error = Object.assign(new Error("denied"), { code });
      const rename = vi.fn(() => { throw error; }), wait = vi.fn();
      expect(() => replaceFileAtomically("new", "old", { platform, rename, wait })).toThrow(error);
      expect(rename).toHaveBeenCalledTimes(1); expect(wait).not.toHaveBeenCalled();
    }
  });
});
