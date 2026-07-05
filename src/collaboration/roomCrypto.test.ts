// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { keyFingerprint, deriveCacheKey, encryptUpdate, decryptUpdate } from './roomCrypto.js';
import type { RoomCredential } from './roomAccess.js';

const cred = (s: string) => s as RoomCredential;

describe('roomCrypto fingerprint', () => {
  it('is stable for the same credential and is a 64-char hex digest', async () => {
    const a = await keyFingerprint(cred('super-secret'));
    const b = await keyFingerprint(cred('super-secret'));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different credentials', async () => {
    expect(await keyFingerprint(cred('alpha'))).not.toBe(await keyFingerprint(cred('beta')));
  });

  it('is one-way — the digest is not the credential', async () => {
    expect(await keyFingerprint(cred('plain'))).not.toContain('plain');
  });
});

describe('roomCrypto AES-GCM cache encryption', () => {
  it('round-trips a Yjs-style update', async () => {
    const key = await deriveCacheKey(cred('room-key'));
    const data = new Uint8Array([0, 1, 2, 250, 251, 255]);
    const rec = await encryptUpdate(key, data);
    expect(await decryptUpdate(key, rec)).toEqual(data);
  });

  it('produces ciphertext that is not the plaintext', async () => {
    const key = await deriveCacheKey(cred('room-key'));
    const data = new Uint8Array([7, 7, 7, 7]);
    const rec = await encryptUpdate(key, data);
    expect(Array.from(new Uint8Array(rec.ct))).not.toEqual(Array.from(data));
  });

  it('returns null when decrypting with the wrong key (no throw)', async () => {
    const right = await deriveCacheKey(cred('right'));
    const wrong = await deriveCacheKey(cred('wrong'));
    const rec = await encryptUpdate(right, new Uint8Array([9, 8, 7]));
    expect(await decryptUpdate(wrong, rec)).toBeNull();
  });

  it('uses a fresh IV per encryption', async () => {
    const key = await deriveCacheKey(cred('room-key'));
    const r1 = await encryptUpdate(key, new Uint8Array([1]));
    const r2 = await encryptUpdate(key, new Uint8Array([1]));
    expect(Array.from(r1.iv)).not.toEqual(Array.from(r2.iv));
  });
});
