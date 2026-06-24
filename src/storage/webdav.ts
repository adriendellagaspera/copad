import type { StorageAdapter, CredentialField } from './types.js';
import { netFetch, hasProxy } from './net.js';

const FILE_NAME = 'document.yjs';
const STORAGE_KEY = 'storage.webdav';

interface WebDavConf {
  baseUrl: string;
  auth: string;
}

export class WebDavAdapter implements StorageAdapter {
  readonly id = 'webdav';
  readonly label = 'WebDAV / Nextcloud';

  readonly credentialFields: CredentialField[] = [
    {
      name: 'baseUrl',
      label: 'WebDAV folder URL',
      placeholder:
        import.meta.env.VITE_WEBDAV_URL ||
        'https://cloud.example.com/remote.php/dav/files/USER/Collab',
    },
    { name: 'username', label: 'Username' },
    { name: 'password', label: 'App password', type: 'password' },
  ];

  private conf(): WebDavConf | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as WebDavConf) : null;
    } catch {
      return null;
    }
  }

  isAuthenticated(): boolean {
    return !!this.conf();
  }

  async connect(creds: Record<string, string> = {}): Promise<void> {
    const { baseUrl = '', username = '', password = '' } = creds;
    if (!baseUrl.trim() || !username.trim())
      throw new Error('URL and username are required');

    const auth = btoa(`${username}:${password}`);

    if (!hasProxy) {
      console.warn(
        'WebDAV connect: no VITE_PROXY_URL set — cross-origin requests will likely fail'
      );
    }

    const res = await netFetch(baseUrl.replace(/\/$/, ''), {
      method: 'HEAD',
      headers: { Authorization: `Basic ${auth}` },
    });

    if (res.status === 401) throw new Error('WebDAV: invalid credentials');
    if (!res.ok && res.status !== 404)
      throw new Error(`WebDAV connect failed: ${res.status}`);

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ baseUrl: baseUrl.replace(/\/$/, ''), auth }));
  }

  disconnect(): void {
    localStorage.removeItem(STORAGE_KEY);
  }

  async load(): Promise<Uint8Array | null> {
    const c = this.conf();
    if (!c) throw new Error('WebDAV: not connected');

    const res = await netFetch(`${c.baseUrl}/${FILE_NAME}`, {
      headers: { Authorization: `Basic ${c.auth}` },
    });

    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`WebDAV load failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async save(bytes: Uint8Array): Promise<void> {
    const c = this.conf();
    if (!c) throw new Error('WebDAV: not connected');

    const res = await netFetch(`${c.baseUrl}/${FILE_NAME}`, {
      method: 'PUT',
      headers: {
        Authorization: `Basic ${c.auth}`,
        'Content-Type': 'application/octet-stream',
      },
      body: bytes as unknown as BodyInit,
    });

    if (![200, 201, 204].includes(res.status))
      throw new Error(`WebDAV save failed: ${res.status}`);
  }
}
