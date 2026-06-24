import type { Fetch } from './types.js';

export const directFetch: Fetch = (url, init) => fetch(url, init);
