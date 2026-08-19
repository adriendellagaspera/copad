// The single module that reaches for crypto.subtle.

import type { RoomCredential } from './roomAccess.js';

export type KeyFingerprint = string & { readonly _brand: 'KeyFingerprint' };

export interface EncryptedRecord {
  readonly iv: Uint8Array;
  readonly ct: ArrayBuffer;
}

// Domain-separation labels: fingerprint and AES key derive from distinct inputs despite sharing the same secret.
// Versioned to tell a future scheme change apart from old material.
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

export async function keyFingerprint(cred: RoomCredential): Promise<KeyFingerprint> {
  const data = new TextEncoder().encode(FINGERPRINT_LABEL + cred);
  const digest = await subtle().digest('SHA-256', data);
  return toHex(digest) as KeyFingerprint;
}

// Static salt: credential is usually high-entropy (a secret-link UUID); PBKDF2 is belt-and-braces for weak passwords.
// Non-extractable — can only encrypt/decrypt, never be read back.
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

// lib.dom types Uint8Array over ArrayBufferLike; WebCrypto's stricter signature rejects it, so cast to BufferSource.
export async function encryptUpdate(key: CryptoKey, data: Uint8Array): Promise<EncryptedRecord> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, data as BufferSource);
  return { iv, ct };
}

// Returns null rather than throwing on any failure, so one bad record can't abort restoring the rest of the cache.
export async function decryptUpdate(key: CryptoKey, rec: EncryptedRecord): Promise<Uint8Array | null> {
  try {
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: rec.iv as BufferSource }, key, rec.ct);
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}
