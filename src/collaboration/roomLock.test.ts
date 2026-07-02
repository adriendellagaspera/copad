// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  rememberRoomEncryption,
  forgetRoomEncryption,
  roomEncryptionFingerprint,
  roomLockState,
} from './roomLock.js';
import type { RoomId } from './types.js';
import type { RoomCredential } from './roomAccess.js';

const room = (s: string) => s as RoomId;
const cred = (s: string) => s as RoomCredential;

beforeEach(() => localStorage.clear());

describe('encrypted-room registry', () => {
  it('remembers a room encryption fingerprint and can forget it', async () => {
    await rememberRoomEncryption(room('r'), cred('k'));
    expect(roomEncryptionFingerprint(room('r'))).toMatch(/^[0-9a-f]{64}$/);
    forgetRoomEncryption(room('r'));
    expect(roomEncryptionFingerprint(room('r'))).toBeNull();
  });

  it('scopes fingerprints per room', async () => {
    await rememberRoomEncryption(room('a'), cred('ka'));
    expect(roomEncryptionFingerprint(room('a'))).not.toBeNull();
    expect(roomEncryptionFingerprint(room('b'))).toBeNull();
  });
});

describe('roomLockState', () => {
  it('never locks a room that is not known to be encrypted', async () => {
    expect(await roomLockState(room('r'), null)).toEqual({ locked: false });
    expect(await roomLockState(room('r'), cred('anything'))).toEqual({ locked: false });
  });

  it('locks a known-encrypted room when no key is supplied', async () => {
    await rememberRoomEncryption(room('r'), cred('k'));
    expect(await roomLockState(room('r'), null)).toEqual({ locked: true, reason: 'missing' });
  });

  it('locks a known-encrypted room when the wrong key is supplied', async () => {
    await rememberRoomEncryption(room('r'), cred('k'));
    expect(await roomLockState(room('r'), cred('not-it'))).toEqual({ locked: true, reason: 'wrong' });
  });

  it('unlocks when the correct key is supplied', async () => {
    await rememberRoomEncryption(room('r'), cred('k'));
    expect(await roomLockState(room('r'), cred('k'))).toEqual({ locked: false });
  });
});
