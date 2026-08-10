import { STORAGE_ID } from '../storage/constants.js';
import type { StorageId } from '../storage/types.js';

// Full-color brand marks served as static files from public/ — too detailed
// (gradients, multiple shapes) to inline as a single flat path the way
// brandIcons.ts does. Referenced by URL and rendered via <img> instead.
//
// Prefixed with import.meta.env.BASE_URL (not a bare "/…") — a plain string
// like this is invisible to Vite's asset pipeline (unlike an `import` or an
// href already inside index.html), so it would keep resolving against the
// domain root even when the app itself is built for a subpath, e.g. the PR
// preview deploys' `--base=/copad/pr-<n>/` (.github/workflows/pr-preview.yml).
// BASE_URL is Vite's own runtime constant for exactly this and always ends
// in a trailing slash.
export const asset = (path: string): string => `${import.meta.env.BASE_URL}${path}`;

export const IMAGE_ICONS: Partial<Record<StorageId, string>> = {
  [STORAGE_ID.pcloud]: asset('pcloud.svg'),
};

// The "sharepoint" backend targets either a SharePoint site's document
// library or the signed-in user's own OneDrive for Business drive,
// depending on whether its `siteUrl` config field is set (falls back to
// `/me/drive` when empty — see src/storage/sharepoint.ts). Its tile shows
// whichever logo matches what it's actually configured to hit, so these are
// looked up directly rather than through the static IMAGE_ICONS map.
export const SHAREPOINT_SITE_IMAGE = asset('microsoft-sharepoint.svg');
export const SHAREPOINT_ONEDRIVE_IMAGE = asset('microsoft-onedrive.svg');
