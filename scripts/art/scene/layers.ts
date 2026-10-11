/**
 * The backdrop: sky, far skyline and hills, the glass towers, and the
 * rooftop itself.
 *
 * Anything that never moves is rendered once per time-of-day phase and
 * cached; the per-frame functions blit those caches and add the moving
 * parts (stars, lens flare, clouds, the blimp, glinting panes, the pool).
 */
import { PALETTE, type PaletteKey } from '../hypeman/palette';
import { BLEED, BLIMP_PERIOD_MS, LAYOUT, SCENE_H, SCENE_W, rect, type Rect } from './constants';
import { BLIMP, CLOUDS, DISH, FLARE } from './sprites';
import { BAYER4, Surface, hash, keyAt } from './surface';
import { THEMES, type Phase, type Theme } from './timeOfDay';

const FULL_W = SCENE_W + BLEED * 2;
const FULL_H = SCENE_H + BLEED * 2;

const cache = new Map<string, Surface>();

function cached(name: string, phase: Phase, width: number, height: number, build: (surface: Surface, theme: Theme) => void): Surface {
  const id = `${name}:${phase}`;
  let surface = cache.get(id);
  if (!surface) {
    surface = new Surface(width, height);
    build(surface, THEMES[phase]);
    cache.set(id, surface);
  }
  return surface;
}

const live = new Map<string, { surface: Surface; step: number }>();

/**
 * For art that changes slowly (twinkling stars, glinting panes): redrawn
 * only when `step` ticks over, and blitted on every other frame.
 */
function stepped(name: string, phase: Phase, step: number, draw: (surface: Surface, theme: Theme) => void): Surface {
  const id = `${name}:${phase}`;
  let entry = live.get(id);
  if (!entry) live.set(id, (entry = { surface: new Surface(FULL_W, FULL_H), step: NaN }));
  if (entry.step !== step) {
    entry.step = step;
    entry.surface.clear();
    entry.surface.offset(BLEED, BLEED);
    draw(entry.surface, THEMES[phase]);
  }
  return entry.surface;
}

/** A disc whose pixels are shaded as if lit from the top-left. */
function litBall(surface: Surface, cx: number, cy: number, r: number, tones: { light: string; mid: string; dark: string }): void {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r + r * 0.5) continue;
      const lit = dx + dy;
      surface.px(cx + dx, cy + dy, lit < -r * 0.5 ? tones.light : lit > r * 0.7 ? tones.dark : tones.mid);
    }
  }
}

// --- sky -----------------------------------------------------------------------

/** Top edge of each of the seven sky bands. */
const BAND_TOPS = [0, 24, 46, 68, 90, 114, 142];
/** Height of the dithered zone straddling each band edge. */
const BAND_BLEND = 12;

const SUN = { x: 186, y: 34, r: 9 };
const LOW_SUN = { x: 184, y: 120, r: 24 };
const MOON = { x: 186, y: 34, r: 9 };

function skyKeyAt(theme: Theme, x: number, y: number): string {
  let band = 0;
  while (band < BAND_TOPS.length - 1 && y >= BAND_TOPS[band + 1]) band++;
  // Near an edge, dither between this band and its neighbour.
  const below = BAND_TOPS[band + 1];
  const above = BAND_TOPS[band];
  const threshold = (BAYER4[y & 3][x & 3] + 0.5) / 16;
  if (below !== undefined && below - y <= BAND_BLEND / 2) {
    const progress = 0.5 - (below - y) / BAND_BLEND;
    if (threshold < progress) band++;
  } else if (band > 0 && y - above < BAND_BLEND / 2) {
    const progress = 0.5 + (y - above) / BAND_BLEND;
    if (threshold >= progress) band--;
  }
  return keyAt(theme.sky[band], x, y);
}

function disc(dx: number, dy: number, r: number): boolean {
  return dx * dx + dy * dy <= r * r + r * 0.6;
}

