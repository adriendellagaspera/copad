/// <reference types="vite/client" />

// Vite inlines every VITE_-prefixed var into the client bundle: all are public, none a secret.
// Types are imported inline so this file stays a global script and the augmentation merges.
interface ImportMetaEnv {
  readonly VITE_APP_NAMESPACE?: string;
  readonly VITE_COLLAB_TRANSPORT?: import('./collaboration/config.js').CollabTransport;
  readonly VITE_SIGNALING_URL?: string;
  readonly VITE_WEBSOCKET_URL?: string;
  readonly VITE_DEFAULT_ROOM?: string;
  readonly VITE_ROOM_PASSWORD?: string;
  readonly VITE_FALLBACK_NAME?: string;
  readonly VITE_FALLBACK_COLOR?: string;
  readonly VITE_ROOM_AUTH?: import('./collaboration/roomAccess.js').RoomAccessMode;
  readonly VITE_STUN_URL?: string;
  readonly VITE_TURN_URL?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_PASSWORD?: string;
  readonly VITE_DROPBOX_APP_KEY?: string;
  readonly VITE_PCLOUD_CLIENT_ID?: string;
  readonly VITE_PROXY_URL?: string;
  readonly VITE_WEBDAV_URL?: string;
  readonly VITE_STORAGE_BACKEND?: string;
  readonly VITE_REDIRECT_URI?: string;
  readonly VITE_CLOUD_FOLDER?: string;
  readonly VITE_DEFAULT_FILENAME?: string;
  readonly VITE_GITHUB_DEFAULT_FILENAME?: string;
  readonly VITE_GITHUB_REPO?: string;
  readonly VITE_GITHUB_BRANCH?: string;
  readonly VITE_GITHUB_TOKEN?: string;
  readonly VITE_GITHUB_API_URL?: string;
  readonly VITE_DROPBOX_AUTH_URL?: string;
  readonly VITE_DROPBOX_TOKEN_URL?: string;
  readonly VITE_DROPBOX_UPLOAD_URL?: string;
  readonly VITE_DROPBOX_DOWNLOAD_URL?: string;
  readonly VITE_PCLOUD_API_HOST?: string;
  readonly VITE_PCLOUD_EU_API_HOST?: string;
  readonly VITE_PCLOUD_GETFILELINK_PATH?: string;
  readonly VITE_PCLOUD_UPLOAD_PATH?: string;
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
