import { STORAGE_ID } from '../storage/constants.js';
import type { StorageId } from '../storage/types.js';

// A bare "/…" string is invisible to Vite's asset pipeline and would break a subpath build, so paths go through BASE_URL.
export const asset = (path: string): string => `${import.meta.env.BASE_URL}${path}`;

export const IMAGE_ICONS: Partial<Record<StorageId, string>> = {
  [STORAGE_ID.pcloud]: asset('pcloud.svg'),
};

// One "sharepoint" backend hits either a site library or OneDrive depending on its `siteUrl` (src/storage/sharepoint.ts), so its logo cannot come from the static map.
export const SHAREPOINT_SITE_IMAGE = asset('microsoft-sharepoint.svg');
export const SHAREPOINT_ONEDRIVE_IMAGE = asset('microsoft-onedrive.svg');
