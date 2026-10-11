/**
 * The character roster.
 *
 * HypeMan is registered from where he already lives (../hypeman); the five
 * newer characters each keep their palette and frames in their own folder
 * beside this file. Every character is drawn on the same 32x48 frame, in
 * the shared Aero palette plus at most MAX_EXTRA_COLOURS of its own.
 *
 * In the HypeMan repo this folder belongs at scripts/art/characters/.
 */
import { IDLE_0 as HYPEMAN_IDLE_0, type Frame } from '../hypeman/frames';
import { PALETTE as SHARED, type Swatch } from '../hypeman/palette';
import { IDLE_0 as BREEZE_IDLE_0 } from './breeze/frames';
import { EXTRA as BREEZE_EXTRA } from './breeze/palette';
import { IDLE_0 as GLITCH_IDLE_0 } from './glitch/frames';
import { EXTRA as GLITCH_EXTRA } from './glitch/palette';
import { IDLE_0 as ORBIT_IDLE_0 } from './orbit/frames';
import { EXTRA as ORBIT_EXTRA } from './orbit/palette';
import { IDLE_0 as RALLY_IDLE_0 } from './rally/frames';
import { EXTRA as RALLY_EXTRA } from './rally/palette';
import { IDLE_0 as SPARK_IDLE_0 } from './spark/frames';
import { EXTRA as SPARK_EXTRA } from './spark/palette';

export const MAX_EXTRA_COLOURS = 12;

export interface Character {
  id: string;
  name: string;
  /** Colours this character adds on top of the shared palette. */
  extra: Record<string, Swatch>;
  /** Idle frame 0, the base pose. */
  idle: Frame;
}

export const CHARACTERS: readonly Character[] = [
  { id: 'hypeman', name: 'HypeMan', extra: {}, idle: HYPEMAN_IDLE_0 },
  { id: 'glitch', name: 'Glitch', extra: GLITCH_EXTRA, idle: GLITCH_IDLE_0 },
  { id: 'rally', name: 'Rally', extra: RALLY_EXTRA, idle: RALLY_IDLE_0 },
  { id: 'orbit', name: 'Orbit', extra: ORBIT_EXTRA, idle: ORBIT_IDLE_0 },
  { id: 'breeze', name: 'Breeze', extra: BREEZE_EXTRA, idle: BREEZE_IDLE_0 },
  { id: 'spark', name: 'Spark', extra: SPARK_EXTRA, idle: SPARK_IDLE_0 },
];

/** The full palette a character may draw with: shared swatches plus its own. */
export function paletteOf(character: Character): Record<string, Swatch> {
  return { ...SHARED, ...character.extra };
}