function bodyKeyAt(theme: Theme, x: number, y: number): string | null {
  if (theme.body === 'sun') {
    const dx = x - SUN.x;
    const dy = y - SUN.y;
    if (disc(dx, dy, 5)) return 'w';
    if (disc(dx, dy, SUN.r)) return 'Y';
    // The glow around it is an ordered dither that thins with distance.
    const d2 = dx * dx + dy * dy;
    if (d2 <= 16 * 16 && BAYER4[y & 3][x & 3] < (d2 <= 12 * 12 ? 6 : 2)) return 'Y';
    return null;
  }
  if (theme.body === 'moon') {
    const dx = x - MOON.x;
    const dy = y - MOON.y;
    if (!disc(dx, dy, MOON.r) || disc(dx - 5, dy + 3, MOON.r - 1)) return null;
    return hash(x, y) < 0.12 ? 'M' : 'W';
  }
  // The low sun: a big banded disc with slits that widen toward the horizon.
  const dx = x - LOW_SUN.x;
  const dy = y - LOW_SUN.y;
  if (!disc(dx, dy, LOW_SUN.r)) return null;
  if (dy > 0 && dy % 6 < 1 + Math.floor(dy / 8)) return null;
  if (dy < -10) return 'w';
  if (dy < -6) return keyAt('wY', x, y);
  if (dy < 4) return 'Y';
  if (dy < 8) return keyAt('YH', x, y);
  return 'H';
}

function skyStatic(phase: Phase): Surface {
  return cached('sky', phase, FULL_W, FULL_H, (surface, theme) => {
    surface.paint(rect(0, 0, FULL_W, FULL_H), (px, py) => {
      const x = px - BLEED;
      const y = py - BLEED;
      return bodyKeyAt(theme, x, y) ?? skyKeyAt(theme, x, y);
    });
  });
}

const STAR_COUNT = 110;

function drawStars(surface: Surface, theme: Theme, t: number): void {
  if (theme.stars <= 0) return;
  for (let i = 0; i < STAR_COUNT; i++) {
    if (hash(i, 7) >= theme.stars) continue;
    const x = Math.floor(hash(i, 1) * FULL_W) - BLEED;
    const y = Math.floor(hash(i, 2) * 150) - BLEED;
    if (disc(x - MOON.x, y - MOON.y, MOON.r + 3)) continue;
    const twinkle = Math.sin(t / (500 + hash(i, 3) * 1100) + hash(i, 4) * 6.283);
    if (twinkle < -0.55) continue;
    const bright = twinkle > 0.6;
    surface.px(x, y, bright ? 'w' : hash(i, 5) < 0.5 ? 'I' : 'p');
    if (bright && i % 7 === 0) {
      surface.px(x - 1, y, 'I');
      surface.px(x + 1, y, 'I');
      surface.px(x, y - 1, 'I');
      surface.px(x, y + 1, 'I');
    }
  }
}

/**
 * The daytime lens flare: rings and dots strung along the 45 degree
 * diagonal that runs down and left from the sun. Every two seconds they
 * flash white for a moment.
 */
const FLARE_SPOTS = [
  { distance: 15, art: FLARE.smallRing },
  { distance: 25, art: FLARE.dot },
  { distance: 38, art: FLARE.largeRing },
  { distance: 51, art: FLARE.bigDot },
];
const FLARE_EVERY_MS = 2000;
const FLARE_FLASH_MS = 120;

function drawFlare(surface: Surface, t: number, still: boolean): void {
  const flash = !still && t % FLARE_EVERY_MS < FLARE_FLASH_MS;
  for (const spot of FLARE_SPOTS) {
    const half = spot.art.length >> 1;
    surface.sprite(spot.art, SUN.x - spot.distance - half, SUN.y + spot.distance - half, flash ? { remap: { Y: 'w', h: 'w' } } : {});
  }
}

