/**
 * Glitch's palette: the shared Aero palette plus his own colours.
 *
 * His hair, windbreaker, cargo pants, sneakers and keychain are all drawn
 * in shared swatches, so the only additions are his skin ramp (3 of the 12
 * extra colours a character may add).
 */
import { PALETTE as SHARED, type Swatch } from '../../hypeman/palette';

export const EXTRA = {
  '1': { name: 'Skin light', hex: '#F0C8A0' },
  '2': { name: 'Skin mid', hex: '#D9A77F' },
  '3': { name: 'Skin shadow', hex: '#B5825E' },
} as const satisfies Record<string, Swatch>;

export const PALETTE = { ...SHARED, ...EXTRA };
