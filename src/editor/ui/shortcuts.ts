// Mirrors the keymap in src/editor/plugins.ts; keep the two in sync.

import { type KeyCap, keyCap, modKey, altKey, parseOS, OS } from '../../ui/platform.js';

export type ShortcutLabel = string & { readonly _brand: 'ShortcutLabel' };

export function shortcutLabel(raw: string): ShortcutLabel {
  return raw as ShortcutLabel;
}

export interface Shortcut {
  readonly keys: readonly KeyCap[];
  readonly label: ShortcutLabel;
}

// Both Alt-Shift-\ and Shift-F10 open the panel; Apple shows Shift-F10 since `\` isn't a labelled Mac key.
function toolbarEntryKeys(os: OS): KeyCap[] {
  return os === OS.Apple
    ? [keyCap('Shift'), keyCap('F10')]
    : [altKey(os), keyCap('Shift'), keyCap('\\')];
}

export function editorShortcuts(os: OS = parseOS()): Shortcut[] {
  const mod = modKey(os);
  return [
    { keys: [mod, keyCap('B')], label: shortcutLabel('Bold') },
    { keys: [mod, keyCap('I')], label: shortcutLabel('Italic') },
    { keys: [mod, keyCap('Shift'), keyCap('X')], label: shortcutLabel('Strikethrough') },
    { keys: [mod, keyCap('Shift'), keyCap('U')], label: shortcutLabel('Underline') },
    { keys: [mod, keyCap('Shift'), keyCap('C')], label: shortcutLabel('Inline code') },
    { keys: [mod, keyCap('Shift'), keyCap('K')], label: shortcutLabel('Link') },
    { keys: [keyCap('/')], label: shortcutLabel('Commands') },
    { keys: toolbarEntryKeys(os), label: shortcutLabel('Toolbar') },
    { keys: [mod, keyCap('Z')], label: shortcutLabel('Undo') },
  ];
}

// Swapped in for editorShortcuts, not appended: the footer strip has no room for both. Alt-Enter/Alt-Shift-T were
// tried before `\` and each collided with a real OS/browser binding.
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

export function contextualShortcuts(inTable: boolean, os: OS = parseOS()): Shortcut[] {
  return inTable ? tableShortcuts(os) : editorShortcuts(os);
}
