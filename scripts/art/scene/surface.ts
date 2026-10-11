import { PALETTE, RGB_BY_KEY, TRANSPARENT, type PaletteKey } from '../hypeman/palette';
import { createBitmap, paintMatrix, type Bitmap } from '../hypeman/raster';
import type { Rect } from './constants';

/**
 * An ink is one palette key ('C') or two keys ('CI') for a 1px checker of
 * both. Checkers are how the scene gets in-between tones without leaving
 * the palette.
 */
export type Ink = string;

const BAYER2 = [
  [0, 2],
  [3, 1],
];

export const BAYER4: number[][] = [0, 1, 2, 3].map((y) =>
  [0, 1, 2, 3].map((x) => 4 * BAYER2[y % 2][x % 2] + BAYER2[y >> 1][x >> 1]),
);

export const BAYER8: number[][] = Array.from({ length: 8 }, (_, y) =>
  Array.from({ length: 8 }, (_, x) => 4 * BAYER4[y % 4][x % 4] + BAYER2[y >> 2][x >> 2]),
);

export function keyAt(ink: Ink, x: number, y: number): string {
  return ink.length === 1 ? ink : ink[(x + y) & 1];
}

/** Deterministic 0..1 noise from integer coordinates. */
export function hash(a: number, b = 0, c = 0): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function bitmapToCanvas(bitmap: Bitmap): HTMLCanvasElement {
  const canvas = createCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(bitmap.width, bitmap.height);
  image.data.set(bitmap.data);
  ctx.putImageData(image, 0, 0);
  return canvas;
}

// --- fill styles -----------------------------------------------------------

const styleCache = new Map<string, string | CanvasPattern>();
let patternContext: CanvasRenderingContext2D | null = null;

function patternFrom(size: number, at: (x: number, y: number) => string | null): CanvasPattern {
  const tile = createCanvas(size, size);
  const ctx = tile.getContext('2d')!;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const key = at(x, y);
      if (!key) continue;
      ctx.fillStyle = PALETTE[key as PaletteKey].hex;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  patternContext ??= createCanvas(1, 1).getContext('2d')!;
  return patternContext.createPattern(tile, 'repeat')!;
}

function inkStyle(ink: Ink): string | CanvasPattern {
  let style = styleCache.get(ink);
  if (!style) {
    style = ink.length === 1 ? PALETTE[ink as PaletteKey].hex : patternFrom(2, (x, y) => keyAt(ink, x, y));
    styleCache.set(ink, style);
  }
  return style;
}

/** `key` on `level`/16 of the pixels, in a 4x4 ordered dither. The rest stay untouched. */
function shadeStyle(key: string, level: number): CanvasPattern {
  const id = `shade:${key}:${level}`;
  let style = styleCache.get(id) as CanvasPattern | undefined;
  if (!style) {
    style = patternFrom(4, (x, y) => (BAYER4[y][x] < level ? key : null));
    styleCache.set(id, style);
  }
  return style;
}

/** An opaque mask covering `level`/64 of the pixels, used for palette-safe dissolves. */
function dissolveMask(level: number): CanvasPattern {
  const id = `mask:${level}`;
  let style = styleCache.get(id) as CanvasPattern | undefined;
  if (!style) {
    style = patternFrom(8, (x, y) => (BAYER8[y][x] < level ? 'K' : null));
    styleCache.set(id, style);
  }
  return style;
}

// --- the gloss recipe ---------------------------------------------------------

/**
 * How a glossy panel is shaded. The key light is top-left: a gloss band
 * near the top, one lighter row beneath it, one darker row along the bottom.
 */
export interface Gloss {
  body: string;
  band: string;
  light: string;
  lo: string;
  outline: string;
  /** Pixels knocked off each corner. Default 2. */
  radius?: number;
  /** First interior row of the gloss band. Default: about a sixth of the way down. */
  bandTop?: number;
  bandHeight?: number;
}

/**
 * The palette key at (x, y) of a glossy, round-cornered panel of w x h
 * pixels (outline included), or null outside it.
 */