/** `still` holds anything that twinkles, for prefers-reduced-motion. */
export function drawSky(surface: Surface, phase: Phase, t: number, still = false): void {
  const theme = THEMES[phase];
  surface.blit(skyStatic(phase).canvas, -BLEED, -BLEED);
  if (theme.stars > 0) {
    const stars = stepped('stars', phase, Math.floor(t / 120), (target) => drawStars(target, theme, t));
    surface.blit(stars.canvas, -BLEED, -BLEED);
  }
  if (theme.body === 'sun') drawFlare(surface, t, still);
}

// --- far layer: clouds, blimp, distant skyline, hills ----------------------------------

const CLOUD_TRACKS = [
  { shape: 0, y: 6, speed: 3.2, start: 40 },
  { shape: 1, y: 40, speed: 2.1, start: 330 },
  { shape: 2, y: 26, speed: 4.4, start: 230 },
  { shape: 1, y: 66, speed: 1.6, start: 470 },
  { shape: 2, y: 4, speed: 2.7, start: 560 },
  { shape: 0, y: 74, speed: 1.2, start: 150 },
];

function drawClouds(surface: Surface, theme: Theme, t: number): void {
  const remap = { w: theme.cloud.light, c: theme.cloud.shade };
  const span = SCENE_W + 160;
  for (const track of CLOUD_TRACKS) {
    const x = ((track.start + (track.speed * t) / 1000) % span) - 80;
    surface.sprite(CLOUDS[track.shape], Math.floor(x), track.y, { remap });
  }
}

/** How long one blimp crossing takes. */
export const BLIMP_CROSSING_MS = 38 * 1000;

function drawBlimp(surface: Surface, theme: Theme, t: number, startedAt: number | null): void {
  if (startedAt === null) return;
  const progress = (t - startedAt) / BLIMP_CROSSING_MS;
  if (progress < 0 || progress > 1) return;
  const x = Math.floor(-50 + progress * (SCENE_W + 100));
  const y = 6 + (Math.floor(t / 1600) % 2);
  surface.sprite(BLIMP, x, y);
  if (theme.glow > 0.4 && Math.floor(t / 500) % 2 === 0) surface.px(x + 19, y + 14, 'C');
}

function smooth(u: number): number {
  const c = Math.min(1, Math.max(0, u));
  return c * c * (3 - 2 * c);
}

/**
 * Top of the rolling hills at a given x. They sit low in the open gap, where
 * they peek over the short tower, and higher behind the walls, where they
 * show between the tall ones. `ridge` 0 is the far ridge, 1 the near one.
 */
function hillTop(x: number, ridge: number): number {
  const inGap = smooth((x - 96) / 30) * (1 - smooth((x - 226) / 30));
  const base = 79 + inGap * 73;
  return Math.round(base + ridge * 5 - 6 * Math.sin(x / 21 + ridge * 1.7) - 3 * Math.sin(x / 8.5 + 1 + ridge));
}

/** Rounded trees standing on the near ridge. */
const TREES = [
  { x: 64, r: 5 },
  { x: 184, r: 6 },
  { x: 311, r: 5 },
];

