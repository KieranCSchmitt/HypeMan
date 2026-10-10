/**
 * Everything on the rooftop that is not HypeMan: the jumbotron, string
 * lights, graffiti tag, CRT, pigeons, boombox, messenger window and the
 * corner buttons. Each prop is a pure draw function over the shared World.
 */
import type { HypeState } from '../hypeman/atlas';
import { GLASS, type PaletteKey } from '../hypeman/palette';
import { IM, LAYOUT, PIGEON_AWAY_MS, SCENE_H, SCENE_W, rect, type Rect } from './constants';
import { BOLT, PIGEON, TAG_LETTERS } from './sprites';
import { roofKeyAt } from './layers';
import { FONTS, Surface, glossKeyAt, hash, matrixOutline, memoSurface, outlineCanvas, textWidth, type FontId, type Gloss } from './surface';
import { THEMES, type Phase } from './timeOfDay';

export type PropId =
  | 'sky'
  | 'jumbotron'
  | 'graffiti'
  | 'crt'
  | 'pigeons'
  | 'hypeman'
  | 'boombox'
  | 'send'
  | 'show'
  | 'sound'
  | 'mic';

export interface ChatLine {
  who: 'you' | 'hype';
  text: string;
}

/** The state every prop draws from. The Scene owns and mutates it. */
export interface World {
  /** Animation clock in ms. Runs at half speed under prefers-reduced-motion. */
  t: number;
  now: Date;
  /** 0 by day, 1 at night: how hard lights glow. */
  glow: number;
  micLive: boolean;
  soundOn: boolean;
  avatarState: HypeState;
  im: { text: string; caret: number; focused: boolean; log: ChatLine[] };
  crt: { channel: 0 | 1 | 2; status: string; steps: string[]; changedAt: number; typedAt: number };
  jumbotron: { h24: boolean; dateUntil: number };
  boombox: { playing: boolean };
  pigeons: { scatteredAt: number | null };
  graffiti: { shimmerAt: number | null };
}

export function wrapText(text: string, columns: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > columns) {
      const room = columns - (line ? line.length + 1 : 0);
      if (room < 2) {
        lines.push(line);
        line = '';
        continue;
      }
      lines.push((line ? line + ' ' : '') + word.slice(0, room));
      word = word.slice(room);
      line = '';
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= columns) line += ' ' + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// --- jumbotron ---------------------------------------------------------------------

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function formatClock(now: Date, h24: boolean): { time: string; suffix: string } {
  const minutes = String(now.getMinutes()).padStart(2, '0');
  if (h24) return { time: `${String(now.getHours()).padStart(2, '0')}:${minutes}`, suffix: '' };
  const hour = now.getHours() % 12 || 12;
  return { time: `${String(hour).padStart(2, ' ')}:${minutes}`, suffix: now.getHours() < 12 ? 'AM' : 'PM' };
}

const JUMBOTRON_H = 40;

/** The glass housing: gloss along the top rail, corners knocked off, a reflection streak on each side rail. Drawn once. */
function jumbotronShell(): Surface {
  const { w } = LAYOUT.jumbotron;
  const glass: Gloss = { body: 'I', band: 'w', light: 'h', lo: 'C', outline: 'K', bandTop: 0, bandHeight: 1 };
  return memoSurface('jumbotron-shell', w + 2, JUMBOTRON_H + 2, (m) => {
    m.paint(rect(0, 0, w + 2, JUMBOTRON_H + 2), (x, y) => glossKeyAt(x, y, w + 2, JUMBOTRON_H + 2, glass));
    for (let k = 0; k < 4; k++) {
      m.px(5 - k, 12 + k, 'w');
      m.px(w - 1 - k, 22 + k, 'w');
    }
    m.rect(1, 3, 1, JUMBOTRON_H - 4, 'h');
    m.rect(w, 3, 1, JUMBOTRON_H - 4, 'C');
  });
}

/** Gloss-white text with a 1px cyber-cyan glow around it. */
function glowText(s: Surface, text: string, x: number, y: number, font: FontId, align: 'left' | 'center' = 'left'): void {
  s.text(text, x - 1, y, font, 'C', align);
  s.text(text, x + 1, y, font, 'C', align);
  s.text(text, x, y - 1, font, 'C', align);
  s.text(text, x, y + 1, font, 'C', align);
  s.text(text, x, y, font, 'w', align);
}

