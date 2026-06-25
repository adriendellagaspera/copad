import type { Storage, CredentialField, SessionCredentials, DocContent, StorageAccess } from './types.js';

// S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, Backblaze B2…).
// Uses path-style addressing: {endpoint}/{bucket}/{key}.
// Requests are signed with AWS Signature V4 via Web Crypto — no SDK needed.
// The bucket must have CORS configured to allow requests from this origin.

const STORAGE_KEY = 'storage.s3';

// SHA-256 of an empty string — the hash used for GET request bodies.
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb924' +
                     '27ae41e4649b934ca495991b7852b855';

interface S3Conf {
  readonly endpoint: string;    // e.g. 'https://s3.eu-west-1.amazonaws.com'
  readonly bucket: string;
  readonly region: string;      // e.g. 'eu-west-1'; 'auto' for R2
  readonly key: string;         // object key, e.g. 'copad/document.yjs'
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

function conf(): S3Conf | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as S3Conf) : null;
  } catch {
    return null;
  }
}

// ── AWS Signature V4 ──────────────────────────────────────────────────────────

async function hexDigest(data: Uint8Array | ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data instanceof Uint8Array ? data.buffer as ArrayBuffer : data);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(key: ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
}

async function signingKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const kDate    = await hmac(enc.encode(`AWS4${secretAccessKey}`).buffer as ArrayBuffer, dateStamp);
  const kRegion  = await hmac(kDate, region);
  const kService = await hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}

interface SignedHeaders { readonly [name: string]: string }

async function signS3Request(
  method: 'GET' | 'PUT',
  url: URL,
  body: Uint8Array | null,
  c: S3Conf,
): Promise<SignedHeaders> {
  const now = new Date();
  const amzDate  = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);
  const bodyHash  = body ? await hexDigest(body) : EMPTY_SHA256;

  const headers: SignedHeaders = {
    host:                url.host,
    'x-amz-content-sha256': bodyHash,
    'x-amz-date':       amzDate,
  };

  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map(k => `${k}:${headers[k]}\n`).join('');
  const signedHeaderNames = sortedNames.join(';');

  const canonicalRequest = [
    method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaderNames,
    bodyHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${c.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await hexDigest(new TextEncoder().encode(canonicalRequest)),
  ].join('\n');

  const key = await signingKey(c.secretAccessKey, dateStamp, c.region);
  const sigBytes = await hmac(key, stringToSign);
  const signature = Array.from(new Uint8Array(sigBytes), b => b.toString(16).padStart(2, '0')).join('');

  return {
    ...headers,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${c.accessKeyId}/${credentialScope},` +
      ` SignedHeaders=${signedHeaderNames}, Signature=${signature}`,
  };
}

// ── Adapter ───────────────────────────────────────────────────────────────────

const credentialFields: CredentialField[] = [
  { name: 'endpoint',        label: 'Endpoint',          placeholder: 'https://s3.eu-west-1.amazonaws.com' },
  { name: 'bucket',          label: 'Bucket',            placeholder: 'my-bucket' },
  { name: 'region',          label: 'Region',            placeholder: 'eu-west-1 (or "auto" for R2)' },
  { name: 'key',             label: 'Object key',        placeholder: 'copad/document.yjs' },
  { name: 'accessKeyId',     label: 'Access key ID',     placeholder: 'AKI…' },
  { name: 'secretAccessKey', label: 'Secret access key', type: 'password', placeholder: '…' },
];

function objectUrl(c: S3Conf): URL {
  return new URL(`${c.endpoint.replace(/\/$/, '')}/${c.bucket}/${c.key}`);
}

export function s3Storage(): Storage {
  return {
    id: 's3',
    label: 'S3-compatible',
    blurb: 'Saves to an S3-compatible bucket (AWS, Cloudflare R2, MinIO…). Bucket must allow CORS.',
    credentialFields,

    isAuthenticated: () => !!conf(),

    contentFormat: 'binary',

    async connect(creds: SessionCredentials = {}) {
      const { endpoint = '', bucket = '', region = '', key = '', accessKeyId = '', secretAccessKey = '' } = creds;
      if (!endpoint.trim() || !bucket.trim() || !region.trim() || !key.trim() ||
          !accessKeyId.trim() || !secretAccessKey.trim()) {
        throw new Error('All S3 fields are required');
      }

      const c: S3Conf = {
        endpoint: endpoint.trim().replace(/\/$/, ''),
        bucket: bucket.trim(),
        region: region.trim(),
        key: key.trim().replace(/^\//, ''),
        accessKeyId: accessKeyId.trim(),
        secretAccessKey: secretAccessKey.trim(),
      };

      // Validate by issuing a HEAD on the bucket.
      const url = new URL(`${c.endpoint}/${c.bucket}`);
      const signed = await signS3Request('GET', url, null, c);
      const res = await fetch(url.toString(), { method: 'HEAD', headers: signed });
      if (res.status === 403) throw new Error('S3: access denied — check credentials and bucket policy');
      if (res.status === 404) throw new Error(`S3: bucket "${c.bucket}" not found`);
      if (!res.ok && res.status !== 405) throw new Error(`S3 connect failed: ${res.status}`);

      localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    },

    disconnect() {
      localStorage.removeItem(STORAGE_KEY);
    },

    async load(): Promise<DocContent | null> {
      const c = conf();
      if (!c) throw new Error('S3: not connected');

      const url = objectUrl(c);
      const signed = await signS3Request('GET', url, null, c);
      const res = await fetch(url.toString(), { headers: signed });

      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`S3 load failed: ${res.status}`);
      return { format: 'binary', bytes: new Uint8Array(await res.arrayBuffer()) };
    },

    async save(content: DocContent): Promise<void> {
      if (content.format !== 'binary') throw new Error('S3 storage expects binary content');
      const c = conf();
      if (!c) throw new Error('S3: not connected');

      const url = objectUrl(c);
      const signed = await signS3Request('PUT', url, content.bytes, c);
      const res = await fetch(url.toString(), {
        method: 'PUT',
        headers: { ...signed, 'Content-Type': 'application/octet-stream' },
        body: content.bytes as unknown as BodyInit,
      });

      if (!res.ok) throw new Error(`S3 save failed: ${res.status}`);
    },

    // S3 IAM/bucket-policy access is enforced server-side at the credential level.
    // If the token can PUT, the user effectively has write access.
    access(): Promise<StorageAccess> {
      return Promise.resolve('write');
    },
  };
}
