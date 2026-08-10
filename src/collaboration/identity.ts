/**
 * This browser's remembered identity — display name and cursor colour, the
 * two fields `IdentityMenu` edits. Global to the browser profile and
 * namespaced per deployment, the same scope `browserId` uses and for the
 * same reason: an identity belongs to the person typing, not a room, so it
 * is deliberately shared across every room this browser opens.
 *
 * `rememberColor`/`storedColor` exist so a caller *can* persist colour, but
 * see the identity report for why wiring them into `App.svelte` is not
 * recommended (docs/contract.md §7, "Another tab of yours": once name is
 * shared across tabs of one browser, an unpersisted, freshly-picked-per-load
 * colour is what still lets two of your own tabs' cursors read apart in the
 * same room).
 */

import type { DisplayName, CursorColor } from './types.js';
import { parseDisplayName } from './parse.js';
import { localStore } from '../persistence/local.js';
import { nsKey } from '../config.js';
import { now } from '../time.js';

const nameStore = localStore<DisplayName>(nsKey('identity-name'), parseDisplayName, (v) => v);

/** This browser's remembered display name, defaulting per {@link parseDisplayName}. */
export function storedName(): DisplayName {
  return nameStore.read();
}

/** Parse and persist a name typed at the identity-menu IO boundary. */
export function rememberName(raw: string): DisplayName {
  const parsed = parseDisplayName(raw);
  nameStore.write(parsed);
  return parsed;
}

/** Today's first-visit pick: cycles the palette on a clock, same formula
 *  `App.svelte` used before persistence existed. */
function pickPaletteColor(palette: readonly CursorColor[]): CursorColor {
  return palette[Math.floor((now() / 1000) % palette.length)];
}

/** Parse a stored colour against the *current* palette — the single
 *  narrowing site for CursorColor from localStorage. A value absent, or no
 *  longer in the palette (a shrunk/reordered `COLORS`), degrades to a fresh
 *  palette pick rather than surfacing an unknown colour. */
function parseStoredColor(raw: string | null, palette: readonly CursorColor[]): CursorColor {
  return raw && (palette as readonly string[]).includes(raw)
    ? (raw as CursorColor)
    : pickPaletteColor(palette);
}

function colorStore(palette: readonly CursorColor[]) {
  return localStore<CursorColor>(
    nsKey('identity-color'),
    (raw) => parseStoredColor(raw, palette),
    (v) => v,
  );
}

/** This browser's remembered cursor colour, or a fresh palette pick when
 *  nothing valid is stored. */
export function storedColor(palette: readonly CursorColor[]): CursorColor {
  return colorStore(palette).read();
}

/** Persist a colour chosen from `palette` at the identity-menu IO boundary. */
export function rememberColor(color: CursorColor, palette: readonly CursorColor[]): void {
  colorStore(palette).write(color);
}
