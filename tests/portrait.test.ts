import { describe, expect, it } from "vitest";
import { PALETTE } from "../scripts/art/hypeman/palette";
import { LAYOUT } from "../scripts/art/scene/constants";
import { PORTRAIT_BOX } from "../scripts/art/scene/props";
import { PORTRAIT } from "../scripts/art/scene/sprites";

describe("portrait paste-up", () => {
  it("is a full 23x28 matrix drawn only from the scene palette", () => {
    expect(PORTRAIT).toHaveLength(28);
    for (const row of PORTRAIT) {
      expect(row).toHaveLength(23);
      for (const key of row) expect(PALETTE, `unknown palette key "${key}"`).toHaveProperty(key);
    }
  });
  it("sits on bare wall between the tag, the rabbit ears, and the television", () => {
    const shadow = 2;
    // The tag's art ends 22 rows below its origin; the set's casing starts a row above its body.
    expect(PORTRAIT_BOX.y).toBeGreaterThan(LAYOUT.graffiti.y + 3 + 22);
    expect(PORTRAIT_BOX.y + PORTRAIT_BOX.h + shadow).toBeLessThanOrEqual(LAYOUT.crt.y + 12);
    expect(PORTRAIT_BOX.x).toBeGreaterThanOrEqual(LAYOUT.leftWall.x);
    // The left ear's tip is 35px in from the set's left edge.
    expect(PORTRAIT_BOX.x + PORTRAIT_BOX.w + shadow).toBeLessThanOrEqual(LAYOUT.crt.x + 35);
  });
});