export function drawJumbotron(s: Surface, world: World): void {
  const { x, y, w } = LAYOUT.jumbotron;
  const h = JUMBOTRON_H;
  s.blit(jumbotronShell().canvas, x - 1, y - 1);

  // Chasing marquee bulbs along the top and bottom rails.
  const chase = Math.floor(world.t / 260);
  for (let i = 0; i < 18; i++) {
    const bx = x + 5 + i * 6;
    const lit = (i + chase) % 3 !== 0;
    s.px(bx, y + 3, lit ? 'w' : 'B');
    s.px(bx, y + h - 3, lit ? 'Y' : 'B');
  }

  const screen = rect(x + 5, y + 5, w - 10, h - 10);
  s.rect(screen.x, screen.y, screen.w, screen.h, 'K');
  s.frame(screen.x, screen.y, screen.w, screen.h, 'N');

  const textY = screen.y + 7;
  if (world.t < world.jumbotron.dateUntil) {
    // The date flashes, then the clock comes back.
    if (Math.floor((world.jumbotron.dateUntil - world.t) / 300) % 2 === 0) {
      const date = `${MONTHS[world.now.getMonth()]} ${String(world.now.getDate()).padStart(2, '0')}`;
      glowText(s, date, screen.x + (screen.w >> 1), textY, 'ps16', 'center');
    }
    return;
  }

  const { time, suffix } = formatClock(world.now, world.jumbotron.h24);
  const total = textWidth(time, 'ps16') + (suffix ? 2 + textWidth(suffix, 'ps8') : 0);
  const left = screen.x + ((screen.w - total) >> 1);
  // Unlit LCD segments ghost behind the lit digits.
  s.text('88:88', left, textY, 'ps16', 'N');
  const blinkOff = world.now.getSeconds() % 2 === 1;
  glowText(s, blinkOff ? time.replace(':', ' ') : time, left, textY, 'ps16');
  if (suffix) s.text(suffix, left + textWidth(time, 'ps16') + 2, textY + 8, 'ps8', 'I');
}

// --- string lights -------------------------------------------------------------------

const BULB_COLOURS = ['H', 'C', 'Y', 'L', 'V'];

interface Bulb {
  x: number;
  y: number;
  index: number;
}

const STRANDS = (() => {
  const { leftWall, rightWall } = LAYOUT;
  const a = { x: leftWall.x + leftWall.w, y: leftWall.y - 12 };
  const b = { x: rightWall.x, y: rightWall.y - 14 };
  return {
    posts: [rect(a.x - 1, a.y, 2, 12), rect(b.x - 1, b.y, 2, 14)],
    runs: [
      { x0: a.x, y0: a.y, x1: b.x, y1: b.y, sag: 15, seed: 0 },
      { x0: b.x, y0: b.y, x1: SCENE_W + 6, y1: rightWall.y - 16, sag: 9, seed: 2 },
    ],
  };
})();

function strandY(run: (typeof STRANDS.runs)[number], i: number): number {
  const u = i / (run.x1 - run.x0);
  return Math.round(run.y0 + (run.y1 - run.y0) * u + run.sag * 4 * u * (1 - u));
}

const BULBS: Bulb[] = STRANDS.runs.flatMap((run) => {
  const bulbs: Bulb[] = [];
  for (let i = 4; i <= run.x1 - run.x0; i += 9) {
    bulbs.push({ x: run.x0 + i, y: strandY(run, i) + 1, index: Math.floor(i / 9) + run.seed });
  }
  return bulbs;
});

export function drawStringLights(s: Surface, world: World): void {
  // The wires never change, so they are drawn once; only the bulbs are live.
  const wires = memoSurface('string-light-wires', SCENE_W, SCENE_H, (m) => {
    for (const post of STRANDS.posts) m.rect(post.x, post.y, post.w, post.h, 'K');
    for (const run of STRANDS.runs) {
      for (let i = 0; i <= run.x1 - run.x0; i++) m.px(run.x0 + i, strandY(run, i), 'K');
    }
  });
  s.blit(wires.canvas);

  const chase = Math.floor(world.t / 450);
  for (const bulb of BULBS) {
    const colour = BULB_COLOURS[bulb.index % BULB_COLOURS.length];
    const lit = world.glow < 0.3 || (bulb.index + chase) % 4 !== 0;
    if (lit && world.glow > 0.5) s.shade(bulb.x - 1, bulb.y - 1, 4, 4, colour, 5);
    // A glossy sphere: the colour, with one gloss-white pixel on its upper left.
    s.rect(bulb.x, bulb.y, 2, 2, lit ? colour : 'M');
    if (lit) s.px(bulb.x, bulb.y, 'w');
  }
}

// --- graffiti ----------------------------------------------------------------------------

const TAG = 'HYPEMAN';
const TAG_JITTER = [1, 0, 2, 1, 0, 2, 1];
/** Two bands by height: ice above, water teal below. */
const TAG_FILL = ['I', 'I', 'I', 'A', 'A', 'A', 'A'];
const SHIMMER = ['I', 'C', 'L', 'w'];
export const SHIMMER_MS = 2400;

const enum Cell {
  None,
  Shadow,
  Outline,
  Fill,
  Shine,
}

interface TagArt {
  w: number;
  h: number;
  cells: Uint8Array;
  /** 0..6: which band of the letter's height a fill pixel sits in. */
  band: Uint8Array;
}

let tagArt: TagArt | null = null;

