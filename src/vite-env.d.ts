/// <reference types="vite/client" />

// Strong typing for the app's build-time env vars (read via import.meta.env).
// All VITE_-prefixed vars are inlined into the client bundle by Vite — so they
// are PUBLIC at runtime; none is a real secret.
// (Inline `import(...)` type keeps this file a global script so the ImportMetaEnv
// augmentation merges with Vite's — a top-level import would scope it to a module.)
interface ImportMetaEnv {
  // ── Collaboration ──
  readonly VITE_COLLAB_TRANSPORT?: import('./collaboration/config.js').CollabTransport;
  readonly VITE_SIGNALING_URL?: string;
  readonly VITE_WEBSOCKET_URL?: string;
  readonly VITE_DEFAULT_ROOM?: string;
  readonly VITE_ROOM_PASSWORD?: string;
  readonly VITE_FALLBACK_NAME?: string;
  readonly VITE_FALLBACK_COLOR?: string;
  readonly VITE_ROOM_AUTH?: import('./collaboration/roomAccess.js').RoomAccessMode;
  // ── WebRTC NAT traversal (STUN / TURN) ──
  readonly VITE_STUN_URL?: string;
  readonly VITE_TURN_URL?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
  // ── Storage backends ──
  readonly VITE_DROPBOX_APP_KEY?: string;
  readonly VITE_PCLOUD_CLIENT_ID?: string;
  readonly VITE_PROXY_URL?: string;
  readonly VITE_WEBDAV_URL?: string;
  readonly VITE_STORAGE_BACKEND?: string;
  readonly VITE_REDIRECT_URI?: string;
  readonly VITE_CLOUD_FOLDER?: string;
  readonly VITE_GITHUB_REPO?: string;
  readonly VITE_GITHUB_BRANCH?: string;
  readonly VITE_GITHUB_TOKEN?: string;
  readonly VITE_GITHUB_API_URL?: string;
  // ── Storage endpoints (override when a provider rotates a domain / region) ──
  readonly VITE_DROPBOX_AUTH_URL?: string;
  readonly VITE_DROPBOX_TOKEN_URL?: string;
  readonly VITE_DROPBOX_UPLOAD_URL?: string;
  readonly VITE_DROPBOX_DOWNLOAD_URL?: string;
  readonly VITE_PCLOUD_API_HOST?: string;
  readonly VITE_PCLOUD_EU_API_HOST?: string;
  readonly VITE_PCLOUD_GETFILELINK_PATH?: string;
  readonly VITE_PCLOUD_UPLOAD_PATH?: string;
  // ── OAuth + encoding tunables ──
  readonly VITE_OAUTH_TIMEOUT_MS?: string;
  readonly VITE_OAUTH_POPUP_FEATURES?: string;
  readonly VITE_BASE64_CHUNK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'pcloud-sdk-js' {
  interface OAuthCallbacks {
    (token: string, locationid?: number): void;
  }
  interface Sdk {
    oauth: {
      popup(
        clientId: string,
        onSuccess: OAuthCallbacks,
        onError?: (err: unknown) => void
      ): void;
    };
  }
  const sdk: Sdk;
  export default sdk;
}
