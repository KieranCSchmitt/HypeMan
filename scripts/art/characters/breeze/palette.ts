/**
 * Breeze's palette: the shared Aero palette plus his own colours.
 *
 * His shirt, tee, carpenter pants, shoes, headphones and bottle are drawn in
 * shared swatches. The additions are his skin ramp and hair (5 of the 12
 * extra colours a character may add).
 */
import { PALETTE as SHARED, type Swatch } from '../../hypeman/palette';

export const EXTRA = {
  '1': { name: 'Skin light', hex: '#DDB088' },
  '2': { name: 'Skin mid', hex: '#BF9068' },
  '3': { name: 'Skin shadow', hex: '#96694A' },
  '4': { name: 'Hair', hex: '#201713' },
  '5': { name: 'Hair highlight', hex: '#3A2A22' },
} as const satisfies Record<string, Swatch>;

export const PALETTE = { ...SHARED, ...EXTRA };
