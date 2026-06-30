import { describe, it, expect } from 'vitest';
import { isMacPlatform, modKeyLabel } from './platform.js';

describe('isMacPlatform', () => {
  it('detects macOS via userAgentData.platform (modern, preferred)', () => {
    expect(isMacPlatform({ userAgentData: { platform: 'macOS' }, platform: '' })).toBe(true);
  });

  it('detects macOS via navigator.platform ("MacIntel")', () => {
    expect(isMacPlatform({ platform: 'MacIntel' })).toBe(true);
  });

  it('detects iOS/iPadOS', () => {
    expect(isMacPlatform({ platform: 'iPhone' })).toBe(true);
    expect(isMacPlatform({ platform: 'iPad' })).toBe(true);
  });

  it('falls back to the UA string when platform is empty', () => {
    expect(isMacPlatform({ platform: '', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })).toBe(true);
  });

  it('returns false for Windows / Linux', () => {
    expect(isMacPlatform({ userAgentData: { platform: 'Windows' }, platform: 'Win32' })).toBe(false);
    expect(isMacPlatform({ platform: 'Linux x86_64' })).toBe(false);
  });

  it('returns false when navigator is unavailable (SSR)', () => {
    expect(isMacPlatform(undefined)).toBe(false);
  });
});

describe('modKeyLabel', () => {
  it('is ⌘ on Apple platforms and Ctrl elsewhere', () => {
    expect(modKeyLabel(true)).toBe('⌘');
    expect(modKeyLabel(false)).toBe('Ctrl');
  });
});
