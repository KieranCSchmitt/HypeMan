import { describe, expect, it } from "vitest";
import { wallpaperLayout, wallpaperTiles, wallpaperRect, wallpaperPoint, wallpaperSearch, wallpaperClouds } from "./wallpaper-layout";
import { LAYOUT, SCENE_H, SCENE_W } from "../../../../scripts/art/scene/constants";

describe("wallpaper display fitting", () => {
  for (const [width, height] of [[1366, 768], [1920, 1080], [1440, 900], [2560, 1440], [3440, 1440], [390, 844], [800, 400]]) {
    for (const density of [1, 1.25, 1.5, 2, 3]) {
      it(`fits ${width}x${height} at ${density}x without distorting or clipping the scene`, () => {
        const layout = wallpaperLayout(width, height, density);
        const { x, y, scale } = layout.viewport;
        expect(layout.width).toBe(Math.round(width * density));
        expect(layout.height).toBe(Math.round(height * density));
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + SCENE_W * scale).toBeLessThanOrEqual(width);
        expect(y + SCENE_H * scale).toBeCloseTo(height);
        expect(scale).toBeCloseTo(Math.min(width / SCENE_W, height / SCENE_H));
      });
    }
  }
});

describe("continuous cloud movement", () => {
  for (const width of [390, 1366, 1920, 3440, 7680]) {
    it(`keeps clouds intact and evenly moving across ${width}px without tile seams`, () => {
      const { viewport: { scale } } = wallpaperLayout(width, 1080, 1.25);
      const initial = wallpaperClouds(width, scale, 0);
      const next = wallpaperClouds(width, scale, 1000);
      expect(initial[1].x - initial[0].x).toBeGreaterThan(58 * scale);
      expect(initial[2].x - initial[1].x).toBeGreaterThan(28 * scale);
      for (let index = 0; index < 3; index++) {
        expect(next[index].x - initial[index].x).toBeCloseTo(2 * scale);
        expect(next[index].y).toBe(initial[index].y);
      }
      const period = width + 116 * scale;
      for (let time = 0; time <= 1_000_000; time += 1000) {
        const now = wallpaperClouds(width, scale, time);
        const after = wallpaperClouds(width, scale, time + 1000);
        for (let index = 0; index < 3; index++) {
          const delta = after[index].x - now[index].x;
          expect((delta + period) % period).toBeCloseTo(2 * scale);
          if (delta < 0) {
            expect(now[index].x).toBeGreaterThanOrEqual(width);
            expect(after[index].x + 58 * scale).toBeLessThanOrEqual(2 * scale);
          }
        }
      }
    });
  }
});

describe("search sign clearance", () => {
  it("keeps the search field and shadow away from the sign across window shapes", () => {
    for (const width of [320, 390, 560, 800, 1036, 1366, 1920, 3440, 7680]) {
      for (const height of [300, 400, 525, 768, 844, 1080, 1440]) {
        const { viewport } = wallpaperLayout(width, height, 1.25);
        const sign = wallpaperRect(viewport, LAYOUT.jumbotron);
        const search = wallpaperSearch(width, height, viewport);
        expect(search.x).toBeGreaterThanOrEqual(0);
        expect(search.x + search.w).toBeLessThanOrEqual(width);
        expect(search.y + search.h).toBeLessThanOrEqual(height);
        const overlap = search.x < sign.x + sign.w + 10 && search.x + search.w + 10 > sign.x && search.y < sign.y + sign.h + 10 && search.y + search.h + 10 > sign.y;
        expect(overlap, `${width}x${height} search intersects clock sign`).toBe(false);
      }
    }
  });
});

describe("responsive entity spacing", () => {
  for (const [width, height] of [[390, 844], [800, 400], [1366, 768], [1440, 900], [1920, 1080], [3440, 1440], [7680, 1080]]) {
    it(`keeps entities visible, proportionally spaced and clickable at ${width}x${height}`, () => {
      for (const density of [1, 1.25, 1.5, 2, 3]) {
        const { viewport } = wallpaperLayout(width, height, density);
        const authored = {
          label: LAYOUT.graffiti, clock: LAYOUT.jumbotron, tv: LAYOUT.crt,
          pigeons: LAYOUT.pigeons, boombox: LAYOUT.boombox,
          avatar: { x: LAYOUT.homeX - 24, y: LAYOUT.walkY - 64, w: 48, h: 64 },
        };
        const mapped = Object.fromEntries(Object.entries(authored).map(([id, rect]) => [id, wallpaperRect(viewport, rect)]));
        for (const [id, rect] of Object.entries(mapped)) {
          expect(rect.x).toBeGreaterThanOrEqual(0);
          expect(rect.y).toBeGreaterThanOrEqual(0);
          expect(rect.x + rect.w).toBeLessThanOrEqual(width + 0.00001);
          expect(rect.y + rect.h).toBeLessThanOrEqual(height + 0.00001);
          expect(rect.w / rect.h).toBeCloseTo(authored[id as keyof typeof authored].w / authored[id as keyof typeof authored].h);
          const center = wallpaperPoint(viewport, rect.x + rect.w / 2, rect.y + rect.h / 2);
          const original = authored[id as keyof typeof authored];
          expect(center.x).toBeCloseTo(original.x + original.w / 2);
          expect(center.y).toBeCloseTo(original.y + original.h / 2);
        }
        expect(mapped.label.y - (mapped.clock.y + mapped.clock.h)).toBeCloseTo((LAYOUT.graffiti.y - LAYOUT.jumbotron.y - LAYOUT.jumbotron.h) * viewport.scale);
        expect(mapped.avatar.x).toBeGreaterThan(mapped.tv.x + mapped.tv.w);
        expect(mapped.boombox.x).toBeGreaterThan(mapped.avatar.x + mapped.avatar.w);
      }
    });
  }
});

describe("horizontal wallpaper repetition", () => {
  for (const width of [390, 1920, 3440, 7680, 20000]) {
    it(`covers a ${width}px window with full scenery tiles and no stretched edges`, () => {
      const { viewport: { x, scale } } = wallpaperLayout(width, 1080, 1.25);
      const tiles = wallpaperTiles(width, x, scale);
      const tileWidth = SCENE_W * scale;
      expect(tiles[0].x).toBeLessThanOrEqual(0);
      expect(tiles.at(-1)!.x + tileWidth).toBeGreaterThanOrEqual(width);
      for (let index = 1; index < tiles.length; index++) {
        expect(tiles[index].x).toBeCloseTo(tiles[index - 1].x + tileWidth);
        expect(tiles[index].mirrored).not.toBe(tiles[index - 1].mirrored);
      }
      expect(tiles.find(tile => tile.x === x)?.mirrored).toBe(false);
    });
  }
});
