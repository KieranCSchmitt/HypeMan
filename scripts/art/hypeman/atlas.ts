import { FRAME_H, FRAME_W, IDLE_0, type Frame } from './frames';
import { createBitmap, paintMatrix, validateFrame, type Bitmap } from './raster';

export const STATES = [
  'idle',
  'greet',
  'listening',
  'thinking',
  'talking',
  'point',
  'hype',
  'walk',
  'afk',
] as const;

export type HypeState = (typeof STATES)[number];

/** How a state is authored: its frames plus how long each one stays on screen. */
export interface AnimationSource {
  frames: readonly Frame[];
  /** Milliseconds per frame, same length as `frames`. */
  durations: readonly number[];
  loop: boolean;
  /** For one-shot states: stay on the last frame instead of returning to idle. */
  holdLast?: boolean;
  /** Marks the LAST frame as a blink: it is left out of the loop and flashed at random intervals. */
  blink?: BlinkTiming;
}

export interface BlinkTiming {
  /** How long the blink frame shows, in milliseconds. */
  holdMs: number;
  /** Shortest and longest gap between blinks, in milliseconds. */
  everyMs: [number, number];
}

/**
 * The authored animations. A state missing from this map has no art yet and
 * plays the idle strip instead (see `resolveAnimation`).
 */
export const ANIMATIONS: Partial<Record<HypeState, AnimationSource>> = {
  idle: { frames: [IDLE_0], durations: [600], loop: true },
};

// --- atlas (the JSON that ships next to the sprite sheet) ---

export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Milliseconds. */
  duration: number;
  /** Marker pixels found in this frame, in frame-local coordinates. */
  anchors: Record<string, [number, number]>;
}

export interface AtlasAnimation {
  frames: AtlasFrame[];
  loop: boolean;
  holdLast: boolean;
  /** Present when one frame is a blink; `frame` is its index (always the last). */
  blink?: BlinkTiming & { frame: number };
}

export interface Atlas {
  meta: {
    image: string;
    frameWidth: number;
    frameHeight: number;
    sheetWidth: number;
    sheetHeight: number;
    version: 1;
  };
  animations: Partial<Record<HypeState, AtlasAnimation>>;
}

export interface SpriteSheet {
  bitmap: Bitmap;
  atlas: Atlas;
}

/**
 * Renders every authored animation into one sheet: one horizontal strip per
 * state, stacked in STATES order, all frames the same size.
 */
export function buildSpriteSheet(imageName = 'hypeman_sheet.png'): SpriteSheet {
  const authored = STATES.filter((state) => ANIMATIONS[state]);
  const columns = Math.max(...authored.map((state) => ANIMATIONS[state]!.frames.length));
  const bitmap = createBitmap(columns * FRAME_W, authored.length * FRAME_H);
  const atlas: Atlas = {
    meta: {
      image: imageName,
      frameWidth: FRAME_W,
      frameHeight: FRAME_H,
      sheetWidth: bitmap.width,
      sheetHeight: bitmap.height,
      version: 1,
    },
    animations: {},
  };

  authored.forEach((state, row) => {
    const source = ANIMATIONS[state]!;
    if (source.durations.length !== source.frames.length) {
      throw new Error(`${state}: ${source.frames.length} frames but ${source.durations.length} durations`);
    }
    const frames = source.frames.map((frame, column) => {
      validateFrame(frame, `${state}[${column}]`);
      const x = column * FRAME_W;
      const y = row * FRAME_H;
      const anchors = paintMatrix(bitmap, frame, x, y);
      return { x, y, w: FRAME_W, h: FRAME_H, duration: source.durations[column], anchors };
    });
    if (source.loop !== PLAYBACK[state].loop) {
      throw new Error(`${state}: loop should be ${PLAYBACK[state].loop}`);
    }
    atlas.animations[state] = {
      frames,
      loop: source.loop,
      holdLast: source.holdLast ?? false,
      ...(source.blink ? { blink: { ...source.blink, frame: frames.length - 1 } } : {}),
    };
  });

  return { bitmap, atlas };
}

/** Whether each state loops, plays once, or plays once and holds its last frame. */
export const PLAYBACK: Record<HypeState, { loop: boolean; holdLast: boolean }> = {
  idle: { loop: true, holdLast: false },
  greet: { loop: false, holdLast: false },
  listening: { loop: true, holdLast: false },
  thinking: { loop: true, holdLast: false },
  talking: { loop: true, holdLast: false },
  point: { loop: false, holdLast: true },
  hype: { loop: false, holdLast: false },
  walk: { loop: true, holdLast: false },
  afk: { loop: true, holdLast: false },
};

/**
 * The animation to play for a state. A state with no art borrows idle's
 * frames but keeps its own playback rules, so a one-shot still ends.
 */
export function resolveAnimation(atlas: Atlas, state: HypeState): AtlasAnimation {
  const own = atlas.animations[state];
  if (own) return own;
  const idle = atlas.animations.idle;
  if (!idle) throw new Error('Atlas has no idle animation');
  return { frames: idle.frames.filter((_, i) => i !== idle.blink?.frame), ...PLAYBACK[state] };
}