/** Inflates the 5x7 block letters into fat, round-cornered bubble letters. */
function buildTag(): TagArt {
  const scale = 2;
  const glyphs = [...TAG].map((letter) => TAG_LETTERS[letter]);
  const w = glyphs.reduce((sum, glyph) => sum + glyph[0].length * scale + 3, 0) + 6;
  const h = 7 * scale + 10;
  const at = (grid: Uint8Array, x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? grid[y * w + x] : 0);
  const grow = (grid: Uint8Array) =>
    grid.map((value, i) => {
      const x = i % w;
      const y = Math.floor(i / w);
      return value || at(grid, x - 1, y) || at(grid, x + 1, y) || at(grid, x, y - 1) || at(grid, x, y + 1) ? 1 : 0;
    });

  const base = new Uint8Array(w * h);
  const band = new Uint8Array(w * h);
  let ox = 3;
  glyphs.forEach((glyph, index) => {
    const oy = 3 + TAG_JITTER[index];
    glyph.forEach((row, cy) => {
      [...row].forEach((cell, cx) => {
        if (cell !== '#') return;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) base[(oy + cy * scale + sy) * w + ox + cx * scale + sx] = 1;
        }
      });
    });
    for (let y = 0; y < h; y++) {
      for (let x = ox - 2; x < ox + glyph[0].length * scale + 2; x++) {
        if (x >= 0 && x < w) band[y * w + x] = Math.max(0, Math.min(6, Math.floor((y - oy + 1) / 2.3)));
      }
    }
    ox += glyph[0].length * scale + 3;
  });

  const fat = grow(base);
  const edge = grow(fat);
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (fat[i]) cells[i] = at(fat, x, y - 1) ? Cell.Fill : Cell.Shine;
      else if (edge[i]) cells[i] = Cell.Outline;
      else if (at(edge, x - 2, y - 2)) cells[i] = Cell.Shadow;
    }
  }
  return { w, h, cells, band };
}

let tagStill: Surface | null = null;
let tagLive: Surface | null = null;

function paintTag(target: Surface, art: TagArt, shimmer: number | null): void {
  target.clear();
  target.paint(rect(0, 0, art.w, art.h), (x, y) => {
    const i = y * art.w + x;
    switch (art.cells[i]) {
      case Cell.Shadow:
        return 'K';
      case Cell.Outline:
        return 'K';
      case Cell.Shine:
        return 'w';
      case Cell.Fill: {
        if (shimmer !== null) {
          // A diagonal band of cycling colours sweeps left to right across the tag.
          const front = shimmer * (art.w + 60) - 30;
          const distance = x + y * 0.6 - front;
          if (distance > -34 && distance < 6) {
            const step = Math.floor((x + y) / 3 + shimmer * 40);
            return SHIMMER[((step % SHIMMER.length) + SHIMMER.length) % SHIMMER.length];
          }
        }
        return TAG_FILL[art.band[i]];
      }
      default:
        return null;
    }
  });
}

let tagOutline: HTMLCanvasElement | null = null;

function tagOrigin(art: TagArt): { x: number; y: number } {
  return { x: LAYOUT.graffiti.x + ((LAYOUT.graffiti.w - art.w) >> 1), y: LAYOUT.graffiti.y + 3 };
}

export function drawGraffiti(s: Surface, world: World): void {
  tagArt ??= buildTag();
  const art = tagArt;
  const { x, y } = tagOrigin(art);
  const { shimmerAt } = world.graffiti;
  const progress = shimmerAt === null ? null : (world.t - shimmerAt) / SHIMMER_MS;
  if (progress !== null && progress >= 0 && progress < 1) {
    tagLive ??= new Surface(art.w, art.h);
    paintTag(tagLive, art, progress);
    s.blit(tagLive.canvas, x, y);
    return;
  }
  if (!tagStill) {
    tagStill = new Surface(art.w, art.h);
    paintTag(tagStill, art, null);
  }
  s.blit(tagStill.canvas, x, y);
}

// --- CRT TV ---------------------------------------------------------------------------------

const CRT_BODY = rect(LAYOUT.crt.x, LAYOUT.crt.y + 12, LAYOUT.crt.w, 68);
const CRT_SCREEN = rect(CRT_BODY.x + 6, CRT_BODY.y + 6, 98, 56);
export const CRT_COLUMNS = 12;
const CRT_LINE = 14;
const CRT_ROWS = 4;
export const CRT_CHANNELS = ['status', 'static', 'starfield'] as const;

let staticSurface: Surface | null = null;
let staticFrame = -1;

function drawStatic(s: Surface, t: number): void {
  staticSurface ??= new Surface(CRT_SCREEN.w, CRT_SCREEN.h);
  const frame = Math.floor(t / 70);
  if (frame !== staticFrame) {
    staticFrame = frame;
    const keys = 'KKDMWK';
    staticSurface.paint(rect(0, 0, CRT_SCREEN.w, CRT_SCREEN.h), (x, y) => keys[Math.floor(hash(x, y, frame) * keys.length)]);
  }
  s.blit(staticSurface.canvas, CRT_SCREEN.x, CRT_SCREEN.y);
  // A rolling bar, like a set that has lost vertical hold.
  const bar = CRT_SCREEN.y + (Math.floor(t / 40) % CRT_SCREEN.h);
  s.rect(CRT_SCREEN.x, bar, CRT_SCREEN.w, 2, 'W');
}