export function glossKeyAt(x: number, y: number, w: number, h: number, gloss: Gloss): string | null {
  const radius = gloss.radius ?? 2;
  const inside = (px: number, py: number) => {
    if (px < 0 || py < 0 || px >= w || py >= h) return false;
    return Math.min(px, w - 1 - px) + Math.min(py, h - 1 - py) >= radius;
  };
  if (!inside(x, y)) return null;
  if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) return gloss.outline;
  const row = y - 1;
  const rows = h - 2;
  const bandTop = gloss.bandTop ?? Math.max(1, Math.round(rows * 0.16));
  const bandHeight = gloss.bandHeight ?? (rows >= 16 ? 2 : 1);
  if (row >= bandTop && row < bandTop + bandHeight) return gloss.band;
  if (row === bandTop + bandHeight) return gloss.light;
  if (row === rows - 1) return gloss.lo;
  return gloss.body;
}

// --- sprites from matrices ---------------------------------------------------

/** Pads rows to a common width, so hand-drawn scene sprites cannot go ragged. */
export function sprite(...rows: string[]): readonly string[] {
  const width = Math.max(...rows.map((row) => row.length));
  return rows.map((row) => row.padEnd(width, '.'));
}

const spriteCache = new WeakMap<readonly string[], Map<string, HTMLCanvasElement>>();

/** Renders a character matrix to a canvas once, optionally swapping palette keys. */
export function spriteCanvas(matrix: readonly string[], remap?: Record<string, string>): HTMLCanvasElement {
  const id = remap ? Object.entries(remap).flat().join('') : '';
  let variants = spriteCache.get(matrix);
  if (!variants) spriteCache.set(matrix, (variants = new Map()));
  let canvas = variants.get(id);
  if (!canvas) {
    const rows = remap ? matrix.map((row) => [...row].map((key) => remap[key] ?? key).join('')) : matrix;
    const bitmap = createBitmap(matrix[0].length, matrix.length);
    paintMatrix(bitmap, rows);
    canvas = bitmapToCanvas(bitmap);
    variants.set(id, canvas);
  }
  return canvas;
}

/**
 * A canvas holding the 1px outline that hugs a silhouette. `solid` is
 * sampled over w x h; the result is 1px larger on every side. It works from
 * data the caller already has, so nothing is ever read back from a canvas.
 */
export function outlineCanvas(w: number, h: number, solid: (x: number, y: number) => boolean, key = 'C'): HTMLCanvasElement {
  const bitmap = createBitmap(w + 2, h + 2);
  const [r, g, b] = RGB_BY_KEY[key];
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && solid(x, y);
  for (let y = -1; y <= h; y++) {
    for (let x = -1; x <= w; x++) {
      if (at(x, y) || !(at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1))) continue;
      bitmap.data.set([r, g, b, 255], ((y + 1) * bitmap.width + x + 1) * 4);
    }
  }
  return bitmapToCanvas(bitmap);
}

const outlineCache = new WeakMap<readonly string[], HTMLCanvasElement[]>();

/** The outline of a sprite matrix, to be drawn 1px up and left of the sprite itself. */
export function matrixOutline(matrix: readonly string[], flip = false): HTMLCanvasElement {
  let pair = outlineCache.get(matrix);
  if (!pair) outlineCache.set(matrix, (pair = []));
  const w = matrix[0].length;
  return (pair[flip ? 1 : 0] ??= outlineCanvas(w, matrix.length, (x, y) => matrix[y][flip ? w - 1 - x : x] !== TRANSPARENT));
}

// --- pixel-exact text ----------------------------------------------------------

export type FontId = 'ps8' | 'ps16' | 'compact';

/**
 * Scene text uses fixed cells. The compact face fits each glyph to an 8px
 * cell so CRT columns and the caret stay aligned with the pixel grid.
 */
export const FONTS: Record<FontId, { css: string; height: number; baseline: number; advance: number }> = {
  ps8: { css: '8px "Press Start 2P", monospace', height: 8, baseline: 8, advance: 8 },
  ps16: { css: '16px "Press Start 2P", monospace', height: 16, baseline: 16, advance: 16 },
  compact: { css: '16px "Tiny5", monospace', height: 16, baseline: 12, advance: 8 },
};

