/**
 * Orbit's palette: the shared Aero palette plus her own colours.
 *
 * Her vest, long-sleeve, sneakers, headband and PDA are drawn in shared
 * swatches. The additions are her skin ramp, hair and denim (7 of the 12
 * extra colours a character may add).
 */
import { PALETTE as SHARED, type Swatch } from '../../hypeman/palette';

export const EXTRA = {
  '1': { name: 'Skin light', hex: '#C68B5E' },
  '2': { name: 'Skin mid', hex: '#A66E45' },
  '3': { name: 'Skin shadow', hex: '#80512F' },
  '4': { name: 'Hair', hex: '#3B2418' },
  '5': { name: 'Hair sheen', hex: '#5A3826' },
  '6': { name: 'Denim', hex: '#4A6FA5' },
  '7': { name: 'Denim fade', hex: '#6F90C0' },
} as const satisfies Record<string, Swatch>;

export const PALETTE = { ...SHARED, ...EXTRA };