function farStatic(phase: Phase): Surface {
  return cached('far', phase, FULL_W, FULL_H, (surface, theme) => {
    surface.offset(BLEED, BLEED);
    const { hills, leaf } = theme;

    // Distant towers.
    let x = -BLEED - 6;
    for (let i = 0; x < SCENE_W + BLEED; i++) {
      const w = 9 + Math.floor(hash(i, 1) * 16);
      // The skyline dips in the open gap so the low sun has somewhere to sit.
      const inGap = x + w > LAYOUT.leftWall.w - 6 && x < LAYOUT.rightWall.x + 4;
      const top = (inGap ? 132 : 58) + Math.floor(hash(i, 2) * (inGap ? 30 : 44));
      surface.rect(x, top, w, LAYOUT.floorTop - top, theme.far);
      if (hash(i, 3) < 0.3) surface.rect(x + 2, top - 4, w - 4, 4, theme.far);
      if (hash(i, 4) < 0.25) surface.rect(x + (w >> 1), top - 10, 1, 10, theme.far);
      if (theme.glow > 0) {
        for (let wy = top + 3; wy < LAYOUT.floorTop; wy += 4) {
          for (let wx = x + 1; wx < x + w - 1; wx += 3) {
            if (hash(wx, wy, 9) < 0.09 * theme.glow) surface.px(wx, wy, theme.near.glint[hash(wx, wy) < 0.7 ? 0 : 1]);
          }
        }
      }
      x += w + Math.floor(hash(i, 5) * 3);
    }

    // Rolling hills in front of them: a far ridge, a near ridge, and its lit crest.
    for (let hx = -BLEED; hx < SCENE_W + BLEED; hx++) {
      const back = hillTop(hx, 0);
      const front = hillTop(hx, 1);
      surface.rect(hx, back, 1, LAYOUT.floorTop - back, hills.back);
      surface.rect(hx, front, 1, LAYOUT.floorTop - front, hills.front);
      surface.px(hx, front, hills.crest);
      if (hash(hx, 41) < 0.3) surface.px(hx, front + 2 + Math.floor(hash(hx, 42) * 5), hills.crest);
    }

    for (const tree of TREES) {
      const ground = hillTop(tree.x, 1);
      surface.rect(tree.x, ground - 3, 2, 4, leaf.dark);
      litBall(surface, tree.x - 2, ground - tree.r, tree.r - 2, leaf);
      litBall(surface, tree.x + 1, ground - tree.r - 2, tree.r, leaf);
      if (theme.near.streak) surface.px(tree.x - 1, ground - tree.r * 2, theme.near.streak);
    }
  });
}

export function drawFar(surface: Surface, phase: Phase, t: number, blimpStartedAt: number | null): void {
  const theme = THEMES[phase];
  drawClouds(surface, theme, t);
  drawBlimp(surface, theme, t, blimpStartedAt);
  surface.blit(farStatic(phase).canvas, -BLEED, -BLEED);
}

// --- near layer: glass towers ----------------------------------------------------------

interface Building {
  x: number;
  w: number;
  top: number;
  extra?: 'waterTower' | 'dish' | 'antenna' | 'scaffold' | 'setback';
}

const BUILDINGS: Building[] = [
  { x: -6, w: 134, top: 86, extra: 'scaffold' },
  { x: 128, w: 34, top: 130, extra: 'waterTower' },
  { x: 170, w: 26, top: 152 },
  { x: 206, w: 24, top: 112, extra: 'antenna' },
  { x: 238, w: 46, top: 64, extra: 'antenna' },
  { x: 290, w: 40, top: 80 },
  { x: 334, w: 62, top: 72, extra: 'dish' },
  { x: 402, w: 34, top: 46, extra: 'setback' },
  { x: 438, w: 52, top: 68 },
];

/** One glass pane of the curtain wall. */
const PANE = { w: 3, h: 4, stepX: 5, stepY: 7 };
const SIDE_W = 5;

interface Pane {
  x: number;
  y: number;
  id: number;
  /** How often this pane reconsiders catching the light, in ms, and its phase offset. */
  period: number;
  shift: number;
  pick: number;
}

/** The row of the roof that hides the skyline at a given x. */
function roofLineAt(x: number): number {
  if (x < LAYOUT.leftWall.x + LAYOUT.leftWall.w) return LAYOUT.leftWall.y;
  if (x >= LAYOUT.rightWall.x) return LAYOUT.rightWall.y;
  return LAYOUT.ledgeTop;
}

