import type { Storage } from './types.js';

// showOpenFilePicker is part of the File System Access API Living Standard
// and not yet in TypeScript's lib.dom.d.ts at this version.
declare global {
  interface Window {
    showOpenFilePicker(opts?: {
      multiple?: boolean;
      types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }): Promise<FileSystemFileHandle[]>;
    showSaveFilePicker(opts?: {
      suggestedName?: string;
      types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }): Promise<FileSystemFileHandle>;
  }
}

// Module-level handle — survives Svelte reactivity cycles but not page refresh.
// The user re-picks the file after a refresh (FileSystemFileHandle permission
// can't be re-granted without a user gesture anyway).
let handle: FileSystemFileHandle | null = null;

function fsAccessUnavailableReason(): string | undefined {
  if (typeof window === 'undefined' || !('showOpenFilePicker' in window)) {
    const isBrave = (navigator as Navigator & { brave?: unknown }).brave != null;
    return isBrave
      ? 'Brave is blocking the File System Access API. ' +
        'Lower Shields for this site and reload, or go to brave://settings/content/filesystem ' +
        'and allow this origin.'
      : 'Requires a browser that supports the File System Access API (Chrome/Edge).';
  }
  return undefined;
}

export function localFsStorage(): Storage {
  return {
    id: 'local',
    label: 'Local file',
    blurb: 'Saves to a file on your device (Chrome/Edge).',
    get unavailableReason() { return fsAccessUnavailableReason(); },

    isAuthenticated: () => handle !== null,

    async connect(creds?: Record<string, string>) {
      const types = [{ description: 'Copad document', accept: { 'application/octet-stream': ['.yjs'] } }];
      if (creds?.mode === 'new') {
        handle = await window.showSaveFilePicker({ suggestedName: 'document.yjs', types });
      } else {
        [handle] = await window.showOpenFilePicker({ types });
      }
    },

    disconnect() {
      handle = null;
    },

    async load() {
      if (!handle) throw new Error('Local: not connected');
      const file = await handle.getFile();
      if (file.size === 0) return null;
      return new Uint8Array(await file.arrayBuffer());
    },

    async save(bytes) {
      if (!handle) throw new Error('Local: not connected');
      const writable = await handle.createWritable();
      await writable.write(bytes as unknown as FileSystemWriteChunkType);
      await writable.close();
    },
  };
}
