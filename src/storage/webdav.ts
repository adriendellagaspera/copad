import type { CredentialField, StorageAdapter } from "./types";
import { hasProxy, netFetch } from "./net";

// WebDAV covers Nextcloud, ownCloud and any generic WebDAV endpoint. Most servers
// do NOT send CORS headers, so this adapter typically needs VITE_PROXY_URL set.
const DEFAULT_URL = import.meta.env.VITE_WEBDAV_URL || "";
const FILE_NAME = import.meta.env.VITE_WEBDAV_FILE_NAME || "collab-doc.ydoc";
const KEY = "storage.webdav";

type Conf = { baseUrl: string; auth: string };

export class WebDavAdapter implements StorageAdapter {
  readonly id = "webdav";
  readonly label = "WebDAV / Nextcloud";
  readonly credentialFields: CredentialField[] = [
    {
      name: "baseUrl",
      label: "WebDAV folder URL",
      placeholder:
        DEFAULT_URL || "https://cloud.example.com/remote.php/dav/files/USER/Collab",
    },
    { name: "username", label: "Username" },
    { name: "password", label: "App password", type: "password" },
  ];

  private conf(): Conf | null {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Conf) : null;
  }

  isAuthenticated(): boolean {
    return !!this.conf();
  }

  async connect(creds?: Record<string, string>): Promise<void> {
    const baseUrl = (creds?.baseUrl || DEFAULT_URL).replace(/\/$/, "");
    const username = creds?.username ?? "";
    const password = creds?.password ?? "";
    if (!baseUrl || !username) {
      throw new Error("WebDAV: URL and username are required");
    }
    if (!hasProxy && new URL(baseUrl).origin !== location.origin) {
      console.warn(
        "WebDAV without VITE_PROXY_URL: the server must allow CORS, otherwise requests will be blocked.",
      );
    }

    const auth = "Basic " + btoa(`${username}:${password}`);
    // Validate credentials with a cheap request before storing them.
    const res = await netFetch(`${baseUrl}/`, {
      method: "HEAD",
      headers: { Authorization: auth },
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("WebDAV: invalid credentials");
    }
    localStorage.setItem(KEY, JSON.stringify({ baseUrl, auth }));
  }

  disconnect(): void {
    localStorage.removeItem(KEY);
  }

  private file(): { url: string; auth: string } {
    const c = this.conf();
    if (!c) throw new Error("WebDAV: not connected");
    return { url: `${c.baseUrl}/${encodeURIComponent(FILE_NAME)}`, auth: c.auth };
  }

  async save(bytes: Uint8Array): Promise<void> {
    const { url, auth } = this.file();
    const res = await netFetch(url, {
      method: "PUT",
      headers: { Authorization: auth, "Content-Type": "application/octet-stream" },
      body: new Blob([bytes as BlobPart]),
    });
    // 200 OK (overwrite), 201 Created, 204 No Content are all success.
    if (!res.ok && ![201, 204].includes(res.status)) {
      throw new Error(`WebDAV PUT (${res.status})`);
    }
  }

  async load(): Promise<Uint8Array | null> {
    try {
      const { url, auth } = this.file();
      const res = await netFetch(url, { headers: { Authorization: auth } });
      if (res.status === 404) return null; // not created yet
      if (!res.ok) {
        console.warn(`WebDAV GET (${res.status})`);
        return null;
      }
      return new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      console.warn("WebDAV load failed (starting with empty doc):", err);
      return null;
    }
  }
}
