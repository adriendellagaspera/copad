import type { DisplayName, CursorColor } from './types.js';

/**
 * Operator-injectable peer defaults — overridable via `VITE_FALLBACK_NAME` and
 * `VITE_FALLBACK_COLOR`. Both must be valid values or the coded fallback applies:
 * names are trimmed non-empty strings; colors must be a 6-digit hex (#rrggbb).
 */

const rawName = (import.meta.env.VITE_FALLBACK_NAME ?? '').trim();
const rawColor = (import.meta.env.VITE_FALLBACK_COLOR ?? '').trim();

export const FALLBACK_NAME: DisplayName = (rawName || 'Anonymous') as DisplayName;

export const FALLBACK_COLOR: CursorColor = /^#[0-9a-fA-F]{6}$/.test(rawColor)
  ? (rawColor as CursorColor)
  : ('#888888' as CursorColor);
