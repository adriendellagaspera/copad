import { STORAGE_ID } from '../storage/constants.js';
import type { StorageId } from '../storage/types.js';

// A bare "/…" path is invisible to Vite's asset pipeline and would break a subpath build, so it goes through BASE_URL.
export const asset = (path: string): string => `${import.meta.env.BASE_URL}${path}`;

export const IMAGE_ICONS: Partial<Record<StorageId, string>> = {
  [STORAGE_ID.pcloud]: asset('pcloud.svg'),
};

// "sharepoint" hits a site library or OneDrive by `siteUrl` (storage/sharepoint.ts), so no static map entry fits.
export const SHAREPOINT_SITE_IMAGE = asset('microsoft-sharepoint.svg');
export const SHAREPOINT_ONEDRIVE_IMAGE = asset('microsoft-onedrive.svg');
