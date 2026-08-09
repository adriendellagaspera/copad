import type { Storage, CredentialField, LoginOptions, DocContent, Filename } from './types.js';
import { DocFormat, InputType, LoginKind, StorageAccess } from './types.js';
import type { StorageAuth } from './auth.js';
import { filenameStore } from './filename.js';
import {
  type S3Conf,
  parseS3Conf,
  parseS3Endpoint,
  parseS3Bucket,
  parseS3Region,
  parseS3KeyPrefix,
  parseS3AccessKeyId,
  parseS3SecretAccessKey,
} from './parse.js';
import { localStore } from '../persistence/local.js';
import type { RoomId } from '../collaboration/types.js';
import { landed, writeFailure, classifyHttpStatus, WriteFailureKind, type WriteReceipt } from './writeOutcome.js';
import { STORAGE_ID, DEFAULT_FILENAME, S3_PREFIX, S3_KEY } from './constants.js';

// S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, Backblaze B2…).
// Path-style addressing: {endpoint}/{bucket}/{key}. Requests are signed with AWS
// Signature V4 via Web Crypto — no SDK. The bucket must allow CORS from this origin;
// the request is signed directly (host is part of the signature), so no proxy.

// ── Branded types ─────────────────────────────────────────────────────────────

/** An S3-compatible endpoint URL (e.g. `https://s3.eu-west-1.amazonaws.com`). */
export type S3Endpoint = string & { readonly _brand: 'S3Endpoint' };

/** A bucket name. */
export type S3Bucket = string & { readonly _brand: 'S3Bucket' };

/** An AWS region (or `auto` for R2). */
export type S3Region = string & { readonly _brand: 'S3Region' };

/** An object-key prefix (folder) within the bucket. */
export type S3KeyPrefix = string & { readonly _brand: 'S3KeyPrefix' };

/** An access key ID credential. */
export type S3AccessKeyId = string & { readonly _brand: 'S3AccessKeyId' };

/** A secret access key credential. */
export type S3SecretAccessKey = string & { readonly _brand: 'S3SecretAccessKey' };

/** SHA-256 of an empty body — the payload hash for GET requests. */
const EMPTY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const confStore = localStore<S3Conf | null>(
  S3_KEY,
  parseS3Conf,
  (c) => (c ? JSON.stringify(c) : null),
);

const credentialFields: CredentialField[] = [
  {
    name: 'endpoint',
    label: 'Endpoint',
    placeholder: 'https://s3.eu-west-1.amazonaws.com',
    help: 'The service root, without the bucket name — requests are path-style (endpoint/bucket/key), ' +
      'and the bucket must allow CORS from this origin.',
  },
  {
    name: 'bucket',
    label: 'Bucket',
    placeholder: 'my-bucket',
    help: 'The bucket name only, not a URL — it\'s appended to the endpoint to build each request.',
  },
  {
    name: 'region',
    label: 'Region',
    placeholder: 'eu-west-1 (or "auto" for R2)',
    help: 'Must match the bucket\'s actual region — it\'s signed into every request, so a wrong value fails auth, not just routing.',
  },
  {
    name: 'prefix',
    label: 'Key prefix',
    placeholder: S3_PREFIX,
    help: `Folder-like prefix objects are stored under. Optional — defaults to "${S3_PREFIX}" if left blank.`,
  },
  {
    name: 'accessKeyId',
    label: 'Access key ID',
    placeholder: 'AKI…',
    help: 'Paired with the secret key below to sign requests (AWS Signature V4) — needs at least PutObject/GetObject on this bucket.',
  },
  {
    name: 'secretAccessKey',
    label: 'Secret access key',
    type: InputType.Password,
    placeholder: '…',
    help: 'Never sent as-is — used locally to derive the SigV4 signature for each request.',
  },
];

// ── AWS Signature V4 ──────────────────────────────────────────────────────────

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  // Pass the view directly (WebCrypto honours byteOffset/byteLength, so a subarray
  // hashes correctly); cast only to satisfy the ArrayBuffer/SharedArrayBuffer lib type.
  return toHex(await crypto.subtle.digest('SHA-256', data as unknown as BufferSource));
}

async function hmac(key: ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
}

async function signingKey(secret: S3SecretAccessKey, dateStamp: string, region: S3Region): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const kDate = await hmac(enc.encode(`AWS4${secret}`).buffer as ArrayBuffer, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}

/**
 * Sign a request, returning the headers to send (host, x-amz-*, Authorization).
 *
 * `host` is included in the canonical request (SigV4 requires it) even though a
 * browser won't let a script actually set the `Host` header — `fetch` silently
 * drops it and sends its own, derived from `url`. That's harmless here: the
 * value we sign is `url.host`, which is exactly the `Host` the browser will
 * send for that same URL, so the signature still matches what the server sees
 * on the wire.
 */
