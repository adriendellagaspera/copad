import type { Storage, CredentialField, LoginOptions, DocContent } from './types.js';
import { DocFormat, InputType, LoginKind, StorageAccess } from './types.js';
import type { StorageAuth } from './auth.js';
import { filenameStore } from './filename.js';
import { type S3Conf, parseS3Conf } from './parse.js';
import { localStore } from '../persistence/local.js';
import { STORAGE_ID, DEFAULT_FILENAME, S3_PREFIX, S3_KEY } from './constants.js';

// S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, Backblaze B2…).
// Path-style addressing: {endpoint}/{bucket}/{key}. Requests are signed with AWS
// Signature V4 via Web Crypto — no SDK. The bucket must allow CORS from this origin;
// the request is signed directly (host is part of the signature), so no proxy.

/** SHA-256 of an empty body — the payload hash for GET requests. */
const EMPTY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const fileName = filenameStore(STORAGE_ID.s3);
const confStore = localStore<S3Conf | null>(
  S3_KEY,
  parseS3Conf,
  (c) => (c ? JSON.stringify(c) : null),
);

const credentialFields: CredentialField[] = [
  { name: 'endpoint', label: 'Endpoint', placeholder: 'https://s3.eu-west-1.amazonaws.com' },
  { name: 'bucket', label: 'Bucket', placeholder: 'my-bucket' },
  { name: 'region', label: 'Region', placeholder: 'eu-west-1 (or "auto" for R2)' },
  { name: 'prefix', label: 'Key prefix', placeholder: S3_PREFIX },
  { name: 'accessKeyId', label: 'Access key ID', placeholder: 'AKI…' },
  { name: 'secretAccessKey', label: 'Secret access key', type: InputType.Password, placeholder: '…' },
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

async function signingKey(secret: string, dateStamp: string, region: string): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const kDate = await hmac(enc.encode(`AWS4${secret}`).buffer as ArrayBuffer, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}

/** Sign a request, returning the headers to send (host, x-amz-*, Authorization). */
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
function objectKey(c: S3Conf): string {
  const prefix = c.prefix.replace(/^\/+|\/+$/g, '');
  return [prefix, fileName.get()].filter(Boolean).join('/');
}

function objectUrl(c: S3Conf): URL {
  return new URL(`${c.endpoint}/${c.bucket}/${objectKey(c)}`);
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function s3Storage(): { auth: StorageAuth; storage: Storage } {
  const conf = (): S3Conf | null => confStore.read();

  const auth: StorageAuth = {
    isAuthenticated: () => !!conf(),

    async login(opts?: LoginOptions) {
      const creds = opts?.kind === LoginKind.Credentials ? opts.credentials : {};
      const { endpoint = '', bucket = '', region = '', prefix = '', accessKeyId = '', secretAccessKey = '' } = creds;
      if (!endpoint.trim() || !bucket.trim() || !region.trim() || !accessKeyId.trim() || !secretAccessKey.trim()) {
        throw new Error('Endpoint, bucket, region, and credentials are required');
      }

      const c: S3Conf = {
        endpoint: endpoint.trim().replace(/\/$/, ''),
        bucket: bucket.trim(),
        region: region.trim(),
        prefix: prefix.trim() || S3_PREFIX,
        accessKeyId: accessKeyId.trim(),
        secretAccessKey: secretAccessKey.trim(),
      };

      // Validate credentials with a signed HEAD on the target object. This checks
      // object-level access (a write-only key may lack bucket-level ListBucket):
      //   403 → bad credentials / denied, 404 → good creds + object not yet there.
      const url = objectUrl(c);
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

      const url = objectUrl(c);
      const res = await fetch(url.toString(), { headers: await signRequest('GET', url, null, c) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`S3 load failed: ${res.status}`);
      return { format: DocFormat.Binary, bytes: new Uint8Array(await res.arrayBuffer()) };
    },

    async save(content: DocContent): Promise<void> {
      if (content.format !== DocFormat.Binary) throw new Error('S3 storage expects binary content');
      const c = conf();
      if (!c) throw new Error('S3: not connected');

      const url = objectUrl(c);
      const res = await fetch(url.toString(), {
        method: 'PUT',
        headers: { ...await signRequest('PUT', url, content.bytes, c), 'Content-Type': 'application/octet-stream' },
        body: content.bytes as unknown as BodyInit,
      });
      if (!res.ok) throw new Error(`S3 save failed: ${res.status}`);
    },

    // S3 access is enforced server-side by IAM / bucket policy on the credential;
    // if the key can PUT, the user effectively has write access.
    access(): Promise<StorageAccess> {
      return Promise.resolve(StorageAccess.Write);
    },
  };

  return { auth, storage };
}
