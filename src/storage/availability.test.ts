import { describe, it, expect } from 'vitest';
import type { StorageAvailability } from './types.js';

function describeAvailability(a: StorageAvailability): string {
  if (a.ok) return 'available';
  return `unavailable: ${a.reason}`;
}

describe('StorageAvailability discriminated union', () => {
  it('available case', () => {
    expect(describeAvailability({ ok: true })).toBe('available');
  });

  it('unavailable case', () => {
    expect(
      describeAvailability({ ok: false, reason: 'File System Access API not supported' }),
    ).toBe('unavailable: File System Access API not supported');
  });

  it('unavailable with an arbitrary reason string', () => {
    expect(
      describeAvailability({ ok: false, reason: 'not supported in this browser' }),
    ).toBe('unavailable: not supported in this browser');
  });
});
