/**
 * Spark's palette: the shared Aero palette plus her own colours.
 *
 * Her hair, holographic puffer, long-sleeve, cargo pants, boots and console
 * are all drawn in shared swatches, so the only additions are her skin ramp
 * (3 of the 12 extra colours a character may add).
 */
import { PALETTE as SHARED, type Swatch } from '../../hypeman/palette';

export const EXTRA = {
  '1': { name: 'Skin light', hex: '#B67D55' },
  '2': { name: 'Skin mid', hex: '#96613D' },
  '3': { name: 'Skin shadow', hex: '#714427' },
} as const satisfies Record<string, Swatch>;

export const PALETTE = { ...SHARED, ...EXTRA };
