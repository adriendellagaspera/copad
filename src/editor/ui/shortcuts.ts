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
    { keys: [mod, keyCap('Shift'), keyCap('X')], label: shortcutLabel('Strikethrough') },
    { keys: [mod, keyCap('Shift'), keyCap('U')], label: shortcutLabel('Underline') },
    { keys: [mod, keyCap('Shift'), keyCap('C')], label: shortcutLabel('Inline code') },
    { keys: [mod, keyCap('K')], label: shortcutLabel('Link') },
    { keys: [keyCap('/')], label: shortcutLabel('Commands') },
    { keys: [keyCap('Alt'), keyCap('Shift'), keyCap('\\')], label: shortcutLabel('Toolbar') },
    { keys: [mod, keyCap('Z')], label: shortcutLabel('Undo') },
  ];
}

/**
 * The shortcuts relevant while the caret sits in a table — swapped in for
 * {@link editorShortcuts} instead of appended to it, since the footer strip
 * has no room to show both sets of a dozen-plus hints at once. Mirrors the
 * table-structure keymap in `plugins.ts`'s `buildPlugins` (`Alt-Shift-R/C`
 * to add a row/column, `Alt-Shift-Backspace`/`Mod-Alt-Shift-Backspace` to
 * delete one, `Alt-Shift-H` to toggle the header row) plus the entry point
 * into the table's own floating panel — none of which are reachable via
 * the `/` slash menu, so without this strip they'd have no discoverable
 * hint anywhere in the app.
 *
 * The panel's entry point is shown here as `Alt-Shift-\`, not `Shift-F10` —
 * both work (see `SelectionToolbar.svelte`'s keydown handler), but
 * `Shift-F10` alone needs `Fn` on most Mac laptop keyboards (F-keys are
 * remapped to hardware functions there by default), while `Alt-Shift-\`
 * needs no `Fn` hunting on any platform. Punctuation rather than a letter,
 * after two letter-based attempts (`Alt-Enter`, `Alt-Shift-T`) each turned
 * out to already mean something else on some real setup (a window
 * manager's fullscreen toggle, a browser's reopen-closed-tab binding) —
 * see that same doc comment for the details. One hint fits the strip;
 * this is the one that works everywhere without a caveat.
 */
export function tableShortcuts(os: OS = parseOS()): Shortcut[] {
  const mod = modKey(os);
  return [
    { keys: [keyCap('Tab')], label: shortcutLabel('Next cell') },
    { keys: [keyCap('Alt'), keyCap('Shift'), keyCap('R')], label: shortcutLabel('Add row') },
    { keys: [keyCap('Alt'), keyCap('Shift'), keyCap('⌫')], label: shortcutLabel('Delete row') },
    { keys: [keyCap('Alt'), keyCap('Shift'), keyCap('C')], label: shortcutLabel('Add column') },
    { keys: [mod, keyCap('Alt'), keyCap('Shift'), keyCap('⌫')], label: shortcutLabel('Delete column') },
    { keys: [keyCap('Alt'), keyCap('Shift'), keyCap('H')], label: shortcutLabel('Toggle header') },
    { keys: [keyCap('Alt'), keyCap('Shift'), keyCap('\\')], label: shortcutLabel('Table toolbar') },
  ];
}

/** Picks {@link tableShortcuts} or {@link editorShortcuts} for the footer
 *  strip depending on where the caret is right now — see {@link tableShortcuts}'s
 *  doc comment for why this is a swap, not a merge. */
export function contextualShortcuts(inTable: boolean, os: OS = parseOS()): Shortcut[] {
  return inTable ? tableShortcuts(os) : editorShortcuts(os);
}
