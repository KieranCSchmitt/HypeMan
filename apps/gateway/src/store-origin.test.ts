import { describe, expect, it } from "vitest";
import { HYPEMAN_EXTENSION_ORIGIN } from "@core";
import { firstPartyExtension } from "./security";

describe("published extension connection identity", () => {
  const storeId = "abcdefghijklmnopabcdefghijklmnop";
  it("continues to accept the pinned development extension", () => {
    expect(firstPartyExtension(HYPEMAN_EXTENSION_ORIGIN, {})).toBe(true);
  });
  it("accepts only the exact configured store origin", () => {
    const env = { HYPEMAN_STORE_EXTENSION_ID: storeId };
    expect(firstPartyExtension(`chrome-extension://${storeId}`, env)).toBe(true);
    for (const origin of [undefined, "https://example.com", `chrome-extension://${storeId}/`, `chrome-extension://${storeId}.evil.example`, `chrome-extension://${"a".repeat(32)}`])
      expect(firstPartyExtension(origin, env)).toBe(false);
  });
  it("fails closed for invalid configuration", () => {
    for (const id of ["*", "https://example.com", "chrome-extension://" + storeId, "z".repeat(32), "a".repeat(31), "a".repeat(33)])
      expect(firstPartyExtension(`chrome-extension://${storeId}`, { HYPEMAN_STORE_EXTENSION_ID: id })).toBe(false);
  });
});
