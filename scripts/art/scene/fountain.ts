/**
 * The rooftop fountain: a wide basin, a stem, and a small upper bowl the jet
 * rises from. It stands on the open floor in front of the gap between the
 * two wall planters and tops out just below the messenger window.
 *
 * This is the drawing code the sprites in this folder were rendered from.
 * It is written to sit in the HypeMan repo at scripts/art/scene/fountain.ts:
 * call drawFountainStone where the rooftop's static art is baked, and
 * drawFountain every frame in place of the reflecting pool.
 *
 * Colours are palette keys (see scripts/art/hypeman/palette.ts), one set per
 * time-of-day phase. Only the day set has been looked at in the scene.
 */
import type { Surface } from './surface';
import type { Phase } from './timeOfDay';

/** Centre line and key rows, in the 480x270 scene. */
export const FOUNTAIN = { x: 311, jetTop: 194, bowlY: 208, basinY: 228 };

/** The water steps every 130 ms and the whole motion repeats after 12 steps. */
export const FOUNTAIN_FRAME_MS = 130;
export const FOUNTAIN_FRAMES = 12;

export interface FountainColours {
  /** The glossy stone: lit edge, body, and the side in shade. */
  gloss: string;
  body: string;
  lo: string;
  /** The water in the bowls and the bright band of sky it reflects. */
  water: string;
  band: string;
  /** The water in the air, its lit side, and the foam where it lands. */
  spray: string;
  sprayHi: string;
  foam: string;
}

export const FOUNTAIN_COLOURS: Record<Phase, FountainColours> = {
  dawn: { gloss: 'w', body: 'W', lo: 'M', water: 'A', band: 'H', spray: 'A', sprayHi: 'C', foam: 'w' },
  day: { gloss: 'w', body: 'W', lo: 'M', water: 'A', band: 'C', spray: 'A', sprayHi: 'C', foam: 'w' },
  dusk: { gloss: 'W', body: 'M', lo: 'D', water: 'U', band: 'V', spray: 'U', sprayHi: 'I', foam: 'Y' },
  night: { gloss: 'M', body: 'D', lo: 'N', water: 'N', band: 'U', spray: 'B', sprayHi: 'I', foam: 'C' },
};

/** The stonework and the still water in its bowls. It never changes, so bake it with the rooftop. */
export function drawFountainStone(surface: Surface, phase: Phase): void {
  const { gloss, body, lo, water, band } = FOUNTAIN_COLOURS[phase];
  const cx = FOUNTAIN.x;
  const uy = FOUNTAIN.bowlY;
  const by = FOUNTAIN.basinY;
  const stemTop = uy + 5;
  const stemHeight = by + 5 - stemTop;
  const run = (y: number, half: number, ink: string) => surface.rect(cx - half, y, half * 2, 1, ink);

  // Every piece of stone as a run centred on the fountain: [row, half-width, ink].
  const stone: [number, number, string][] = [
    // Upper bowl: far rim, lit front lip, then the underside.
    [uy, 9, gloss],
    [uy + 1, 11, gloss],
    [uy + 2, 10, body],
    [uy + 3, 7, body],
    [uy + 4, 4, lo],
    // Basin: far rim widening to the lit front lip, the underside curving in, and a foot.
    [by, 22, gloss],
    [by + 1, 27, gloss],
    [by + 2, 30, gloss],
    [by + 3, 30, gloss],
    [by + 4, 30, gloss],
    [by + 5, 30, gloss],
    [by + 6, 30, body],
    [by + 7, 29, body],
    [by + 8, 27, body],
    [by + 9, 24, body],
    [by + 10, 19, lo],
    [by + 11, 8, body],
    [by + 12, 11, lo],
  ];

  // An outline first, one pixel proud of every piece, so it reads on any floor.
  for (const [y, half] of stone) surface.rect(cx - half - 1, y - 1, half * 2 + 2, 3, 'K');
  surface.rect(cx - 3, stemTop, 6, stemHeight, 'K');
  for (const [y, half, ink] of stone) run(y, half, ink);

  // Still water in both bowls, with the bright band of sky it reflects.
  run(uy, 7, band);
  run(by + 1, 24, band);
  for (let y = by + 2; y <= by + 4; y++) run(y, 27, water);
  surface.shade(cx - 26, by + 2, 52, 1, band, 8);

  // The key light is top-left, so the right-hand side of everything is in shade.
  surface.rect(cx + 6, uy + 2, 4, 1, lo);
  surface.rect(cx + 4, uy + 3, 3, 1, lo);
  surface.rect(cx + 27, by + 2, 3, 3, lo);
  [30, 29, 27, 24].forEach((half, i) => surface.rect(cx + half - 7, by + 6 + i, 7, 1, lo));

  // Stem, standing in the basin, with a collar halfway up.
  surface.rect(cx - 2, stemTop, 4, stemHeight, body);
  surface.rect(cx - 2, stemTop, 1, stemHeight, gloss);
  surface.rect(cx + 1, stemTop, 1, stemHeight, lo);
  surface.rect(cx - 3, stemTop + 6, 6, 1, gloss);
  surface.rect(cx - 3, stemTop + 7, 6, 1, lo);
}

/**
 * The fountain's water in motion: a jet with a flickering tip, droplets
 * arcing back into the upper bowl, two streams spilling over into the
 * basin, and the splash and ripples where they land. `still` freezes it
 * on its first frame, for prefers-reduced-motion.
 */
export function drawFountain(surface: Surface, phase: Phase, t: number, still = false): void {
  const { band, spray, sprayHi, foam } = FOUNTAIN_COLOURS[phase];
  const cx = FOUNTAIN.x;
  const frame = still ? 0 : Math.floor(t / FOUNTAIN_FRAME_MS);
  const flick = frame % 2;

  // The jet: two pixels wide, lit on its left.
  const tip = FOUNTAIN.jetTop + flick;
  surface.rect(cx - 1, tip, 2, FOUNTAIN.bowlY - tip, spray);
  surface.rect(cx - 1, tip, 1, FOUNTAIN.bowlY - tip, sprayHi);
  surface.px(cx - 1 + flick, tip - 1, foam);

  // Droplets fall away from the tip in two arcs, marching outward.
  for (let k = 1; k <= 6; k++) {
    const step = (k + frame) % 3;
    if (step === 0) continue;
    const y = FOUNTAIN.jetTop + 1 + Math.round(k * k * 0.3);
    surface.px(cx - 1 - k, y, step === 1 ? sprayHi : spray);
    surface.px(cx + k, y, step === 1 ? sprayHi : spray);
  }

  // Two streams spill from the upper bowl into the basin.
  const landing = FOUNTAIN.basinY + 2;
  for (const x of [cx - 10, cx + 9]) {
    for (let y = FOUNTAIN.bowlY + 2; y < landing; y++) {
      const step = (y - frame) & 3;
      if (step !== 3) surface.px(x, y, step === 0 ? sprayHi : spray);
    }
    if (flick) {
      surface.rect(x - 1, landing, 3, 1, foam);
    } else {
      surface.px(x - 2, landing, foam);
      surface.px(x + 2, landing, foam);
    }
  }

  // Ripples spreading across the basin.
  for (let i = 0; i < 5; i++) {
    const rx = cx - 24 + ((i * 13 + flick * 4) % 44);
    surface.rect(rx, landing + 1 + (i % 2), 3, 1, i % 2 ? band : foam);
  }
}
