// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Pet } from "../apps/extension/src/ui/Pet";

vi.mock("../apps/extension/src/ui/hooks", () => ({
  useReducedMotion: () => true,
  message: (error: unknown) => error instanceof Error ? error.message : String(error),
}));

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => `chrome-extension://hypeman/${path}` },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("native HypeMan character layout", () => {
  it("displays the complete atlas frame at its native aspect ratio", async () => {
    await act(async () => root.render(createElement(Pet, { scale: 2, still: true })));
    const pet = container.querySelector<HTMLElement>(".hypeman-pet")!;
    const tile = pet.firstElementChild as HTMLElement;
    expect(pet.className).toBe("hypeman-pet");
    expect([pet.style.width, pet.style.height]).toEqual(["96px", "128px"]);
    expect([tile.style.width, tile.style.height, tile.style.left]).toEqual(["96px", "128px", "0px"]);
  });

});