/** Every pane that can actually be seen: the ones behind the rooftop walls are skipped. */
const PANES: Pane[] = BUILDINGS.flatMap((b, building) => {
  const panes: Pane[] = [];
  const cols = Math.floor((b.w - SIDE_W - 4) / PANE.stepX);
  const rows = Math.floor((LAYOUT.floorTop - b.top - 6) / PANE.stepY);
  const left = b.x + 3 + Math.floor((b.w - SIDE_W - 4 - cols * PANE.stepX + 2) / 2);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = left + col * PANE.stepX;
      const y = b.top + 5 + row * PANE.stepY;
      if (y > roofLineAt(x) + 2 && y > roofLineAt(x + PANE.w) + 2) continue;
      const id = building * 4096 + row * 64 + col;
      panes.push({ x, y, id, period: 9000 + hash(id, 1) * 26000, shift: hash(id, 2), pick: hash(id, 4) });
    }
  }
  return panes;
});

/** The gloss recipe on a cylinder: white band up top, a lighter row under it, a dark row along the bottom. */
function drawWaterTower(surface: Surface, theme: Theme, b: Building): void {
  const { gloss, light, body, lo } = theme.metal;
  const cx = b.x + (b.w >> 1);
  const tankTop = b.top - 26;
  // Legs and bracing.
  surface.rect(cx - 9, tankTop + 16, 1, 10, lo);
  surface.rect(cx + 8, tankTop + 16, 1, 10, lo);
  surface.rect(cx - 1, tankTop + 16, 1, 10, lo);
  for (let i = 0; i < 8; i++) surface.px(cx - 8 + i, tankTop + 17 + i, lo);
  // Conical roof, lit on its left slope.
  for (let i = 0; i < 6; i++) {
    surface.rect(cx - 2 - i * 2, tankTop - 6 + i, 4 + i * 4, 1, body);
    surface.rect(cx - 2 - i * 2, tankTop - 6 + i, 2 + i, 1, light);
  }
  surface.px(cx - 3, tankTop - 4, gloss);
  // Tank, with its corners knocked off.
  surface.rect(cx - 10, tankTop, 20, 1, body);
  surface.rect(cx - 11, tankTop + 1, 22, 14, body);
  surface.rect(cx - 10, tankTop + 15, 20, 1, lo);
  surface.rect(cx + 7, tankTop + 1, 4, 14, lo);
  surface.rect(cx - 10, tankTop + 3, 16, 2, gloss);
  surface.rect(cx - 10, tankTop + 5, 16, 1, light);
  surface.rect(cx - 11, tankTop + 10, 22, 1, lo);
}

function nearStatic(phase: Phase): Surface {
  return cached('near', phase, FULL_W, FULL_H, (surface, theme) => {
    surface.offset(BLEED, BLEED);
    const { body, side, trim } = theme.near;
    const metal = theme.metal;
    for (const b of BUILDINGS) {
      const bottom = LAYOUT.floorTop + BLEED;
      if (b.extra === 'setback') {
        surface.rect(b.x + 6, b.top - 12, b.w - 12, 12, body);
        surface.rect(b.x + b.w - 6 - 3, b.top - 12, 3, 12, side);
        surface.rect(b.x + 6, b.top - 13, b.w - 12, 1, trim);
        surface.rect(b.x + (b.w >> 1), b.top - 26, 1, 13, metal.light);
      }
      surface.rect(b.x, b.top, b.w, bottom - b.top, body);
      surface.rect(b.x + b.w - SIDE_W, b.top, SIDE_W, bottom - b.top, side);
      surface.rect(b.x, b.top, b.w, 1, trim);

      if (b.extra === 'antenna') {
        const ax = b.x + (b.w >> 1);
        surface.rect(ax, b.top - 18, 1, 18, metal.light);
        surface.rect(ax - 2, b.top - 8, 5, 1, metal.light);
      }
      if (b.extra === 'dish') {
        surface.sprite(DISH, b.x + 22, b.top - DISH.length, { remap: { 1: metal.gloss, 2: metal.light, 3: metal.body, 4: metal.lo } });
      }
      if (b.extra === 'waterTower') drawWaterTower(surface, theme, b);
      if (b.extra === 'scaffold') {
        // Lattice legs that carry the jumbotron.
        const { jumbotron } = LAYOUT;
        const legTop = jumbotron.y + jumbotron.h - 6;
        for (const lx of [jumbotron.x + 14, jumbotron.x + jumbotron.w - 16]) {
          surface.rect(lx, legTop, 2, b.top - legTop, metal.light);
          surface.rect(lx + 8, legTop, 2, b.top - legTop, metal.body);
          for (let y = legTop; y < b.top - 2; y += 6) {
            for (let i = 0; i < 6; i++) surface.px(lx + 2 + i, y + i, metal.body);
          }
        }
      }
    }
  });
}

