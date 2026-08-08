// The editor's headline keyboard shortcuts, as domain data.
//
// Kept out of the Svelte component (presentation only) and in a typed, testable
// module — like commands.ts / slashMenu.ts. Mirrors the keymap in
// src/editor/plugins.ts; keep the two in sync.

import { type KeyCap, keyCap, modKey, altKey, parseOS, OS } from '../../ui/platform.js';

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
 * The floating-toolbar entry point, resolved per OS. Both a raw
 * `Alt-Shift-\` and the ARIA-standard `Shift-F10` open the panel (see
 * `SelectionToolbar.svelte`'s keydown handler); which one we *advertise*
 * differs by platform:
 *
 * - **Apple**: `Shift-F10`. `\` is not a directly accessible/labelled key on
 *   a Mac keyboard (an AZERTY layout produces it via a `⇧⌥/`-style compose,
 *   not a labelled key), so advertising `⌥⇧\` there points at a key the user
 *   can't find. `Shift-F10` is the standard keyboard shortcut for "open the
 *   context menu / toolbar", present and labelled on every keyboard (it costs
 *   an `Fn` on Mac laptops whose F-row defaults to hardware keys — the one
 *   accepted `Fn` in the set, since the no-`Fn` alternative isn't reliably
 *   *discoverable* here). The `⌥⇧\` binding stays live and `Fn`-free for
 *   anyone who finds it — it's matched on the physical Backslash key via
 *   `event.code`, so it works regardless of layout; it's just not the
 *   advertised hint on Apple.
 * - **Other**: `Alt-Shift-\`, where `\` is a normal labelled key.
 */
function toolbarEntryKeys(os: OS): KeyCap[] {
  return os === OS.Apple
    ? [keyCap('Shift'), keyCap('F10')]
    : [altKey(os), keyCap('Shift'), keyCap('\\')];
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
    // Toolbar entry point — Shift-F10 on Apple (`\` isn't a labelled key
    // there), Alt-Shift-\ elsewhere. See {@link toolbarEntryKeys}.
    { keys: toolbarEntryKeys(os), label: shortcutLabel('Toolbar') },
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
 * The panel's entry point resolves per OS via {@link toolbarEntryKeys}:
 * `Shift-F10` on Apple (where `\` isn't a labelled key), `Alt-Shift-\`
 * elsewhere. The `\` choice (over a letter) followed two letter-based
 * attempts (`Alt-Enter`, `Alt-Shift-T`) that each turned out to already mean
 * something else on some real setup (a window manager's fullscreen toggle, a
 * browser's reopen-closed-tab binding) — see `SelectionToolbar.svelte`'s
 * doc comment for the details.
 *
 * The per-command shortcuts (`⌥⇧R/C/H`, `⌥⇧⌫`, `⌘⌥⇧⌫`) are matched by
 * `prosemirror-keymap`'s keyCode fallback (`base[event.keyCode]`), which is
 * layout- and Option-compose-independent and — unlike Windows AltGr — is
 * *not* disabled for `metaKey` on Mac, so every one of them works `Fn`-free
 * on macOS including AZERTY (the letters/`⌫` are all labelled keys too).
 */
export function tableShortcuts(os: OS = parseOS()): Shortcut[] {
  const mod = modKey(os);
  const alt = altKey(os);
  return [
    { keys: [keyCap('Tab')], label: shortcutLabel('Next cell') },
    { keys: [alt, keyCap('Shift'), keyCap('R')], label: shortcutLabel('Add row') },
    { keys: [alt, keyCap('Shift'), keyCap('⌫')], label: shortcutLabel('Delete row') },
    { keys: [alt, keyCap('Shift'), keyCap('C')], label: shortcutLabel('Add column') },
    { keys: [mod, alt, keyCap('Shift'), keyCap('⌫')], label: shortcutLabel('Delete column') },
    { keys: [alt, keyCap('Shift'), keyCap('H')], label: shortcutLabel('Toggle header') },
    { keys: toolbarEntryKeys(os), label: shortcutLabel('Table toolbar') },
  ];
}

/** Picks {@link tableShortcuts} or {@link editorShortcuts} for the footer
 *  strip depending on where the caret is right now — see {@link tableShortcuts}'s
 *  doc comment for why this is a swap, not a merge. */
export function contextualShortcuts(inTable: boolean, os: OS = parseOS()): Shortcut[] {
  return inTable ? tableShortcuts(os) : editorShortcuts(os);
}
