import { describe, it, expect } from 'vitest';
import { editorShortcuts, tableShortcuts, contextualShortcuts } from './shortcuts.js';
import { OS } from '../../ui/platform.js';

describe('editorShortcuts', () => {
  it('resolves the modifier cap to ⌘ on Apple', () => {
    const [bold] = editorShortcuts(OS.Apple);
    expect(bold.keys[0]).toBe('⌘');
    expect(bold.label).toBe('Bold');
  });

  it('resolves the modifier cap to Ctrl elsewhere', () => {
    expect(editorShortcuts(OS.Other)[0].keys[0]).toBe('Ctrl');
  });

  it('lists the headline actions in keymap order', () => {
    expect(editorShortcuts(OS.Other).map((s) => s.label)).toEqual([
      'Bold',
      'Italic',
      'Strikethrough',
      'Underline',
      'Inline code',
      'Link',
      'Commands',
      'Toolbar',
      'Undo',
    ]);
  });

  it('uses no modifier for the slash command', () => {
    const commands = editorShortcuts(OS.Apple).find((s) => s.label === 'Commands');
    expect(commands?.keys).toEqual(['/']);
  });

  it('advertises the toolbar entry as Shift-F10 on Apple, Alt-Shift-\\ elsewhere', () => {
    // Apple: Shift-F10 (\ isn't a labelled key there); never advertises \
    const apple = editorShortcuts(OS.Apple).find((s) => s.label === 'Toolbar');
    expect(apple?.keys).toEqual(['Shift', 'F10']);
    expect(editorShortcuts(OS.Apple).some((s) => s.keys.includes('\\' as never))).toBe(false);
    // Other: Alt-Shift-\
    const other = editorShortcuts(OS.Other).find((s) => s.label === 'Toolbar');
    expect(other?.keys).toEqual(['Alt', 'Shift', '\\']);
  });
});

describe('tableShortcuts', () => {
  it('lists the table-structure actions, mirroring the Alt-Shift-R/C/Backspace/H keymap', () => {
    expect(tableShortcuts(OS.Other).map((s) => s.label)).toEqual([
      'Next cell',
      'Add row',
      'Delete row',
      'Add column',
      'Delete column',
      'Toggle header',
      'Table toolbar',
    ]);
  });

  it('resolves the delete-column modifier cap per OS, same as the base shortcut list', () => {
    const deleteColumn = tableShortcuts(OS.Apple).find((s) => s.label === 'Delete column');
    expect(deleteColumn?.keys[0]).toBe('⌘');
    expect(tableShortcuts(OS.Other).find((s) => s.label === 'Delete column')?.keys[0]).toBe('Ctrl');
  });

  it('advertises the Table toolbar entry as Shift-F10 on Apple, keeps the per-command shortcuts', () => {
    const apple = tableShortcuts(OS.Apple);
    expect(apple.map((s) => s.label)).toEqual([
      'Next cell', 'Add row', 'Delete row', 'Add column', 'Delete column', 'Toggle header', 'Table toolbar',
    ]);
    // the entry point is Shift-F10 on Apple, never the inaccessible \
    expect(apple.find((s) => s.label === 'Table toolbar')?.keys).toEqual(['Shift', 'F10']);
    expect(apple.some((s) => s.keys.includes('\\' as never))).toBe(false);
    // the per-command letters/⌫ (all labelled keys, matched via keyCode fallback) stay put
    expect(apple.find((s) => s.label === 'Add row')?.keys).toEqual(['⌥', 'Shift', 'R']);
  });
});

describe('contextualShortcuts', () => {
  it('returns the table set when inTable is true', () => {
    expect(contextualShortcuts(true, OS.Other)).toEqual(tableShortcuts(OS.Other));
  });

  it('returns the default editor set when inTable is false', () => {
    expect(contextualShortcuts(false, OS.Other)).toEqual(editorShortcuts(OS.Other));
  });
});