/**
 * Diagonal reflection streaks across the glass, at 45 degrees and unevenly
 * spaced. They never change, so they are baked once per phase and laid
 * over the panes.
 */
function glassStreaks(phase: Phase): Surface {
  return cached('streaks', phase, FULL_W, FULL_H, (surface, theme) => {
    const { streak } = theme.near;
    if (!streak) return;
    surface.offset(BLEED, BLEED);
    BUILDINGS.forEach((b, i) => {
      const left = b.x + 1;
      const right = b.x + b.w - SIDE_W - 1;
      const count = 2 + Math.floor(hash(i, 21) * 2) + (b.w > 60 ? 3 : 0);
      for (let n = 0; n < count; n++) {
        const startX = left + 4 + Math.floor(hash(i, n, 22) * (right - left));
        const startY = b.top + 3 + Math.floor(hash(i, n, 23) * 46);
        const length = 9 + Math.floor(hash(i, n, 24) * 24);
        const doubled = hash(i, n, 25) < 0.45;
        for (let k = 0; k < length; k++) {
          const x = startX - k;
          if (x < left || x > right) continue;
          surface.px(x, startY + k, streak);
          if (doubled && k > 2 && k < length - 3 && x + 2 <= right) surface.px(x + 2, startY + k, streak);
        }
      }
    });
  });
}

function drawPanes(surface: Surface, theme: Theme, t: number): void {
  const { pane, glint, lit } = theme.near;
  // Batch by colour: one path and one fill per colour instead of a fill per pane.
  const batches = new Map<string, Pane[]>();
  for (const item of PANES) {
    const epoch = Math.floor(t / item.period + item.shift);
    const on = hash(item.id, 3, epoch) < lit;
    const key = on ? glint[Math.floor(item.pick * glint.length)] : pane;
    let batch = batches.get(key);
    if (!batch) batches.set(key, (batch = []));
    batch.push(item);
  }
  for (const [key, batch] of batches) {
    surface.ctx.beginPath();
    for (const item of batch) surface.ctx.rect(item.x, item.y, PANE.w, PANE.h);
    surface.ctx.fillStyle = PALETTE[key as PaletteKey].hex;
    surface.ctx.fill();
  }
}

function drawBeacons(surface: Surface, theme: Theme, t: number): void {
  if (theme.glow < 0.5 || Math.floor(t / 900) % 2 === 1) return;
  for (const b of BUILDINGS) {
    if (b.extra === 'antenna') surface.px(b.x + (b.w >> 1), b.top - 19, 'C');
    if (b.extra === 'setback') surface.px(b.x + (b.w >> 1), b.top - 27, 'C');
  }
}

export function drawNear(surface: Surface, phase: Phase, t: number): void {
  surface.blit(nearStatic(phase).canvas, -BLEED, -BLEED);
  const panes = stepped('panes', phase, Math.floor(t / 250), (target, theme) => drawPanes(target, theme, t));
  surface.blit(panes.canvas, -BLEED, -BLEED);
  surface.blit(glassStreaks(phase).canvas, -BLEED, -BLEED);
  drawBeacons(surface, THEMES[phase], t);
}

// --- rooftop: walls, parapet, floor, planters, pool ----------------------------------------

const TILE = 8;
const PANEL_W = 31;

/**
 * The palette key of the bare rooftop (walls, parapet, floor) at a pixel, or
 * null where the sky shows. It is a pure function so that glass props can
 * ask what lies beneath them and remap it.
 */
