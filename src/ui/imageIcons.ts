import { STORAGE_ID } from '../storage/constants.js';
import type { StorageId } from '../storage/types.js';

// Full-color brand marks served as static files from public/ — too detailed
// (gradients, multiple shapes) to inline as a single flat path the way
// brandIcons.ts does. Referenced by URL and rendered via <img> instead.
export const IMAGE_ICONS: Partial<Record<StorageId, string>> = {
  [STORAGE_ID.pcloud]: '/pcloud.svg',
};

// The "sharepoint" backend targets either a SharePoint site's document
// library or the signed-in user's own OneDrive for Business drive,
// depending on whether its `siteUrl` config field is set (falls back to
// `/me/drive` when empty — see src/storage/sharepoint.ts). Its tile shows
// whichever logo matches what it's actually configured to hit, so these are
// looked up directly rather than through the static IMAGE_ICONS map.
export const SHAREPOINT_SITE_IMAGE = '/microsoft-sharepoint.svg';
export const SHAREPOINT_ONEDRIVE_IMAGE = '/microsoft-onedrive.svg';
