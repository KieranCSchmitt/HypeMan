import { PHASE_FADE_MS } from './constants';
import type { Ink } from './surface';

export type Phase = 'dawn' | 'day' | 'dusk' | 'night';

export const PHASES: readonly Phase[] = ['dawn', 'day', 'dusk', 'night'];

/** Local hour at which each phase begins. */
export const PHASE_START_HOUR: Record<Phase, number> = { dawn: 5, day: 8, dusk: 17.5, night: 20 };

/** Every colour decision that changes with the time of day, as palette inks. */
export interface Theme {
  /** Seven sky bands, zenith to horizon. */
  sky: Ink[];
  /** Colour used for the letterbox around the scene. */
  letterbox: string;
  body: 'sun' | 'lowSun' | 'moon';
  /** Share of the star field that is visible, 0..1. */
  stars: number;
  cloud: { light: string; shade: string };
  far: Ink;
  /** Rolling hills behind the towers: two ridges and the lit crest line. */
  hills: { back: string; front: string; crest: string };
  /** Foliage, lit from the top-left: trees on the hills and plants in the planters. */
  leaf: { light: string; mid: string; dark: string };
  /** Glass towers. `glint` panes catch the light; `streak` is the diagonal reflection. */
  near: { body: Ink; side: Ink; trim: string; pane: string; glint: string[]; lit: number; streak: string | null };
  /** Glossy metalwork: water tower, dish, scaffold. */
  metal: { gloss: string; light: string; body: string; lo: string };
  roof: {
    coping: string;
    parapet: Ink;
    parapetShade: string;
    floor: Ink;
    floorSpeck: string;
    /** The tiled wall behind the tag. */
    tile: string;
    tileHi: string;
    grout: string;
    /** The panelled wall behind the messenger window. */
    panel: Ink;
    panelSeam: string;
    panelHi: string;
    planter: { gloss: string; body: string; lo: string };
  };
  /** The reflecting pool. */
  pool: { rim: string; rimLo: string; water: string; band: string; ripple: string; glint: string };
  /** Ambient bubbles: the ring, and an outer ring for phases where a light ring would vanish. */
  bubble: { ring: string; shade: string; outline: string | null };
  /** How strongly lights glow: string lights, blimp beacon, tower beacons. */
  glow: number;
}