async function signRequest(
  method: 'GET' | 'PUT' | 'HEAD',
  url: URL,
  body: Uint8Array | null,
  c: S3Conf,
): Promise<Record<string, string>> {
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);
  const bodyHash = body ? await sha256Hex(body) : EMPTY_SHA256;

  const baseHeaders: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': bodyHash,
    'x-amz-date': amzDate,
  };

  const names = Object.keys(baseHeaders).sort();
  const canonicalHeaders = names.map((k) => `${k}:${baseHeaders[k]}\n`).join('');
  const signedHeaders = names.join(';');

  const canonicalRequest = [
    method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join('\n');

  const scope = `${dateStamp}/${c.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256Hex(new TextEncoder().encode(canonicalRequest)),
  ].join('\n');

  const signature = toHex(await hmac(await signingKey(c.secretAccessKey, dateStamp, c.region), stringToSign));

  return {
    ...baseHeaders,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${c.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Object key for the current room: `<prefix>/<filename>` (prefix optional). */
function objectKey(c: S3Conf, filename: Filename): string {
  const prefix = c.prefix.replace(/^\/+|\/+$/g, '');
  return [prefix, filename].filter(Boolean).join('/');
}

function objectUrl(c: S3Conf, filename: Filename): URL {
  return new URL(`${c.endpoint}/${c.bucket}/${objectKey(c, filename)}`);
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function s3Storage(room: RoomId): { auth: StorageAuth; storage: Storage } {
  const fileName = filenameStore(STORAGE_ID.s3, room);
  const conf = (): S3Conf | null => confStore.read();

  const auth: StorageAuth = {
    isAuthenticated: () => !!conf(),

    async login(opts?: LoginOptions) {
      const creds = opts?.kind === LoginKind.Credentials ? opts.credentials : {};
      const { endpoint = '', bucket = '', region = '', prefix = '', accessKeyId = '', secretAccessKey = '' } = creds;

      const endpointParsed = parseS3Endpoint(endpoint.trim().replace(/\/$/, ''));
      const bucketParsed = parseS3Bucket(bucket);
      const regionParsed = parseS3Region(region);
      const accessKeyIdParsed = parseS3AccessKeyId(accessKeyId);
      const secretAccessKeyParsed = parseS3SecretAccessKey(secretAccessKey);
      if (!endpointParsed || !bucketParsed || !regionParsed || !accessKeyIdParsed || !secretAccessKeyParsed) {
        throw new Error('Endpoint, bucket, region, and credentials are required');
      }

      const c: S3Conf = {
        endpoint: endpointParsed,
        bucket: bucketParsed,
        region: regionParsed,
        prefix: parseS3KeyPrefix(prefix),
        accessKeyId: accessKeyIdParsed,
        secretAccessKey: secretAccessKeyParsed,
      };

      // Validate credentials with a signed HEAD on the target object. This checks
      // object-level access (a write-only key may lack bucket-level ListBucket):
      //   403 → bad credentials / denied, 404 → good creds + object not yet there.
      const url = objectUrl(c, fileName.get());
      const res = await fetch(url.toString(), {
        method: 'HEAD',
        headers: await signRequest('HEAD', url, null, c),
      });
      if (res.status === 403) throw new Error('S3: access denied — check credentials and bucket policy');
      if (!res.ok && res.status !== 404 && res.status !== 405) {
        throw new Error(`S3 connect failed: ${res.status}`);
      }

      confStore.write(c);
    },

    logout() {
      confStore.clear();
    },

    credentialFields,
  };

  const storage: Storage = {
    id: STORAGE_ID.s3,
    label: 'S3-compatible',
    blurb: 'Saves to an S3-compatible bucket (AWS, Cloudflare R2, MinIO…). The bucket must allow CORS.',
    availability: { ok: true },

    filename: () => fileName.get(),
    setFilename: fileName.set,
    defaultFilename: () => DEFAULT_FILENAME,

    contentFormat: DocFormat.Binary,

    async load(): Promise<DocContent | null> {
      const c = conf();
      if (!c) throw new Error('S3: not connected');

      const url = objectUrl(c, fileName.get());
      const res = await fetch(url.toString(), { headers: await signRequest('GET', url, null, c) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`S3 load failed: ${res.status}`);
      return { format: DocFormat.Binary, bytes: new Uint8Array(await res.arrayBuffer()) };
    },

    async save(content: DocContent): Promise<WriteReceipt> {
      if (content.format !== DocFormat.Binary) throw writeFailure(WriteFailureKind.Rejected, 'S3 storage expects binary content');
      const c = conf();
      if (!c) throw writeFailure(WriteFailureKind.Denied, 'S3: not connected');

      const url = objectUrl(c, fileName.get());
      const res = await fetch(url.toString(), {
        method: 'PUT',
        headers: { ...await signRequest('PUT', url, content.bytes, c), 'Content-Type': 'application/octet-stream' },
        body: content.bytes as unknown as BodyInit,
      });
      if (!res.ok) throw writeFailure(classifyHttpStatus(res.status), `S3 save failed: ${res.status}`);
      return landed();
    },

    // S3 access is enforced server-side by IAM / bucket policy on the credential;
    // if the key can PUT, the user effectively has write access.
    access(): Promise<StorageAccess> {
      return Promise.resolve(StorageAccess.Write);
    },
  };

  return { auth, storage };
}
