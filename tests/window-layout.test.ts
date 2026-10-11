import { describe, expect, it } from "vitest";
import { initialWindow } from "../apps/extension/src/ui/window-layout";
describe("floating tools leave chat reachable", () => {
  it.each([1024, 1280, 1440])("fits a document beside chat at width %i", (width) => {
    const chat = { left: width - 368, top: 300, width: 340, height: 360 };
    const tool = initialWindow("documents", { x: 0, y: 0, width, height: 800 }, chat);
    expect(tool.x + tool.width).toBeLessThanOrEqual(chat.left - 18);
    expect(tool.x).toBeGreaterThanOrEqual(12); expect(tool.width).toBeGreaterThanOrEqual(360);
  });
  it.each([320, 736])("stacks above compact chat at width %i", (width) => {
    const chat = { left: Math.max(12, width - 368), top: 515, width: Math.min(340, width - 24), height: 180 };
    const tool = initialWindow("board", { x: 0, y: 0, width, height: 800 }, chat);
    expect(tool.y + tool.height).toBeLessThanOrEqual(chat.top - 12);
    expect(tool.x + tool.width).toBeLessThanOrEqual(width - 12);
  });
});
