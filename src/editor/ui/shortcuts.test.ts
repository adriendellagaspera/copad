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

  it('omits the Alt-Shift-\\ Toolbar hint on Apple (the \\ key is inaccessible there)', () => {
    const labels = editorShortcuts(OS.Apple).map((s) => s.label);
    expect(labels).not.toContain('Toolbar');
    // and no shortcut on Apple should advertise the backslash cap
    expect(editorShortcuts(OS.Apple).some((s) => s.keys.includes('\\' as never))).toBe(false);
    // but it's still shown elsewhere
    expect(editorShortcuts(OS.Other).map((s) => s.label)).toContain('Toolbar');
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

  it('omits the Table toolbar entry-point hint on Apple, keeps the per-command shortcuts', () => {
    const labels = tableShortcuts(OS.Apple).map((s) => s.label);
    expect(labels).not.toContain('Table toolbar');
    // the letter-key table commands (whose keys ARE on a Mac keyboard) stay
    expect(labels).toEqual(['Next cell', 'Add row', 'Delete row', 'Add column', 'Delete column', 'Toggle header']);
    expect(tableShortcuts(OS.Apple).some((s) => s.keys.includes('\\' as never))).toBe(false);
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
