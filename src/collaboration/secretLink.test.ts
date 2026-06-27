import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RoomId } from './types.js';

const ROOM = 'r' as RoomId;

// Mock location.hash and history.replaceState before importing secretLink,
// since the module reads location.hash at call time.
let mockHash = '';
const replaceState = vi.fn();
vi.stubGlobal('location', { get hash() { return mockHash; } });
vi.stubGlobal('history', { replaceState });
vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-1234' });

beforeEach(() => {
  mockHash = '';
  replaceState.mockClear();
});

// Dynamic import so the stubs above are in place before the module initialises.
const { secretLink, rotateSecretKey } = await import('./secretLink.js');

describe('secretLink', () => {
  it('has mode secret-link', () => {
    expect(secretLink().mode).toBe('secret-link');
  });

  it('generates a key and writes it to the URL fragment when none exists', () => {
    const link = secretLink();
    expect(replaceState).toHaveBeenCalledOnce();
    const call = replaceState.mock.calls[0];
    expect(call[2]).toContain('k=test-uuid-1234');
    expect(link.credential(ROOM)).toBe('test-uuid-1234');
  });

  it('reuses the existing key from the URL fragment — no new key generated', () => {
    mockHash = '#k=existing-key-abc';
    const link = secretLink();
    expect(replaceState).not.toHaveBeenCalled();
    expect(link.credential(ROOM)).toBe('existing-key-abc');
  });

  it('credential returns the same value regardless of room', () => {
    mockHash = '#k=some-key';
    const link = secretLink();
    expect(link.credential(ROOM)).toBe(link.credential('other' as RoomId));
  });

  it('satisfies RoomCipher — password equals credential', () => {
    mockHash = '#k=cipher-key';
    const link = secretLink();
    expect(link.password(ROOM)).toBe(link.credential(ROOM));
  });

  it('preserves other fragment params when writing the key', () => {
    mockHash = '#foo=bar';
    secretLink();
    const written = replaceState.mock.calls[0][2] as string;
    expect(written).toContain('foo=bar');
    expect(written).toContain('k=test-uuid-1234');
  });
});

describe('rotateSecretKey', () => {
  it('writes a new key to the fragment and returns it', () => {
    const key = rotateSecretKey();
    expect(replaceState).toHaveBeenCalledOnce();
    expect(key).toBe('test-uuid-1234');
  });
});
