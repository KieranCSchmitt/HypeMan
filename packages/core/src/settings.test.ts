import { describe, expect, it } from "vitest";
import { AVATAR_SKINS, parseSettings } from "./settings";

describe("avatar skin settings", () => {
  it("preserves every installed skin across settings reads and imports", () => {
    for (const avatarSkin of AVATAR_SKINS) expect(parseSettings({ avatarSkin }).avatarSkin).toBe(avatarSkin);
  });
  it("keeps existing installations and invalid imports on the original HypeMan", () => {
    for (const value of [undefined, {}, { avatarSkin: "missing" }, { avatarSkin: "../../other" }]) expect(parseSettings(value).avatarSkin).toBe("hypeman");
  });
});
