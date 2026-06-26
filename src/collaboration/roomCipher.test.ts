import { describe, it, expect } from 'vitest';
import { plaintext } from './roomCipher.js';
import type { RoomId } from './types.js';

const ROOM = 'r' as RoomId;

describe('plaintext', () => {
  it('password is always null regardless of room', () => {
    expect(plaintext().password(ROOM)).toBeNull();
    expect(plaintext().password('other' as RoomId)).toBeNull();
  });
});
