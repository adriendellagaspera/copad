import { describe, it, expect } from 'vitest';
import { parseOS, modKey, keyCap, OS } from './platform.js';

describe('parseOS', () => {
  it('parses Apple via userAgentData.platform (modern, preferred)', () => {
    expect(parseOS({ userAgentData: { platform: 'macOS' }, platform: '' })).toBe(OS.Apple);
  });

  it('parses Apple via navigator.platform ("MacIntel")', () => {
    expect(parseOS({ platform: 'MacIntel' })).toBe(OS.Apple);
  });

  it('parses iOS / iPadOS as Apple', () => {
    expect(parseOS({ platform: 'iPhone' })).toBe(OS.Apple);
    expect(parseOS({ platform: 'iPad' })).toBe(OS.Apple);
  });

  it('falls back to the UA string when platform is empty', () => {
    expect(parseOS({ platform: '', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })).toBe(OS.Apple);
  });

  it('parses Windows / Linux as Other', () => {
    expect(parseOS({ userAgentData: { platform: 'Windows' }, platform: 'Win32' })).toBe(OS.Other);
    expect(parseOS({ platform: 'Linux x86_64' })).toBe(OS.Other);
  });

  it('defaults to Other when navigator is unavailable (SSR)', () => {
    expect(parseOS(undefined)).toBe(OS.Other);
  });
});

describe('modKey', () => {
  it('resolves ⌘ on Apple and Ctrl elsewhere', () => {
    expect(modKey(OS.Apple)).toBe('⌘');
    expect(modKey(OS.Other)).toBe('Ctrl');
  });
});

describe('keyCap', () => {
  it('brands a literal cap unchanged', () => {
    expect(keyCap('B')).toBe('B');
  });
});