function drawStarfield(s: Surface, t: number): void {
  const cx = CRT_SCREEN.x + (CRT_SCREEN.w >> 1);
  const cy = CRT_SCREEN.y + (CRT_SCREEN.h >> 1);
  for (let i = 0; i < 46; i++) {
    const depth = 1 - ((t / 2600 + hash(i, 1)) % 1);
    const angle = hash(i, 2) * 6.283;
    const reach = (8 + hash(i, 3) * 52) / (depth * 3.4 + 0.25);
    const x = Math.round(cx + Math.cos(angle) * reach);
    const y = Math.round(cy + Math.sin(angle) * reach * 0.6);
    if (x <= CRT_SCREEN.x || x >= CRT_SCREEN.x + CRT_SCREEN.w - 1 || y <= CRT_SCREEN.y || y >= CRT_SCREEN.y + CRT_SCREEN.h - 1) continue;
    s.px(x, y, depth < 0.35 ? 'w' : depth < 0.7 ? 'I' : 'V');
    if (depth < 0.18) s.px(x + 1, y, 'I');
  }
}

function drawTerminal(s: Surface, world: World): void {
  const { status, steps, typedAt } = world.crt;
  const lines = [`>${status.toUpperCase()}`.slice(0, CRT_COLUMNS)];
  const body = steps.flatMap((step) => wrapText(step, CRT_COLUMNS));
  lines.push(...body.slice(-(CRT_ROWS - 1)));

  // The newest step types itself out.
  const newest = steps.length ? wrapText(steps[steps.length - 1], CRT_COLUMNS) : [];
  let hidden = Math.max(0, newest.join('').length - Math.floor((world.t - typedAt) / 28));
  for (let i = lines.length - 1; i >= 1 && hidden > 0; i--) {
    const cut = Math.min(hidden, lines[i].length);
    lines[i] = lines[i].slice(0, lines[i].length - cut);
    hidden -= cut;
  }

  lines.forEach((line, row) => {
    s.text(line, CRT_SCREEN.x + 1, CRT_SCREEN.y + row * CRT_LINE - 1, 'vt', row === 0 ? 'L' : 'G');
  });
  if (Math.floor(world.t / 500) % 2 === 0) {
    const row = lines.length - 1;
    const column = Math.min(CRT_COLUMNS - 1, lines[row].length);
    s.rect(CRT_SCREEN.x + 1 + column * 8, CRT_SCREEN.y + row * CRT_LINE + 2, 7, 11, 'G');
  }
}

const CRT_CASING: Gloss = { body: '?', band: 'w', light: 'h', lo: 'C', outline: 'K', bandTop: 1, bandHeight: 2 };

/**
 * The set itself: a glossy, translucent ice casing with rabbit ears, bezel
 * and controls. The casing is glass, so half its pixels are ice and the
 * other half are whatever wall and floor sit behind it, passed through the
 * GLASS table. Those pixels are static, so it is baked once per phase.
 */
function crtShell(phase: Phase): Surface {
  const { crt } = LAYOUT;
  const theme = THEMES[phase];
  return memoSurface(`crt-shell:${phase}`, crt.w + 2, crt.h + 2, (s) => {
    const b = CRT_BODY;
    const sc = CRT_SCREEN;
    s.paint(rect(0, 0, crt.w + 2, crt.h + 2), (px, py) => {
      const x = px + crt.x - 1;
      const y = py + crt.y - 1;
      const key = glossKeyAt(x - (b.x - 1), y - (b.y - 1), b.w + 2, b.h + 2, CRT_CASING);
      if (key !== CRT_CASING.body) return key;
      if ((x + y) & 1) return 'I';
      const behind = roofKeyAt(theme, x, y);
      return behind ? GLASS[behind as PaletteKey] : 'I';
    });

    s.offset(1 - crt.x, 1 - crt.y);
    // Reflection streaks on the bezel either side of the tube.
    for (let k = 0; k < 5; k++) {
      s.px(b.x + 5 - k, b.y + 20 + k, 'w');
      s.px(b.x + b.w - 3 - k, b.y + 42 + k, 'w');
    }

    // Rabbit ears.
    for (let i = 0; i < 12; i++) {
      s.px(b.x + 46 - i, b.y - 1 - i, 'M');
      s.px(b.x + 60 + i, b.y - 1 - Math.floor(i * 0.8), 'M');
    }
    s.px(b.x + 35, b.y - 12, 'w');
    s.rect(b.x + 46, b.y - 3, 16, 3, 'M');
    s.rect(b.x + 47, b.y - 3, 14, 1, 'w');
    s.roundFrame(b.x + 45, b.y - 4, 18, 5, 'K');
    s.rect(b.x + 4, b.y + b.h + 1, 8, 2, 'K');
    s.rect(b.x + b.w - 12, b.y + b.h + 1, 8, 2, 'K');

    // The tube.
    s.rect(sc.x - 1, sc.y - 1, sc.w + 2, sc.h + 2, 'N');
    s.rect(sc.x, sc.y, sc.w, sc.h, 'K');

    // Control strip: two glossy knobs and speaker slits.
    const cx = sc.x + sc.w + 3;
    for (const ky of [b.y + 8, b.y + 18]) {
      s.rect(cx, ky, 6, 6, 'K');
      s.rect(cx + 1, ky + 1, 4, 4, 'W');
      s.px(cx + 1, ky + 1, 'w');
      s.rect(cx + 2, ky + 4, 3, 1, 'M');
    }
    for (let i = 0; i < 6; i++) s.rect(cx, b.y + 30 + i * 3, 6, 1, 'A');
  });
}

