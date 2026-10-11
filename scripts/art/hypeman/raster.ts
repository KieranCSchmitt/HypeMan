import { FRAME_H, FRAME_W, type Frame } from './frames';
import { MARKERS, RGB_BY_KEY, TRANSPARENT } from './palette';

/** A plain RGBA bitmap, usable in Node (PNG export) and the browser (ImageData). */
export interface Bitmap {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function createBitmap(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Throws with a precise location if a matrix is the wrong size or uses an unknown key. */
export function validateFrame(frame: Frame, label: string, width = FRAME_W, height = FRAME_H): void {
  if (frame.length !== height) {
    throw new Error(`${label}: expected ${height} rows, found ${frame.length}`);
  }
  frame.forEach((row, y) => {
    if (row.length !== width) {
      throw new Error(`${label}: row ${y} is ${row.length} px wide, expected ${width}`);
    }
    for (let x = 0; x < row.length; x++) {
      const key = row[x];
      if (key !== TRANSPARENT && !(key in RGB_BY_KEY) && !(key in MARKERS)) {
        throw new Error(`${label}: unknown palette key "${key}" at x=${x}, y=${y}`);
      }
    }
  });
}

/** Paints a character matrix into a bitmap at (ox, oy). Returns marker positions, frame-relative. */
export function paintMatrix(
  target: Bitmap,
  matrix: readonly string[],
  ox = 0,
  oy = 0,
): Record<string, [number, number]> {
  const anchors: Record<string, [number, number]> = {};
  for (let y = 0; y < matrix.length; y++) {
    const row = matrix[y];
    for (let x = 0; x < row.length; x++) {
      let key = row[x];
      if (key === TRANSPARENT) continue;
      const marker = MARKERS[key];
      if (marker) {
        anchors[marker.anchor] = [x, y];
        key = marker.paintsAs;
      }
      const tx = ox + x;
      const ty = oy + y;
      if (tx < 0 || ty < 0 || tx >= target.width || ty >= target.height) continue;
      const rgb = RGB_BY_KEY[key];
      const i = (ty * target.width + tx) * 4;
      target.data[i] = rgb[0];
      target.data[i + 1] = rgb[1];
      target.data[i + 2] = rgb[2];
      target.data[i + 3] = 255;
    }
  }
  return anchors;
}

/** Nearest-neighbour integer upscale. */
export function scaleBitmap(source: Bitmap, scale: number): Bitmap {
  const out = createBitmap(source.width * scale, source.height * scale);
  for (let y = 0; y < out.height; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < out.width; x++) {
      const si = (sy * source.width + Math.floor(x / scale)) * 4;
      const di = (y * out.width + x) * 4;
      out.data[di] = source.data[si];
      out.data[di + 1] = source.data[si + 1];
      out.data[di + 2] = source.data[si + 2];
      out.data[di + 3] = source.data[si + 3];
    }
  }
  return out;
}
