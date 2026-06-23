/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Shared
  readonly VITE_STORAGE_BACKEND?: string; // default backend id: pcloud | dropbox | webdav
  readonly VITE_REDIRECT_URI?: string; // OAuth popup landing (default: <origin>/redirect.html)
  readonly VITE_PROXY_URL?: string; // optional shared CORS proxy (Cloudflare Worker)

  // pCloud
  readonly VITE_PCLOUD_CLIENT_ID?: string;
  readonly VITE_PCLOUD_FILE_NAME?: string;
  readonly VITE_PCLOUD_FOLDER_ID?: string;

  // Dropbox
  readonly VITE_DROPBOX_APP_KEY?: string;
  readonly VITE_DROPBOX_FILE_PATH?: string;

  // WebDAV / Nextcloud
  readonly VITE_WEBDAV_URL?: string;
  readonly VITE_WEBDAV_FILE_NAME?: string;

  // Realtime (y-webrtc)
  readonly VITE_ROOM?: string;
  readonly VITE_ROOM_PASSWORD?: string;
  readonly VITE_SIGNALING_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
