// Cryptographic material derived from a room's key (its `RoomCredential`).
//
// Two independent things are derived here, both from the same secret:
//  - a *fingerprint* (a one-way SHA-256 digest) used only to recognise a key —
//    "is this the key the room was encrypted with?" — without ever storing the
//    key itself. Persisted in the encrypted-room registry (`roomLock.ts`).
//  - an *AES-GCM key* (via PBKDF2) used to encrypt the local IndexedDB cache at
//    rest (`encryptedCache.ts`), so a cached doc is unreadable without the key.
//
// This is the single module that reaches for `crypto.subtle`. Everything is
// async because WebCrypto is; callers await.

import type { RoomCredential } from './roomAccess.js';

/** A one-way digest of a `RoomCredential` — enough to recognise the key, never
 *  enough to recover it. Stored per room so we can tell "correct key", "wrong
 *  key", and "no key" apart. Branded so a raw hash string can't stand in. */
export type KeyFingerprint = string & { readonly _brand: 'KeyFingerprint' };

/** One AES-GCM encrypted blob: the random IV and the ciphertext. Both survive a
 *  structured-clone into IndexedDB, so a record is stored verbatim. */
export interface EncryptedRecord {
  readonly iv: Uint8Array;
  readonly ct: ArrayBuffer;
}

// Domain-separation labels so the fingerprint and the AES key derive from
// distinct inputs even though they share the same secret. Versioned so a future
// scheme change can be told apart from old material.
const FINGERPRINT_LABEL = 'copad-room-fingerprint-v1|';
const PBKDF2_SALT = new TextEncoder().encode('copad-room-cache-v1');
const PBKDF2_ITERATIONS = 100_000;
const IV_BYTES = 12; // AES-GCM standard nonce length

const subtle = (): SubtleCrypto => globalThis.crypto.subtle;

function toHex(buf: ArrayBuffer): string {
  let out = '';
  for (const b of new Uint8Array(buf)) out += b.toString(16).padStart(2, '0');
  return out;
}

/**
 * A stable one-way digest of a room credential. Used to recognise a key across
 * reloads (registry) and to detect a wrong key, without persisting the secret.
 * The single cast site for {@link KeyFingerprint}.
 */
export async function keyFingerprint(cred: RoomCredential): Promise<KeyFingerprint> {
  const data = new TextEncoder().encode(FINGERPRINT_LABEL + cred);
  const digest = await subtle().digest('SHA-256', data);
  return toHex(digest) as KeyFingerprint;
}

/**
 * Derive an AES-GCM key from a room credential (PBKDF2/SHA-256, fixed salt).
 * The salt is static because the credential is usually high-entropy already (a
 * secret-link UUID); PBKDF2 is the belt-and-braces for weaker room passwords.
 * Non-extractable — it can only be used to encrypt/decrypt, never read back.
 */
export async function deriveCacheKey(cred: RoomCredential): Promise<CryptoKey> {
  const material = await subtle().importKey(
    'raw',
    new TextEncoder().encode(cred),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: PBKDF2_SALT, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt one plaintext blob (a Yjs update) with a fresh random IV.
 *  Args are cast to BufferSource at this WebCrypto boundary — the lib types the
 *  generic Uint8Array over ArrayBufferLike, which WebCrypto's stricter signature
 *  doesn't accept, but the runtime handles it. */
export async function encryptUpdate(key: CryptoKey, data: Uint8Array): Promise<EncryptedRecord> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, data as BufferSource);
  return { iv, ct };
}

/**
 * Decrypt one record. Returns `null` on any failure (wrong key, corrupt bytes)
 * rather than throwing, so one bad record can't abort restoring the rest of the
 * cache — the caller simply skips it.
 */
export async function decryptUpdate(key: CryptoKey, rec: EncryptedRecord): Promise<Uint8Array | null> {
  try {
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: rec.iv as BufferSource }, key, rec.ct);
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}
