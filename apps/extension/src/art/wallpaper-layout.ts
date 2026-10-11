import { LAYOUT, SCENE_H, SCENE_W, type Rect } from "../../../../scripts/art/scene/constants";

export type WallpaperViewport = { x: number; y: number; scale: number };

/** One transform for painted entities, accessible buttons, and pointer hit testing. */
export function wallpaperRect(viewport: WallpaperViewport, rect: Rect): Rect {
  return {
    x: viewport.x + rect.x * viewport.scale,
    y: viewport.y + rect.y * viewport.scale,
    w: rect.w * viewport.scale,
    h: rect.h * viewport.scale,
  };
}

export function wallpaperPoint(viewport: WallpaperViewport, x: number, y: number) {
  return { x: (x - viewport.x) / viewport.scale, y: (y - viewport.y) / viewport.scale };
}

/** Keep the search field and its shadow clear of the clock sign at every size. */
export function wallpaperSearch(width: number, height: number, viewport: WallpaperViewport): Rect {
  const margin = 16, gap = 16, h = 54;
  let w = Math.min(640, Math.max(1, width - margin * 2));
  let x = (width - w) / 2;
  let y = Math.min(160, Math.max(32, height * 0.15));
  const sign = wallpaperRect(viewport, LAYOUT.jumbotron);
  if (x < sign.x + sign.w + gap && x + w + gap > sign.x && y < sign.y + sign.h + gap && y + h + gap > sign.y) {
    const right = sign.x + sign.w + gap;
    const available = width - margin - right;
    if (available >= 240) { w = Math.min(w, available); x = Math.max(x, right); }
    else y = sign.y + sign.h + gap;
  }
  return { x, y, w, h };
}

/** Clouds travel over the complete viewport, independent of scenery tile seams. */
export function wallpaperClouds(width: number, scale: number, time: number) {
  const padding = 58 * scale;
  const period = width + padding * 2;
  const drift = Math.floor(time * 0.002) * scale;
  return [
    { fraction: 0.08, shape: 0, y: 6 },
    { fraction: 0.36, shape: 2, y: 26 },
    { fraction: 0.86, shape: 0, y: 6 },
  ].map(track => ({
    shape: track.shape,
    x: ((width * track.fraction + padding + drift) % period) - padding,
    y: 12 + track.y * scale,
  }));
}

/** Fit the complete scene using square pixels at the current display density. */
export function wallpaperLayout(width: number, height: number, density: number) {
  const dpr = Number.isFinite(density) && density > 0 ? density : 1;
  const fit = Math.min(width / SCENE_W, height / SCENE_H);
  // Scale once in the display-sized canvas; CSS must not enlarge a tiny buffer.
  // Keep the exact fit so fractional display scaling does not shrink the scene.
  const scale = fit;
  return {
    width: Math.max(1, Math.round(width * dpr)),
    height: Math.max(1, Math.round(height * dpr)),
    viewport: { x: (width - SCENE_W * scale) / 2, y: height - SCENE_H * scale, scale },
  };
}

/** Alternate reflected scenery tiles so neighboring edges meet without a seam. */
export function wallpaperTiles(width: number, x: number, scale: number) {
  const tileWidth = SCENE_W * scale;
  const tiles: { x: number; mirrored: boolean }[] = [];
  for (let index = Math.floor(-x / tileWidth); index < Math.ceil((width - x) / tileWidth); index++) {
    tiles.push({ x: x + index * tileWidth, mirrored: Math.abs(index) % 2 === 1 });
  }
  return tiles;
}
