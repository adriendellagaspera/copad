// The editor's headline keyboard shortcuts, as domain data.
//
// Kept out of the Svelte component (presentation only) and in a typed, testable
// module — like commands.ts / slashMenu.ts. Mirrors the keymap in
// src/editor/plugins.ts; keep the two in sync.

import { type KeyCap, keyCap, modKey, parseOS, type OS } from '../../ui/platform.js';

/** The human label for a shortcut's action (e.g. "Bold"). Branded so display
 *  copy can't be confused with another string; branded only by {@link shortcutLabel}. */
export type ShortcutLabel = string & { readonly _brand: 'ShortcutLabel' };

/** The single cast site for {@link ShortcutLabel}. */
export function shortcutLabel(raw: string): ShortcutLabel {
  return raw as ShortcutLabel;
}

/** A keyboard-shortcut hint: the caps to press and the action they perform. */
export interface Shortcut {
  readonly keys: readonly KeyCap[];
  readonly label: ShortcutLabel;
}

/**
 * The editor's headline shortcuts, with the modifier cap resolved for `os`
 * (defaults to the parsed current OS — parse-don't-validate at the boundary).
 */
export function editorShortcuts(os: OS = parseOS()): Shortcut[] {
  const mod = modKey(os);
  return [
    { keys: [mod, keyCap('B')], label: shortcutLabel('Bold') },
    { keys: [mod, keyCap('I')], label: shortcutLabel('Italic') },
    { keys: [mod, keyCap('K')], label: shortcutLabel('Link') },
    { keys: [keyCap('/')], label: shortcutLabel('Commands') },
    { keys: [mod, keyCap('Z')], label: shortcutLabel('Undo') },
  ];
}
