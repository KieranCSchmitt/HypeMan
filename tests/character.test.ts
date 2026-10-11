// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DEFAULT_SETTINGS } from "@core";
import { Pet } from "../apps/extension/src/ui/Pet";
import { Customize } from "../apps/extension/src/ui/Customize";
import { CHARACTER_FRAME, renderCharacter } from "../apps/extension/src/ui/character-art";

vi.mock("../apps/extension/src/bridge", () => ({ request: vi.fn() }));
vi.mock("../apps/extension/src/ui/hooks", () => ({
  useReducedMotion: () => true,
  useSettings: () => ({ settings: DEFAULT_SETTINGS, patch: vi.fn(), error: "" }),
  message: (error: unknown) => error instanceof Error ? error.message : String(error),
}));

let root: Root, container: HTMLDivElement;
const getCharacters = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  getCharacters.mockReset().mockResolvedValue({ "hypeman.characters": [] });
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => `chrome-extension://hypeman/${path}` },
    storage: { local: { get: getCharacters } },
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

function pixelCanvas() {
  const { width, height } = CHARACTER_FRAME;
  const pixels = { data: new Uint8ClampedArray(width * height * 4), width, height };
  const ctx = {
    clearRect: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn(() => pixels),
    putImageData: vi.fn(), imageSmoothingEnabled: true,
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx, toDataURL: () => "data:image/png;base64,preview" };
  const paint = (x: number, y: number, value: number, alpha = 255) =>
    pixels.data.set([value, value, value, alpha], (y * width + x) * 4);
  const alpha = (x: number, y: number) => pixels.data[(y * width + x) * 4 + 3];
  const render = (sourceWidth = 420, sourceHeight = 580, removeBackground = true) =>
    renderCharacter(canvas as unknown as HTMLCanvasElement,
      { naturalWidth: sourceWidth, naturalHeight: sourceHeight } as HTMLImageElement,
      { zoom: 1, threshold: 0, removeBackground, colors: 8 });
  return { canvas, ctx, pixels, paint, alpha, render };
}

describe("native HypeMan character layout", () => {
  it("displays the complete atlas frame at its native aspect ratio", async () => {
    await act(async () => root.render(createElement(Pet, { scale: 2, still: true })));
    const pet = container.querySelector<HTMLElement>(".hypeman-pet")!;
    const tile = pet.firstElementChild as HTMLElement;
    expect(pet.className).toBe("hypeman-pet");
    expect([pet.style.width, pet.style.height]).toEqual(["96px", "128px"]);
    expect([tile.style.width, tile.style.height, tile.style.left]).toEqual(["96px", "128px", "0px"]);
  });

  it("contains existing custom images without forcing their pixels into the new aspect ratio", async () => {
    const image = "data:image/png;base64,existing-custom-image";
    getCharacters.mockResolvedValue({ "hypeman.characters": [{ id: "saved", name: "Saved", image }] });
    await act(async () => root.render(createElement(Pet, {
      scale: 2, settings: { ...DEFAULT_SETTINGS, character: "custom:saved" },
    })));
    const pet = container.querySelector<HTMLImageElement>("img.custom-pet")!;
    expect(pet.src).toBe(image);
    expect([pet.width, pet.height, pet.style.objectFit]).toEqual([96, 128, "contain"]);
  });

  it("uses the atlas dimensions and intrinsic aspect ratio in the maker preview", async () => {
    await act(async () => root.render(createElement(Customize)));
    const canvas = container.querySelector<HTMLCanvasElement>('canvas[aria-label="Pixel companion preview"]')!;
    expect([canvas.width, canvas.height, canvas.style.height]).toEqual([48, 64, "auto"]);
  });
});

describe("custom character pixels", () => {
  it("fits wide and tall uploads with equal padding in the native frame", () => {
    const art = pixelCanvas();
    art.render(420, 100, false);
    expect([art.canvas.width, art.canvas.height]).toEqual([48, 64]);
    expect(art.ctx.drawImage.mock.calls[0]!.slice(1)).toEqual([3, 27, 42, 10]);
    art.render(100, 580, false);
    expect(art.ctx.drawImage.mock.calls[1]!.slice(1)).toEqual([19, 3, 10, 58]);
    expect(art.ctx.getImageData).toHaveBeenCalledWith(0, 0, 48, 64);
  });

  it("removes connected background through the final row without erasing enclosed matching colors", () => {
    const art = pixelCanvas();
    for (let y = 0; y < 64; y++) for (let x = 0; x < 48; x++) art.paint(x, y, 255);
    for (let y = 20; y <= 40; y++) for (let x = 20; x <= 27; x++) art.paint(x, y, 0);
    for (let y = 22; y <= 38; y++) for (let x = 22; x <= 25; x++) art.paint(x, y, 255);
    art.render();
    expect([art.alpha(0, 0), art.alpha(0, 63), art.alpha(47, 63)]).toEqual([0, 0, 0]);
    expect([art.alpha(20, 20), art.alpha(23, 30)]).toEqual([255, 255]);
  });

  it("keeps opaque black artwork when the uploaded image already has a transparent background", () => {
    const art = pixelCanvas();
    art.paint(0, 30, 0);
    art.paint(1, 30, 0);
    art.render();
    expect([art.alpha(0, 30), art.alpha(1, 30), art.alpha(0, 31)]).toEqual([255, 255, 0]);
  });
});