export function roofKeyAt(theme: Theme, x: number, y: number): string | null {
  const { roof } = theme;
  const { leftWall, rightWall, ledgeTop, floorTop } = LAYOUT;
  const dither = (level: number) => BAYER4[y & 3][x & 3] < level;

  // Floor, with a contact shadow where the walls meet it and two seams.
  if (y >= floorTop) {
    if (y === floorTop) return roof.parapetShade;
    if (y <= floorTop + 3 && dither(8)) return roof.floorSpeck;
    if ((y === floorTop + 22 || y === floorTop + 46) && x % 6 !== 0) return roof.floorSpeck;
    return hash(x, y, 3) < 0.022 ? roof.floorSpeck : keyAt(roof.floor, x, y);
  }

  // Left: the tiled wall the tag is painted on. Each tile is lit along its top and left.
  const leftEdge = leftWall.x + leftWall.w;
  if (x < leftEdge + 2 && y >= leftWall.y - 3 && y < leftWall.y) return roof.coping;
  if (x < leftEdge && y >= leftWall.y) {
    if (y === leftWall.y) return roof.parapetShade;
    if (x === leftEdge - 1) return roof.grout;
    const tx = x % TILE;
    const ty = (y - leftWall.y - 1) % TILE;
    if (tx === TILE - 1 || ty === TILE - 1) return roof.grout;
    return tx === 0 || ty === 0 ? roof.tileHi : roof.tile;
  }

  // Right: the panelled wall the messenger window is pinned to.
  if (x >= rightWall.x - 2 && y >= rightWall.y - 3 && y < rightWall.y) return roof.coping;
  if (x >= rightWall.x && y >= rightWall.y) {
    if (y === rightWall.y) return roof.panelSeam;
    const px = (x - rightWall.x) % PANEL_W;
    if (px === 0) return roof.panelSeam;
    if (px === 1) return roof.panelHi;
    if (px === 4 && (y - rightWall.y - 6) % 24 === 0) return roof.panelSeam;
    if (y >= floorTop - 10 && dither(6)) return roof.panelSeam;
    return keyAt(roof.panel, x, y);
  }

  // The parapet across the open gap.
  if (x >= leftEdge && x < rightWall.x && y >= ledgeTop) {
    if (y < ledgeTop + 3) return roof.coping;
    if (y === ledgeTop + 3) return roof.parapetShade;
    if (y >= floorTop - 6 && dither(8)) return roof.parapetShade;
    return keyAt(roof.parapet, x, y);
  }
  return null;
}

/** Planters along the ledge and the wall. `tall` lets the plants grow higher where nothing hangs above them. */
const PLANTERS: (Rect & { tall: boolean })[] = [
  { x: 172, y: 198, w: 32, h: 10, tall: true },
  { x: 246, y: 199, w: 58, h: 9, tall: false },
  { x: 318, y: 199, w: 58, h: 9, tall: false },
];

function drawPlanter(surface: Surface, theme: Theme, planter: Rect & { tall: boolean }): void {
  const { gloss, body, lo } = theme.roof.planter;
  const { x, y, w, h, tall } = planter;

  // Leaves first, so the rim of the pot overlaps them.
  const clumps = Math.floor(w / 7);
  for (let i = 0; i < clumps; i++) {
    const cx = x + 4 + Math.round((i * (w - 9)) / (clumps - 1));
    const r = 3 + Math.floor(hash(x, i, 31) * (tall ? 3 : 1.5));
    const lift = tall && i % 2 === 1 ? 4 : Math.floor(hash(x, i, 32) * 2);
    const cy = y - r + 2 - lift;
    litBall(surface, cx, cy, r, theme.leaf);
    if (theme.near.streak && i % 2 === 0) surface.px(cx - (r >> 1), cy - (r >> 1) - 1, theme.near.streak);
    // A blade or two poking out of each clump.
    if (hash(x, i, 33) < 0.6) {
      for (let k = 0; k < 3; k++) surface.px(cx + r - 1 + k, cy - r + 1 - k, theme.leaf.mid);
    }
  }

  // The pot: gloss band up top, a dark row along the bottom, corners knocked off.
  surface.rect(x + 1, y, w - 2, 1, body);
  surface.rect(x, y + 1, w, h - 2, body);
  surface.rect(x + 1, y + h - 1, w - 2, 1, lo);
  surface.rect(x + 2, y + 1, w - 6, 1, gloss);
  surface.rect(x + w - 2, y + 1, 2, h - 2, lo);
}

