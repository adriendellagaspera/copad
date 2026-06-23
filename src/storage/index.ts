import type { StorageAdapter } from "./types";
import { PCloudAdapter } from "./pcloud";
import { DropboxAdapter } from "./dropbox";
import { WebDavAdapter } from "./webdav";

export type { StorageAdapter, CredentialField } from "./types";

// Build the list of usable backends. OAuth adapters need their app id configured;
// WebDAV is always offered because its credentials are entered at runtime.
export function availableAdapters(): StorageAdapter[] {
  const adapters: StorageAdapter[] = [];
  if (import.meta.env.VITE_PCLOUD_CLIENT_ID) adapters.push(new PCloudAdapter());
  if (import.meta.env.VITE_DROPBOX_APP_KEY) adapters.push(new DropboxAdapter());
  adapters.push(new WebDavAdapter());
  return adapters;
}

export const DEFAULT_BACKEND = import.meta.env.VITE_STORAGE_BACKEND || "";
