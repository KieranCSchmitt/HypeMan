/**
 * Rally's palette: the shared Aero palette plus her own colours.
 *
 * Her track suit, sneakers, scrunchie and stopwatch are drawn in shared
 * swatches. The additions are her skin ramp and hair (4 of the 12 extra
 * colours a character may add). The skin shadow stays warm and saturated;
 * it is a deeper brown, not a grey.
 */
import { PALETTE as SHARED, type Swatch } from '../../hypeman/palette';

export const EXTRA = {
  '1': { name: 'Skin light', hex: '#8C5A3A' },
  '2': { name: 'Skin mid', hex: '#6E4329' },
  '3': { name: 'Skin shadow', hex: '#4F2D1A' },
  '4': { name: 'Hair', hex: '#1E1410' },
} as const satisfies Record<string, Swatch>;

export const PALETTE = { ...SHARED, ...EXTRA };