/** The reflecting pool on the floor. */
const POOL = rect(262, 222, 76, 12);

function drawPoolBasin(surface: Surface, theme: Theme): void {
  const { pool } = theme;
  const { x, y, w, h } = POOL;
  // Coping: a rounded slab, lit on the top and left.
  for (let row = 0; row < h; row++) {
    const inset = row === 0 || row === h - 1 ? 2 : row === 1 || row === h - 2 ? 1 : 0;
    surface.rect(x + inset, y + row, w - inset * 2, 1, row >= h - 2 ? pool.rimLo : pool.rim);
  }
  surface.rect(x + w - 2, y + 2, 2, h - 4, pool.rimLo);
  // Water, with the bright band of sky it reflects along the far edge.
  for (let row = 2; row < h - 2; row++) {
    const inset = row === 2 || row === h - 3 ? 3 : 2;
    surface.rect(x + inset, y + row, w - inset * 2, 1, row === 2 ? pool.band : pool.water);
  }
  surface.shade(x + 3, y + 3, w - 6, 1, pool.band, 8);
}

function roofStatic(phase: Phase): Surface {
  return cached('roof', phase, SCENE_W, SCENE_H, (surface, theme) => {
    surface.paint(rect(0, 0, SCENE_W, SCENE_H), (x, y) => roofKeyAt(theme, x, y));
    for (const planter of PLANTERS) drawPlanter(surface, theme, planter);
    drawPoolBasin(surface, theme);
  });
}

export function drawRoof(surface: Surface, phase: Phase): void {
  surface.blit(roofStatic(phase).canvas);
}

/**
 * The pool's moving parts: ripples that swap between two layouts, and
 * specular glints sliding across the water. `still` freezes both.
 */
export function drawPool(surface: Surface, phase: Phase, t: number, still = false): void {
  const { pool } = THEMES[phase];
  const { x, y, w } = POOL;
  const frame = still ? 0 : Math.floor(t / 650) % 2;
  for (let i = 0; i < 7; i++) {
    const rx = x + 6 + ((i * 11 + frame * 5) % (w - 18));
    surface.rect(rx, y + 4 + (i % 3) * 2, 3 + (i % 2) * 2, 1, pool.ripple);
  }
  for (let i = 0; i < 3; i++) {
    const travel = still ? i * 23 : t / (150 + i * 40) + i * 23;
    const gx = x + 5 + (Math.floor(travel) % (w - 12));
    surface.rect(gx, y + 4 + i * 2, 2, 1, pool.glint);
  }
}

/**
 * Builds one phase's cached backdrop ahead of time, so the first frame of a
 * phase change does not have to. Returns false once every phase is ready.
 */
export function prewarmBackdrop(): boolean {
  for (const phase of Object.keys(THEMES) as Phase[]) {
    if (cache.has(`roof:${phase}`)) continue;
    skyStatic(phase);
    farStatic(phase);
    nearStatic(phase);
    glassStreaks(phase);
    roofStatic(phase);
    return true;
  }
  return false;
}

/** Where the next automatic blimp pass should start, given the last one. */
export function nextBlimpAt(lastStartedAt: number | null, t: number): number {
  return lastStartedAt === null ? t + BLIMP_PERIOD_MS / 3 : lastStartedAt + BLIMP_PERIOD_MS;
}