const textCache = new Map<string, HTMLCanvasElement>();
const memo = new Map<string, Surface>();

/** Call when the web fonts finish loading so anything drawn in a fallback font is redrawn. */
export function clearTextCache(): void {
  textCache.clear();
  memo.clear();
}

/**
 * Renders art once per `key` and reuses it. Props use this for the parts of
 * themselves that only change between a handful of states, so a frame is
 * mostly blits.
 */
export function memoSurface(key: string, width: number, height: number, draw: (surface: Surface) => void): Surface {
  let surface = memo.get(key);
  if (!surface) {
    surface = new Surface(width, height);
    draw(surface);
    surface.offset(0, 0);
    memo.set(key, surface);
  }
  return surface;
}

export function textWidth(text: string, font: FontId): number {
  return [...text].length * FONTS[font].advance;
}

/**
 * Canvas text is anti-aliased even when the font sits on the pixel grid, so
 * each string is drawn once, thresholded to hard pixels, and cached.
 */
function textCanvas(text: string, font: FontId, key: string): HTMLCanvasElement {
  const id = `${font}|${key}|${text}`;
  let canvas = textCache.get(id);
  if (!canvas) {
    if (textCache.size > 600) textCache.clear();
    const spec = FONTS[font];
    canvas = createCanvas(Math.max(1, textWidth(text, font) + 2), spec.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.font = spec.css;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#000';
    if (font === 'compact') {
      [...text].forEach((letter, column) => {
        const width = Math.min(spec.advance, ctx.measureText(letter).width);
        ctx.fillText(letter, column * spec.advance + (spec.advance - width) / 2, spec.baseline, spec.advance);
      });
    } else ctx.fillText(text, 0, spec.baseline);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const [r, g, b] = RGB_BY_KEY[key];
    for (let i = 0; i < image.data.length; i += 4) {
      const on = image.data[i + 3] >= 128;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = on ? 255 : 0;
    }
    ctx.putImageData(image, 0, 0);
    textCache.set(id, canvas);
  }
  return canvas;
}

// --- the drawing surface ---------------------------------------------------------

/** A native-resolution canvas with palette-keyed, whole-pixel drawing calls. */
export class Surface {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

  constructor(
    readonly width: number,
    readonly height: number,
    canvas: HTMLCanvasElement = createCanvas(width, height),
  ) {
    this.canvas = canvas;
    canvas.width = width;
    canvas.height = height;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
  }

  clear(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  /** Shifts everything drawn afterwards by a whole number of pixels. */
  offset(x: number, y: number): void {
    this.ctx.setTransform(1, 0, 0, 1, Math.round(x), Math.round(y));
  }

  rect(x: number, y: number, w: number, h: number, ink: Ink): void {
    if (w <= 0 || h <= 0) return;
    this.ctx.fillStyle = inkStyle(ink);
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  px(x: number, y: number, key: string): void {
    this.rect(x, y, 1, 1, key);
  }

  /** A 1px rectangular outline. */
  frame(x: number, y: number, w: number, h: number, ink: Ink): void {
    this.rect(x, y, w, 1, ink);
    this.rect(x, y + h - 1, w, 1, ink);
    this.rect(x, y + 1, 1, h - 2, ink);
    this.rect(x + w - 1, y + 1, 1, h - 2, ink);
  }

  /** A 1px outline with the corner pixels left out. */
  roundFrame(x: number, y: number, w: number, h: number, ink: Ink): void {
    this.rect(x + 1, y, w - 2, 1, ink);
    this.rect(x + 1, y + h - 1, w - 2, 1, ink);
    this.rect(x, y + 1, 1, h - 2, ink);
    this.rect(x + w - 1, y + 1, 1, h - 2, ink);
  }

  /** The classic raised edge: light on the top and left, dark on the bottom and right. */
  bevel(x: number, y: number, w: number, h: number, light: Ink, dark: Ink): void {
    this.rect(x, y, w - 1, 1, light);
    this.rect(x, y + 1, 1, h - 2, light);
    this.rect(x + 1, y + h - 1, w - 1, 1, dark);
    this.rect(x + w - 1, y + 1, 1, h - 2, dark);
  }

  /** Ordered-dither `key` over whatever is there. `level` runs 0 (none) to 16 (solid). */
  shade(x: number, y: number, w: number, h: number, key: string, level: number): void {
    if (w <= 0 || h <= 0 || level <= 0) return;
    this.ctx.fillStyle = shadeStyle(key, Math.min(16, Math.round(level)));
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  /**
   * Per-pixel painting: replaces everything in `area`, leaving pixels
   * transparent where `at` returns null. Ignores `offset`. It never reads
   * the canvas back, so it is safe to call on a live frame.
   */
  paint(area: Rect, at: (x: number, y: number) => string | null): void {
    const image = this.ctx.createImageData(area.w, area.h);
    for (let y = 0; y < area.h; y++) {
      for (let x = 0; x < area.w; x++) {
        const key = at(area.x + x, area.y + y);
        if (!key) continue;
        const rgb = RGB_BY_KEY[key];
        const i = (y * area.w + x) * 4;
        image.data[i] = rgb[0];
        image.data[i + 1] = rgb[1];
        image.data[i + 2] = rgb[2];
        image.data[i + 3] = 255;
      }
    }
    this.ctx.putImageData(image, area.x, area.y);
  }

  blit(source: CanvasImageSource, x = 0, y = 0): void {
    this.ctx.drawImage(source, Math.round(x), Math.round(y));
  }

  sprite(matrix: readonly string[], x: number, y: number, options: { flip?: boolean; remap?: Record<string, string> } = {}): void {
    const image = spriteCanvas(matrix, options.remap);
    this.blitFlippable(image, 0, 0, image.width, image.height, x, y, options.flip);
  }

  /** Draws a region of a sheet, optionally mirrored, at a whole-pixel position. */
  blitFlippable(
    source: CanvasImageSource,
    sx: number,
    sy: number,
    w: number,
    h: number,
    x: number,
    y: number,
    flip = false,
  ): void {
    const dx = Math.round(x);
    const dy = Math.round(y);
    if (!flip) {
      this.ctx.drawImage(source, sx, sy, w, h, dx, dy, w, h);
      return;
    }
    this.ctx.save();
    this.ctx.translate(dx + w, dy);
    this.ctx.scale(-1, 1);
    this.ctx.drawImage(source, sx, sy, w, h, 0, 0, w, h);
    this.ctx.restore();
  }

  /** Draws text with its cell's top-left corner at (x, y). Returns the width in pixels. */
  text(text: string, x: number, y: number, font: FontId, key: string, align: 'left' | 'center' | 'right' = 'left'): number {
    const width = textWidth(text, font);
    if (!text) return 0;
    const left = align === 'left' ? x : align === 'center' ? x - Math.floor(width / 2) : x - width;
    this.ctx.drawImage(textCanvas(text, font, key), Math.round(left), Math.round(y));
    return width;
  }

}

/**
 * Cross-fades `from` into `to` without blending colours: an 8x8 ordered
 * dither decides, pixel by pixel, which of the two shows. `mix` is 0..1.
 */
export function dissolve(target: Surface, from: Surface, to: Surface, mix: number, scratch: Surface): void {
  target.clear();
  const level = Math.round(Math.min(1, Math.max(0, mix)) * 64);
  if (level <= 0) return target.blit(from.canvas);
  if (level >= 64) return target.blit(to.canvas);
  const mask = dissolveMask(level);

  target.blit(from.canvas);
  target.ctx.globalCompositeOperation = 'destination-out';
  target.ctx.fillStyle = mask;
  target.ctx.fillRect(0, 0, target.width, target.height);
  target.ctx.globalCompositeOperation = 'source-over';

  scratch.clear();
  scratch.blit(to.canvas);
  scratch.ctx.globalCompositeOperation = 'destination-in';
  scratch.ctx.fillStyle = mask;
  scratch.ctx.fillRect(0, 0, scratch.width, scratch.height);
  scratch.ctx.globalCompositeOperation = 'source-over';
  target.blit(scratch.canvas);
}