/** Drawn with the rest of the phase-dependent rooftop, so it cross-fades with it. */
export function drawCrtShell(s: Surface, phase: Phase): void {
  s.blit(crtShell(phase).canvas, LAYOUT.crt.x - 1, LAYOUT.crt.y - 1);
}

/** The screen and everything else on the set that changes from frame to frame. */
export function drawCrt(s: Surface, world: World): void {
  const b = CRT_BODY;
  const sc = CRT_SCREEN;

  if (world.crt.channel === 1) drawStatic(s, world.t);
  else if (world.crt.channel === 2) drawStarfield(s, world.t);
  else drawTerminal(s, world);

  // Rounded tube corners, on top of whatever the channel drew.
  s.px(sc.x, sc.y, 'N');
  s.px(sc.x + sc.w - 1, sc.y, 'N');
  s.px(sc.x, sc.y + sc.h - 1, 'N');
  s.px(sc.x + sc.w - 1, sc.y + sc.h - 1, 'N');

  if (world.t - world.crt.changedAt < 1400) {
    s.rect(sc.x + sc.w - 27, sc.y + 2, 25, 10, 'K');
    s.text(`CH${world.crt.channel + 1}`, sc.x + sc.w - 26, sc.y + 3, 'ps8', 'G');
  }
  // The channel knob's pointer and the power light.
  const px = sc.x + sc.w + 3;
  s.px(px + 2 + world.crt.channel, b.y + 9, 'K');
  s.rect(px + 2, b.y + b.h - 9, 2, 2, 'G');
}

// --- pigeons -----------------------------------------------------------------------------------

const PIGEON_HOMES = [
  { x: 140, flip: false, away: [-70, -96] },
  { x: 158, flip: true, away: [36, -120] },
  { x: 208, flip: false, away: [96, -84] },
];
const PIGEON_FLIGHT_MS = 1500;

/** 0 when perched, 1 when fully gone. */
function pigeonFlight(world: World): number {
  const { scatteredAt } = world.pigeons;
  if (scatteredAt === null) return 0;
  const since = world.t - scatteredAt;
  if (since < PIGEON_FLIGHT_MS) return since / PIGEON_FLIGHT_MS;
  if (since < PIGEON_AWAY_MS) return 1;
  if (since < PIGEON_AWAY_MS + PIGEON_FLIGHT_MS) return 1 - (since - PIGEON_AWAY_MS) / PIGEON_FLIGHT_MS;
  return 0;
}

export function pigeonsAreBack(world: World): boolean {
  return world.pigeons.scatteredAt === null || world.t - world.pigeons.scatteredAt >= PIGEON_AWAY_MS + PIGEON_FLIGHT_MS;
}

/** Which sprite each pigeon is showing right now, and where. */
function pigeonSprites(world: World): { matrix: readonly string[]; x: number; y: number; flip: boolean }[] {
  const flight = pigeonFlight(world);
  if (flight >= 1) return [];
  const leaving = world.pigeons.scatteredAt !== null && world.t - world.pigeons.scatteredAt < PIGEON_FLIGHT_MS;
  return PIGEON_HOMES.map((home, i) => {
    if (flight > 0) {
      const eased = flight * flight;
      return {
        matrix: PIGEON.fly[Math.floor(world.t / 90 + i) % 2],
        x: Math.round(home.x + home.away[0] * eased),
        y: Math.round(LAYOUT.ledgeTop - 8 + home.away[1] * eased),
        // Fly away facing the way they are headed; come home facing back in.
        flip: leaving ? home.away[0] < 0 : home.away[0] > 0,
      };
    }
    const bob = hash(i, Math.floor(world.t / 620)) < 0.3 ? 1 : 0;
    const turned = hash(i + 9, Math.floor(world.t / 5200)) < 0.35 ? !home.flip : home.flip;
    return { matrix: PIGEON.stand[bob], x: home.x, y: LAYOUT.ledgeTop - 8, flip: turned };
  });
}

