/**
 * The HypeMan palette. Every pixel in every sprite matrix and every scene
 * layer is one of these swatches, addressed by a single character.
 *
 * Teal skies, glass highlights, peach accents, and clothing tones share
 * stable keys so the character and rooftop use one consistent palette.
 */

export interface Swatch {
  name: string;
  hex: string;
}

export const PALETTE = {
  K: { name: 'Outline', hex: '#0B1C2C' },
  N: { name: 'Deep teal night', hex: '#0E2F4A' },
  // --- character ---
  J: { name: 'Jersey black', hex: '#16161C' },
  j: { name: 'Mesh black', hex: '#26262E' },
  d: { name: 'Denim black', hex: '#2A2C36' },
  f: { name: 'Denim fade', hex: '#464A5C' },
  T: { name: 'Thermal cream', hex: '#F2E8D5' },
  t: { name: 'Thermal shade', hex: '#D9CCB4' },
  O: { name: 'Boot wheat', hex: '#C9A15A' },
  o: { name: 'Boot shadow', hex: '#8A6A34' },
  S: { name: 'Skin light', hex: '#B07650' },
  s: { name: 'Skin mid', hex: '#8D5A3B' },
  x: { name: 'Skin shadow', hex: '#6B4129' },
  // --- chrome and glass ---
  W: { name: 'Chrome light', hex: '#E6E6EE' },
  M: { name: 'Chrome mid', hex: '#A7A9BE' },
  D: { name: 'Chrome dark', hex: '#5C5F78' },
  I: { name: 'Ice', hex: '#9EF0FF' },
  C: { name: 'Cyber cyan', hex: '#00E5FF' },
  w: { name: 'Gloss white', hex: '#FFFFFF' },
  // --- sky ---
  U: { name: 'Sky deep', hex: '#1E7FD8' },
  B: { name: 'Sky mid', hex: '#4FB3F6' },
  p: { name: 'Sky pale', hex: '#A8DCFF' },
  h: { name: 'Haze', hex: '#E6F6FF' },
  c: { name: 'Cloud shade', hex: '#CFE6F7' },
  // --- water and nature ---
  A: { name: 'Water teal', hex: '#19A7B8' },
  L: { name: 'Leaf green', hex: '#9BE36A' },
  G: { name: 'Grass green', hex: '#5CC83B' },
  F: { name: 'Forest green', hex: '#2E8B3E' },
  // --- warm accents ---
  Y: { name: 'Sun glow', hex: '#FFF3B0' },
  H: { name: 'Peach', hex: '#FFB38A' },
  V: { name: 'Lavender', hex: '#B9A7F0' },
} as const satisfies Record<string, Swatch>;

export type PaletteKey = keyof typeof PALETTE;

/** A transparent pixel in a sprite matrix. */
export const TRANSPARENT = '.';

/**
 * Marker pixels: they paint as an ordinary swatch, and the exporter also
 * records where they sit in each frame so the runtime can find them.
 *   a  the flip phone's antenna tip
 */
export const MARKERS: Record<string, { paintsAs: PaletteKey; anchor: string }> = {
  a: { paintsAs: 'D', anchor: 'antenna' },
};

/**
 * Glass. Looking through a pane, each colour shows as its lighter, bluer
 * neighbour. Translucent surfaces are drawn by passing the pixels beneath
 * them through this table, never by alpha blending, so nothing on screen
 * ever leaves the palette.
 */
export const GLASS: Record<PaletteKey, PaletteKey> = {
  // the blue ramp climbs one step
  K: 'N',
  N: 'U',
  U: 'B',
  B: 'p',
  p: 'h',
  h: 'w',
  w: 'w',
  // darks lift into the ramp
  J: 'N',
  j: 'N',
  d: 'N',
  f: 'U',
  D: 'B',
  x: 'U',
  o: 'U',
  F: 'A',
  // mids cool off
  M: 'p',
  s: 'B',
  S: 'p',
  O: 'p',
  A: 'C',
  G: 'I',
  // lights go to ice and haze
  W: 'h',
  c: 'h',
  I: 'h',
  C: 'I',
  T: 'h',
  t: 'c',
  L: 'I',
  Y: 'h',
  H: 'c',
  V: 'p',
};

export type RGB = readonly [number, number, number];

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const RGB_BY_KEY: Record<string, RGB> = Object.fromEntries(
  Object.entries(PALETTE).map(([key, swatch]) => [key, hexToRgb(swatch.hex)]),
);

export function hex(key: PaletteKey): string {
  return PALETTE[key].hex;
}
