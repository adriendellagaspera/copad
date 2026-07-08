import { STORAGE_ID } from '../storage/constants.js';
import type { StorageId } from '../storage/types.js';

// Full-color brand marks served as static files from public/ — too detailed
// (gradients, multiple shapes) to inline as a single flat path the way
// brandIcons.ts does. Referenced by URL and rendered via <img> instead.
export const IMAGE_ICONS: Partial<Record<StorageId, string>> = {
  [STORAGE_ID.pcloud]: '/pcloud.svg',
  [STORAGE_ID.sharepoint]: '/microsoft-sharepoint.svg',
};
