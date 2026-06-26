import type { Storage, StorageAvailability, SessionCredentials, DocContent, StorageId, Filename } from './types.js';
import type { StorageAuth } from './auth.js';
import { knownExtensions } from '../format/index.js';

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
  if (typeof window === 'undefined') return 'Not in a browser context.';
  if ('showOpenFilePicker' in window) return undefined;
  if (!isSecureContext) {
    return 'The File System Access API requires a secure context. ' +
      'Open this app via https:// or http://localhost instead of a plain HTTP URL.';
  }
  const isBrave = (navigator as Navigator & { brave?: unknown }).brave != null;
  return isBrave
    ? 'Brave disables the File System Access API by default. ' +
      'Go to brave://flags, search for "File System Access API", set it to Enabled, ' +
      'then relaunch Brave.'
    : 'Requires a browser that supports the File System Access API (Chrome/Edge).';
}

export function localFsStorage(): { auth: StorageAuth; storage: Storage } {
  const auth: StorageAuth = {
    isAuthenticated: () => handle !== null,

    async login(creds?: SessionCredentials) {
      const types = [
        {
          description: 'Copad / text documents',
          accept: { 'application/octet-stream': knownExtensions() },
        },
      ];
      if (creds?.mode === 'new') {
        handle = await window.showSaveFilePicker({ suggestedName: 'document.yjs', types });
      } else {
        [handle] = await window.showOpenFilePicker({ types });
      }
    },

    logout() {
      handle = null;
    },
  };

  const storage: Storage = {
    id: 'local' as StorageId,
    label: 'Local file',
    blurb: 'Opens any text or source file on your device — .yjs, .md, .txt, .html, .json, .py, .js, .rs, … (Chrome/Edge).',
    get availability(): StorageAvailability {
      const reason = fsAccessUnavailableReason();
      return reason ? { ok: false, reason } : { ok: true };
    },

    // The picked file's name selects the codec; `.yjs` is the native default.
    filename: () => (handle?.name ?? 'document.yjs') as Filename,

    contentFormat: 'binary',

    async load(): Promise<DocContent | null> {
      if (!handle) throw new Error('Local: not connected');
      const file = await handle.getFile();
      if (file.size === 0) return null;
      return { format: 'binary', bytes: new Uint8Array(await file.arrayBuffer()) };
    },

    async save(content: DocContent): Promise<void> {
      if (content.format !== 'binary') throw new Error('Local storage expects binary content');
      if (!handle) throw new Error('Local: not connected');
      const writable = await handle.createWritable();
      await writable.write(content.bytes as unknown as FileSystemWriteChunkType);
      await writable.close();
    },
  };

  return { auth, storage };
}
