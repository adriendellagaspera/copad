import { untrack } from 'svelte';
import { localStore } from '../persistence/local.js';
import { nsKey } from '../config.js';

export type ZoomFactor = number & { readonly _brand: 'ZoomFactor' };

const ZOOM_MIN = 0.5 as ZoomFactor;
const ZOOM_MAX = 2 as ZoomFactor;
const ZOOM_STEP = 0.1;
const ZOOM_DEFAULT = 1 as ZoomFactor;

function clamp(factor: number): ZoomFactor {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, factor)) as ZoomFactor;
}

function parseZoomFactor(raw: string | null): ZoomFactor {
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? clamp(n) : ZOOM_DEFAULT;
}

const zoomStore = localStore<ZoomFactor>(nsKey('zoom'), parseZoomFactor, String);

// try/catch, not a `typeof document` check: matches local.ts's own SSR idiom ("SSR... throw here").
function applyZoom(factor: ZoomFactor): void {
  try {
    document.documentElement.style.setProperty('--zoom', String(factor));
  } catch {
    /* SSR: no document. */
  }
}

export function createZoom() {
  let factor = $state<ZoomFactor>(zoomStore.read());
  applyZoom(untrack(() => factor));

  function set(next: ZoomFactor): void {
    factor = next;
    zoomStore.write(next);
    applyZoom(next);
  }

  return {
    get factor() {
      return factor;
    },
    increase(): void {
      set(clamp(factor + ZOOM_STEP));
    },
    decrease(): void {
      set(clamp(factor - ZOOM_STEP));
    },
    reset(): void {
      set(ZOOM_DEFAULT);
    },
  };
}

export type Zoom = ReturnType<typeof createZoom>;
