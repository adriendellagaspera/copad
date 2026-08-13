// Deliberately shared across every room this browser opens. Colour stays
// unpersisted by default so two tabs of one browser read apart (docs/contract.md §7).

import type { DisplayName, CursorColor } from './types.js';
import { parseDisplayName, parseStoredColor } from './parse.js';
import { localStore } from '../persistence/local.js';
import { nsKey } from '../config.js';
import { now } from '../time.js';

const nameStore = localStore<DisplayName>(nsKey('identity-name'), parseDisplayName, (v) => v);

export function storedName(): DisplayName {
  return nameStore.read();
}

export function rememberName(raw: string): DisplayName {
  const parsed = parseDisplayName(raw);
  nameStore.write(parsed);
  return parsed;
}

function pickPaletteColor(palette: readonly CursorColor[]): CursorColor {
  return palette[Math.floor((now() / 1000) % palette.length)];
}

function colorStore(palette: readonly CursorColor[]) {
  return localStore<CursorColor>(
    nsKey('identity-color'),
    (raw) => parseStoredColor(raw, palette, () => pickPaletteColor(palette)),
    (v) => v,
  );
}

export function storedColor(palette: readonly CursorColor[]): CursorColor {
  return colorStore(palette).read();
}

export function rememberColor(color: CursorColor, palette: readonly CursorColor[]): void {
  colorStore(palette).write(color);
}
