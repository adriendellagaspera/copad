import * as pcloudSdk from "pcloud-sdk-js";
import type { StorageAdapter } from "./types";
import { netFetch } from "./net";

const CLIENT_ID = import.meta.env.VITE_PCLOUD_CLIENT_ID;
const REDIRECT_URI =
  import.meta.env.VITE_REDIRECT_URI || `${location.origin}/redirect.html`;
const FILE_NAME = import.meta.env.VITE_PCLOUD_FILE_NAME || "collab-doc.ydoc";
const FOLDER_ID = import.meta.env.VITE_PCLOUD_FOLDER_ID || "0";
const KEY = "storage.pcloud";

type Session = { token: string; host: string };

export class PCloudAdapter implements StorageAdapter {
  readonly id = "pcloud";
  readonly label = "pCloud";

  private session(): Session | null {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  }

  isAuthenticated(): boolean {
    return !!this.session();
  }

  connect(): Promise<void> {
    if (!CLIENT_ID) {
      return Promise.reject(new Error("VITE_PCLOUD_CLIENT_ID is not set"));
    }
    return new Promise((resolve, reject) => {
      try {
        pcloudSdk.oauth.initOauthToken({
          client_id: CLIENT_ID,
          redirect_uri: REDIRECT_URI,
          response_type: "token",
          // Called with (access_token, locationid) at runtime; locationid 2 == EU.
          receiveToken: (token: string, locationid?: number) => {
            const host =
              (locationid ?? 1) === 2
                ? "https://eapi.pcloud.com"
                : "https://api.pcloud.com";
            localStorage.setItem(KEY, JSON.stringify({ token, host }));
            resolve();
          },
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  disconnect(): void {
    localStorage.removeItem(KEY);
  }

  async save(bytes: Uint8Array): Promise<void> {
    const s = this.session();
    if (!s) throw new Error("pCloud: not connected");

    const form = new FormData();
    form.append("file", new Blob([bytes as BlobPart]), FILE_NAME);

    const url =
      `${s.host}/uploadfile?access_token=${encodeURIComponent(s.token)}` +
      `&folderid=${encodeURIComponent(FOLDER_ID)}` +
      `&filename=${encodeURIComponent(FILE_NAME)}&nopartial=1`;

    const res = await fetch(url, { method: "POST", body: form });
    const json = await res.json();
    if (json.result !== 0) {
      throw new Error(`pCloud uploadfile (${json.result}): ${json.error}`);
    }
  }

  async load(): Promise<Uint8Array | null> {
    const s = this.session();
    if (!s) throw new Error("pCloud: not connected");

    try {
      const link =
        `${s.host}/getfilelink?access_token=${encodeURIComponent(s.token)}` +
        `&path=/${encodeURIComponent(FILE_NAME)}&forcedownload=1`;
      const res = await fetch(link);
      const json = await res.json();

      if (json.result === 2009) return null; // file not found (normal first run)
      if (json.result !== 0) {
        console.warn(`pCloud getfilelink (${json.result}): ${json.error}`);
        return null;
      }

      // The content host may block CORS — route through the proxy if configured.
      const bin = await netFetch(`https://${json.hosts[0]}${json.path}`);
      return new Uint8Array(await bin.arrayBuffer());
    } catch (err) {
      console.warn("pCloud load failed (starting with empty doc):", err);
      return null;
    }
  }
}