export function drawPigeons(s: Surface, world: World): void {
  for (const pigeon of pigeonSprites(world)) s.sprite(pigeon.matrix, pigeon.x, pigeon.y, { flip: pigeon.flip });
}

// --- boombox --------------------------------------------------------------------------------------

const BOOMBOX_SHELL: Gloss = { body: 'W', band: 'w', light: 'h', lo: 'M', outline: 'K', bandTop: 0, bandHeight: 2 };

export function drawBoombox(s: Surface, world: World): void {
  const { x, y, w, h } = LAYOUT.boombox;
  const { playing } = world.boombox;
  const beat = playing ? Math.floor(world.t / 250) % 2 : 0;
  const spin = playing ? Math.floor(world.t / 180) % 2 : 0;
  const top = y + 8;
  const deckX = x + 20;

  // Only a few distinct looks (off, and beat x reel while playing), each drawn once.
  const body = memoSurface(`boombox:${playing}:${beat}:${spin}`, w + 2, h + 4, (m) => {
    // Glossy white shell with its corners knocked off.
    m.paint(rect(0, top - y + 1, w + 2, 22), (px, py) => glossKeyAt(px, py - (top - y + 1), w + 2, 22, BOOMBOX_SHELL));

    m.offset(1 - x, 2 - y);
    // Chrome handle and antenna.
    m.rect(x + 12, y + 2, w - 24, 1, 'W');
    m.rect(x + 12, y + 3, w - 24, 1, 'D');
    m.rect(x + 12, y + 3, 2, 5, 'D');
    m.rect(x + w - 14, y + 3, 2, 5, 'D');
    for (let i = 0; i < 9; i++) m.px(x + w - 5 + Math.floor(i / 2), top - 1 - i, i === 8 ? 'w' : 'M');

    // Speakers: water-teal cones that push out on the beat, each with a gloss pixel.
    for (const cx of [x + 10, x + w - 11]) {
      const cy = top + 11;
      for (let dy = -7; dy <= 7; dy++) {
        for (let dx = -7; dx <= 7; dx++) {
          const d = dx * dx + dy * dy;
          if (d > 52) continue;
          m.px(cx + dx, cy + dy, d > 38 ? 'K' : d > 22 - beat * 8 ? 'D' : d > 5 ? 'A' : playing && beat ? 'I' : 'C');
        }
      }
      m.px(cx - 3, cy - 3, 'w');
      m.px(cx - 2, cy - 4, 'w');
    }

    // Tape deck and transport keys.
    m.rect(deckX, top + 4, 14, 8, 'K');
    m.rect(deckX + 1, top + 5, 12, 6, 'N');
    m.rect(deckX + 3, top + 7, 2, 2, spin ? 'W' : 'M');
    m.rect(deckX + 9, top + 7, 2, 2, spin ? 'M' : 'W');
    ['A', 'L', 'Y', 'H'].forEach((key, i) => m.rect(deckX + 1 + i * 3, top + 14, 2, 3, key));
  });
  s.blit(body.canvas, x - 1, y - 2);

  if (playing) {
    // A little level meter above the deck.
    for (let i = 0; i < 6; i++) {
      const level = 1 + Math.floor(hash(i, Math.floor(world.t / 125)) * 3);
      s.rect(deckX + 1 + i * 2, top + 4 - level, 1, level, i < 4 ? 'G' : 'A');
    }
  }
}

// --- messenger window ---------------------------------------------------------------------------------

export const IM_FIELD_COLUMNS = Math.floor((IM.field.w - 8) / FONTS.vt.advance);
const IM_LOG_COLUMNS = Math.floor((IM.log.w - 6) / FONTS.vt.advance);

/** The window frame, title bar, buttons and empty fields. Drawn once. */
function messengerChrome(): Surface {
  const { window: win, titleH, log, field } = IM;
  const { x, y, w, h } = win;
  return memoSurface('messenger-chrome', w + 6, h + 6, (s) => {
    s.offset(1 - x, 1 - y);
    s.shade(x + 3, y + 3, w, h, 'K', 8);
    s.rect(x, y, w, h, 'W');
    s.bevel(x, y, w, h, 'w', 'M');
    s.roundFrame(x - 1, y - 1, w + 2, h + 2, 'K');

    // Glossy title bar: violet with an icy highlight across the top half.
    const bar = rect(x + 2, y + 2, w - 4, titleH - 2);
    s.rect(bar.x, bar.y, bar.w, bar.h, 'V');
    s.rect(bar.x, bar.y, bar.w, 1, 'I');
    s.shade(bar.x, bar.y + 1, bar.w, 2, 'I', 10);
    s.shade(bar.x, bar.y + 3, bar.w, 2, 'I', 4);
    s.rect(bar.x, bar.y + bar.h - 2, bar.w, 2, 'U');
    s.shade(bar.x, bar.y + bar.h - 4, bar.w, 2, 'U', 6);
    s.rect(bar.x + 3, bar.y + 3, 6, 6, 'K');
    s.text('HypeMan', bar.x + 14, bar.y + 3, 'ps8', 'U');
    s.text('HypeMan', bar.x + 13, bar.y + 2, 'ps8', 'w');

    // Three tiny title-bar buttons: minimise, maximise, close.
    ['_', 'o', 'x'].forEach((glyph, i) => {
      const bx = bar.x + bar.w - 32 + i * 10;
      const by = bar.y + 1;
      const close = glyph === 'x';
      s.rect(bx, by, 9, 9, close ? 'H' : 'W');
      s.bevel(bx, by, 9, 9, close ? 'Y' : 'w', close ? 'o' : 'D');
      if (glyph === '_') s.rect(bx + 2, by + 6, 5, 1, 'K');
      if (glyph === 'o') s.frame(bx + 2, by + 2, 5, 5, 'K');
      if (close) {
        for (let d = 0; d < 5; d++) {
          s.px(bx + 2 + d, by + 2 + d, 'w');
          s.px(bx + 6 - d, by + 2 + d, 'w');
        }
      }
    });

    for (const pane of [log, field]) {
      s.rect(pane.x, pane.y, pane.w, pane.h, 'w');
      s.bevel(pane.x, pane.y, pane.w, pane.h, 'D', 'W');
    }
  });
}

