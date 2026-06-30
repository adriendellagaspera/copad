import { describe, it, expect } from 'vitest';
import { editorShortcuts } from './shortcuts.js';
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
      'Link',
      'Commands',
      'Undo',
    ]);
  });

  it('uses no modifier for the slash command', () => {
    const commands = editorShortcuts(OS.Apple).find((s) => s.label === 'Commands');
    expect(commands?.keys).toEqual(['/']);
  });
});