export const THEMES: Record<Phase, Theme> = {
  // Haze and sky pale, with peach at the horizon.
  dawn: {
    sky: ['B', 'Bp', 'p', 'ph', 'h', 'hH', 'H'],
    letterbox: 'p',
    body: 'lowSun',
    stars: 0.08,
    cloud: { light: 'w', shade: 'H' },
    far: 'pV',
    hills: { back: 'F', front: 'G', crest: 'L' },
    leaf: { light: 'L', mid: 'G', dark: 'F' },
    near: { body: 'p', side: 'V', trim: 'h', pane: 'I', glint: ['Y', 'h'], lit: 0.16, streak: 'Y' },
    metal: { gloss: 'w', light: 'W', body: 'M', lo: 'D' },
    roof: {
      coping: 'h',
      parapet: 'W',
      parapetShade: 'M',
      floor: 'M',
      floorSpeck: 'D',
      tile: 'h',
      tileHi: 'w',
      grout: 'c',
      panel: 'W',
      panelSeam: 'M',
      panelHi: 'h',
      planter: { gloss: 'Y', body: 'H', lo: 'o' },
    },
    pool: { rim: 'w', rimLo: 'M', water: 'A', band: 'H', ripple: 'I', glint: 'w' },
    bubble: { ring: 'w', shade: 'I', outline: null },
    glow: 0.4,
  },
  // The hero look: sky deep at the zenith down to haze at the horizon.
  day: {
    sky: ['U', 'UB', 'B', 'Bp', 'p', 'ph', 'h'],
    letterbox: 'B',
    body: 'sun',
    stars: 0,
    cloud: { light: 'w', shade: 'c' },
    far: 'Bp',
    hills: { back: 'F', front: 'G', crest: 'L' },
    leaf: { light: 'L', mid: 'G', dark: 'F' },
    near: { body: 'p', side: 'B', trim: 'w', pane: 'I', glint: ['h', 'w'], lit: 0.2, streak: 'w' },
    metal: { gloss: 'w', light: 'W', body: 'M', lo: 'D' },
    roof: {
      coping: 'w',
      parapet: 'W',
      parapetShade: 'M',
      floor: 'M',
      floorSpeck: 'D',
      tile: 'h',
      tileHi: 'w',
      grout: 'c',
      panel: 'W',
      panelSeam: 'M',
      panelHi: 'w',
      planter: { gloss: 'Y', body: 'H', lo: 'o' },
    },
    pool: { rim: 'w', rimLo: 'M', water: 'A', band: 'C', ripple: 'I', glint: 'w' },
    bubble: { ring: 'w', shade: 'I', outline: null },
    glow: 0,
  },
  // Peach at the horizon into lavender into sky deep. Soft, not neon.
  dusk: {
    sky: ['U', 'UV', 'V', 'VH', 'H', 'HY', 'Y'],
    letterbox: 'V',
    body: 'lowSun',
    stars: 0.15,
    cloud: { light: 'Y', shade: 'H' },
    far: 'VU',
    hills: { back: 'N', front: 'F', crest: 'G' },
    leaf: { light: 'G', mid: 'F', dark: 'N' },
    near: { body: 'U', side: 'N', trim: 'V', pane: 'B', glint: ['Y', 'H', 'I'], lit: 0.3, streak: 'V' },
    metal: { gloss: 'Y', light: 'W', body: 'M', lo: 'D' },
    roof: {
      coping: 'h',
      parapet: 'M',
      parapetShade: 'D',
      floor: 'D',
      floorSpeck: 'N',
      tile: 'c',
      tileHi: 'h',
      grout: 'M',
      panel: 'M',
      panelSeam: 'D',
      panelHi: 'W',
      planter: { gloss: 'H', body: 'o', lo: 'x' },
    },
    pool: { rim: 'W', rimLo: 'D', water: 'U', band: 'V', ripple: 'H', glint: 'Y' },
    bubble: { ring: 'w', shade: 'V', outline: null },
    glow: 0.7,
  },
  // Deep teal night, with ice and cyan in the windows.
  night: {
    sky: ['K', 'KN', 'N', 'N', 'N', 'NU', 'NU'],
    letterbox: 'N',
    body: 'moon',
    stars: 1,
    cloud: { light: 'U', shade: 'N' },
    far: 'KN',
    hills: { back: 'K', front: 'N', crest: 'F' },
    leaf: { light: 'G', mid: 'F', dark: 'N' },
    near: { body: 'K', side: 'K', trim: 'U', pane: 'N', glint: ['I', 'C', 'I', 'h'], lit: 0.42, streak: null },
    metal: { gloss: 'W', light: 'M', body: 'D', lo: 'N' },
    roof: {
      coping: 'M',
      parapet: 'f',
      parapetShade: 'N',
      floor: 'D',
      floorSpeck: 'N',
      tile: 'N',
      tileHi: 'U',
      grout: 'K',
      panel: 'N',
      panelSeam: 'K',
      panelHi: 'U',
      planter: { gloss: 'M', body: 'D', lo: 'N' },
    },
    pool: { rim: 'M', rimLo: 'N', water: 'N', band: 'U', ripple: 'B', glint: 'C' },
    bubble: { ring: 'I', shade: 'I', outline: 'K' },
    glow: 1,
  },
};

export function phaseAtHour(hour: number): Phase {
  if (hour >= PHASE_START_HOUR.night || hour < PHASE_START_HOUR.dawn) return 'night';
  if (hour >= PHASE_START_HOUR.dusk) return 'dusk';
  if (hour >= PHASE_START_HOUR.day) return 'day';
  return 'dawn';
}

export function previousPhase(phase: Phase): Phase {
  return PHASES[(PHASES.indexOf(phase) + PHASES.length - 1) % PHASES.length];
}

export interface PhaseBlend {
  from: Phase;
  to: Phase;
  /** 0 shows `from`, 1 shows `to`. */
  mix: number;
}

/**
 * Tracks the phase from the user's local clock. For the first 60 seconds of
 * a phase the previous one is still fading out. `force` pins a phase (the
 * demo and tests use it) and fades to it over `fadeMs`.
 */
export class DayClock {
  private forced: { phase: Phase; from: Phase; startedAt: number; fadeMs: number } | null = null;
  private last: PhaseBlend = { from: 'day', to: 'day', mix: 1 };

  constructor(private readonly now: () => Date = () => new Date()) {}

  force(phase: Phase | null, fadeMs = 3000): void {
    if (!phase) {
      this.forced = null;
      return;
    }
    const shown = this.last.mix >= 0.5 ? this.last.to : this.last.from;
    this.forced = { phase, from: shown, startedAt: performance.now(), fadeMs };
  }

  get isForced(): boolean {
    return this.forced !== null;
  }

  blend(): PhaseBlend {
    if (this.forced) {
      const { phase, from, startedAt, fadeMs } = this.forced;
      const mix = fadeMs <= 0 ? 1 : Math.min(1, (performance.now() - startedAt) / fadeMs);
      this.last = { from, to: phase, mix };
      return this.last;
    }
    const date = this.now();
    const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
    const phase = phaseAtHour(hour);
    const hoursIn = (hour - PHASE_START_HOUR[phase] + 24) % 24;
    const mix = Math.min(1, (hoursIn * 3600 * 1000 + date.getMilliseconds()) / PHASE_FADE_MS);
    this.last = { from: previousPhase(phase), to: phase, mix };
    return this.last;
  }
}
