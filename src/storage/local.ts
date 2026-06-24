import type { Storage } from './types.js';

// showSaveFilePicker is part of the File System Access API Living Standard
// and not yet in TypeScript's lib.dom.d.ts at this version.
declare global {
  interface Window {
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

const FS_ACCESS_UNAVAILABLE =
  typeof window === 'undefined' || !('showSaveFilePicker' in window)
    ? 'Requires a browser that supports the File System Access API (Chrome/Edge). ' +
      'On Brave, try lowering Shields for this site.'
    : undefined;

export function localFsStorage(): Storage {
  return {
    id: 'local',
    label: 'Local file',
    unavailableReason: FS_ACCESS_UNAVAILABLE,

    isAuthenticated: () => handle !== null,

    // showSaveFilePicker: lets the user pick an existing file OR create a new one.
    async connect() {
      handle = await window.showSaveFilePicker({
        suggestedName: 'copad-document.yjs',
        types: [{ description: 'Copad document', accept: { 'application/octet-stream': ['.yjs'] } }],
      });
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