function drawBolt(s: Surface): void {
  const { send } = IM;
  s.sprite(BOLT, send.x + ((send.w - BOLT[0].length) >> 1), send.y + ((send.h - BOLT.length) >> 1));
}

export function drawMessenger(s: Surface, world: World): void {
  const { window: win, log, field } = IM;
  s.blit(messengerChrome().canvas, win.x - 1, win.y - 1);

  // Presence dot: green while the mic is live.
  const live = world.micLive && Math.floor(world.t / 400) % 4 !== 3;
  s.rect(win.x + 6, win.y + 6, 4, 4, live ? 'G' : 'D');
  s.px(win.x + 6, win.y + 6, live ? 'w' : 'M');

  // The newest lines win: a long reply takes both rows, two short ones share them.
  const rows = world.im.log.slice(-2).flatMap((line) => {
    const who = line.who === 'you' ? 'you:' : 'hype:';
    return wrapText(`${who} ${line.text}`, IM_LOG_COLUMNS).map((text, i) => ({ text, who: i === 0 ? who : '', from: line.who }));
  });
  rows.slice(-2).forEach((row, i) => {
    const ly = log.y + 1 + i * 15;
    s.text(row.text, log.x + 3, ly, 'vt', 'K');
    if (row.who) s.text(row.who, log.x + 3, ly, 'vt', row.from === 'you' ? 'U' : 'A');
  });
  if (!rows.length) s.text('hype: yo! say the word.', log.x + 3, log.y + 1, 'vt', 'M');

  // Message field with its block cursor.
  const tx = field.x + 4;
  const ty = field.y + 3;
  const { text, caret, focused } = world.im;
  const first = Math.max(0, caret - (IM_FIELD_COLUMNS - 1));
  if (text) s.text(text.slice(first, first + IM_FIELD_COLUMNS), tx, ty, 'vt', 'K');
  else s.text('what are we working on?', tx, ty, 'vt', 'M');
  if (Math.floor(world.t / 530) % 2 === 0) {
    const cx = tx + (caret - first) * FONTS.vt.advance;
    s.rect(cx, ty + 2, 7, 12, focused ? 'U' : 'D');
    const under = text[caret];
    if (under && under !== ' ') s.text(under, cx, ty, 'vt', 'w');
  }

  drawBolt(s);
}

// --- corner buttons -----------------------------------------------------------------------------------

function drawButton(s: Surface, r: Rect, label: string, led: 'on' | 'off' | null, pressed: boolean): void {
  const face = memoSurface(`button:${label}:${led}:${pressed}`, r.w + 2, r.h + 2, (m) => {
    m.rect(1, 1, r.w, r.h, pressed ? 'M' : 'W');
    if (pressed) m.bevel(1, 1, r.w, r.h, 'D', 'w');
    else m.bevel(1, 1, r.w, r.h, 'w', 'D');
    m.roundFrame(0, 0, r.w + 2, r.h + 2, 'K');
    const shift = pressed ? 2 : 1;
    if (led) {
      m.rect(3 + shift, 4 + shift, 4, 4, 'K');
      m.rect(4 + shift, 5 + shift, 2, 2, led === 'on' ? 'G' : 'D');
    }
    m.text(label, (led ? 9 : 6) + shift, 3 + shift, 'ps8', 'K');
  });
  s.blit(face.canvas, r.x - 1, r.y - 1);
}

export function drawButtons(s: Surface, world: World, pressed: PropId | null): void {
  const { show, sound, mic } = LAYOUT.buttons;
  drawButton(s, show, 'HIDE', null, pressed === 'show');
  drawButton(s, sound, 'SOUND', world.soundOn ? 'on' : 'off', pressed === 'sound');
  const micLed = world.micLive && Math.floor(world.t / 400) % 4 !== 3;
  drawButton(s, mic, 'MIC', micLed ? 'on' : 'off', pressed === 'mic');
}

