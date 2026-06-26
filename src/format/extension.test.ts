import { describe, it, expect } from 'vitest';
import { extensionOf } from './types.js';
import type { FileExtension } from './types.js';

describe('extensionOf', () => {
  it('returns the extension for a markdown file', () => {
    expect(extensionOf('notes.md')).toBe('.md');
  });

  it('lowercases the extension', () => {
    expect(extensionOf('notes.MD')).toBe('.md');
  });

  it('returns the extension for a .yjs file', () => {
    expect(extensionOf('document.yjs')).toBe('.yjs');
  });

  it('returns an empty string when there is no extension', () => {
    expect(extensionOf('noextension')).toBe('');
  });

  it('returns only the last extension for compound extensions', () => {
    expect(extensionOf('archive.tar.gz')).toBe('.gz');
  });

  it('lowercases a .txt extension', () => {
    expect(extensionOf('NOTES.TXT')).toBe('.txt');
  });

  it('return value is assignable to FileExtension', () => {
    const ext: FileExtension = extensionOf('test.json');
    expect(ext).toBe('.json');
  });

  it('returns empty string for a dotfile with no extension', () => {
    expect(extensionOf('.gitignore')).toBe('.gitignore');
  });

  it('handles a file ending with a dot', () => {
    expect(extensionOf('file.')).toBe('.');
  });
});
