/** Native scene resolution. Everything below is in these pixels. */
export const SCENE_W = 480;
export const SCENE_H = 270;

/** The collapsed dock: just HypeMan and room for his speech bubble. */
export const DOCK_W = 224;
export const DOCK_H = 112;

/** Background art is drawn this far past every edge so parallax never shows a gap. */
export const BLEED = 4;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

/** Where things sit on the rooftop. */
export const LAYOUT = {
  /** Top of the parapet in the open gap; pigeons stand here. */
  ledgeTop: 188,
  floorTop: 206,
  /** HypeMan's feet. */
  walkY: 262,
  /** How far his centre can travel along the walk line. */
  walkMinX: 146,
  walkMaxX: 398,
  homeX: 180,

  leftWall: rect(0, 116, 124, 90),
  rightWall: rect(232, 96, 248, 110),

  sky: rect(0, 0, SCENE_W, 96),
  jumbotron: rect(8, 20, 114, 46),
  graffiti: rect(4, 122, 116, 30),
  crt: rect(4, 170, 118, 82),
  pigeons: rect(134, 176, 92, 14),
  boombox: rect(412, 232, 54, 28),
  im: rect(244, 106, 224, 82),

  buttons: {
    show: rect(4, 255, 44, 13),
    sound: rect(51, 255, 52, 13),
    mic: rect(106, 255, 36, 13),
  },
} as const;

/** Pieces of the instant-messenger window, relative to the scene. */
export const IM = (() => {
  const w = LAYOUT.im;
  const titleH = 14;
  const log = rect(w.x + 4, w.y + titleH + 3, w.w - 8, 33);
  const field = rect(w.x + 4, log.y + log.h + 3, 193, 22);
  const send = rect(field.x + field.w + 3, field.y, w.w - 8 - field.w - 3, 22);
  return { window: w, titleH, log, field, send };
})();

/** Mouse parallax per layer, in native pixels (the rooftop is the fixed reference). */
export const PARALLAX = { sky: 3, far: 2, near: 1 } as const;

export const AFK_AFTER_MS = 2 * 60 * 1000;
export const PIGEON_AWAY_MS = 10 * 1000;
export const BLIMP_PERIOD_MS = 90 * 1000;
export const PHASE_FADE_MS = 60 * 1000;