// --- hit areas, labels and tooltips --------------------------------------------------------------------

export interface PropInfo {
  id: PropId;
  rect: Rect;
  /** Spoken by screen readers. */
  label: string;
  /** Shown in the pixel tooltip. */
  tip: string;
  /** For toggles: exposed as aria-pressed. */
  pressed?: boolean;
}

/** Scene-mode props in tab order. HypeMan's rect follows him, so the Scene supplies it. */
export function sceneProps(world: World, hypemanRect: Rect): PropInfo[] {
  const clock = formatClock(world.now, world.jumbotron.h24);
  const channel = CRT_CHANNELS[world.crt.channel];
  return [
    { id: 'sky', rect: LAYOUT.sky, label: 'Sky. Activate to launch a shooting star at night or a cloud puff by day.', tip: world.glow > 0.5 ? 'make a wish' : 'poke the sky' },
    { id: 'jumbotron', rect: rect(LAYOUT.jumbotron.x, LAYOUT.jumbotron.y, LAYOUT.jumbotron.w, 40), label: `Jumbotron clock, ${clock.time.trim()} ${clock.suffix}. Activate to switch between 12 and 24 hour time and flash the date.`, tip: world.jumbotron.h24 ? '24h > 12h' : '12h > 24h' },
    { id: 'graffiti', rect: LAYOUT.graffiti, label: 'HypeMan graffiti tag. Activate to make it shimmer.', tip: 'make it shine' },
    { id: 'crt', rect: LAYOUT.crt, label: `CRT television, showing the ${channel} channel. Activate to change channel.`, tip: `ch${world.crt.channel + 1}: ${channel}` },
    { id: 'pigeons', rect: LAYOUT.pigeons, label: pigeonsAreBack(world) ? 'Pigeons on the ledge. Activate to scatter them.' : 'The pigeons have flown off. They come back in a few seconds.', tip: pigeonsAreBack(world) ? 'shoo!' : 'brb' },
    { id: 'hypeman', rect: hypemanRect, label: 'HypeMan. Left and right arrow keys walk him along the rooftop. Enter or Space hypes him up.', tip: 'drag me / 2x click' },
    { id: 'boombox', rect: LAYOUT.boombox, label: `Boombox. Music is ${world.boombox.playing ? 'on' : 'off'}. Activate to turn it ${world.boombox.playing ? 'off' : 'on'}.`, tip: world.boombox.playing ? 'stop the music' : 'play something', pressed: world.boombox.playing },
    { id: 'send', rect: IM.send, label: 'Send message', tip: 'send it' },
    { id: 'show', rect: LAYOUT.buttons.show, label: 'Hide the rooftop scene', tip: 'tuck the roof away' },
    { id: 'sound', rect: LAYOUT.buttons.sound, label: `Sound is ${world.soundOn ? 'on' : 'off'}`, tip: world.soundOn ? 'mute' : 'unmute', pressed: world.soundOn },
    { id: 'mic', rect: LAYOUT.buttons.mic, label: `Microphone is ${world.micLive ? 'live' : 'off'}`, tip: world.micLive ? 'mic is live' : 'go live', pressed: world.micLive },
  ];
}

/**
 * The 1px cyan hover/focus outline for a prop. Sprites and the tag get an
 * outline that hugs their silhouette; boxy props get a box.
 */
export function drawPropOutline(s: Surface, id: PropId, world: World): void {
  const box = (r: Rect) => s.roundFrame(r.x - 2, r.y - 2, r.w + 4, r.h + 4, 'C');
  switch (id) {
    case 'jumbotron':
      return box(rect(LAYOUT.jumbotron.x, LAYOUT.jumbotron.y, LAYOUT.jumbotron.w, 40));
    case 'graffiti': {
      tagArt ??= buildTag();
      const art = tagArt;
      tagOutline ??= outlineCanvas(art.w, art.h, (x, y) => art.cells[y * art.w + x] !== Cell.None);
      const { x, y } = tagOrigin(art);
      return s.blit(tagOutline, x - 1, y - 1);
    }
    case 'crt':
      return box(CRT_BODY);
    case 'pigeons':
      for (const pigeon of pigeonSprites(world)) s.blit(matrixOutline(pigeon.matrix, pigeon.flip), pigeon.x - 1, pigeon.y - 1);
      return;
    case 'boombox':
      return box(rect(LAYOUT.boombox.x, LAYOUT.boombox.y + 8, LAYOUT.boombox.w, 20));
    case 'send':
      return s.blit(matrixOutline(BOLT), IM.send.x + ((IM.send.w - BOLT[0].length) >> 1) - 1, IM.send.y + ((IM.send.h - BOLT.length) >> 1) - 1);
    case 'show':
    case 'sound':
    case 'mic':
      return box(LAYOUT.buttons[id]);
    default:
      return;
  }
}
