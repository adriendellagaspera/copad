import type { Storage, StorageAvailability, SessionCredentials, DocContent, Filename } from './types.js';
import type { StorageAuth } from './auth.js';
import { knownExtensions } from '../format/index.js';
import { STORAGE_ID } from './constants.js';

// showOpenFilePicker / showSaveFilePicker not yet in TypeScript's lib.dom.d.ts at this version.
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

// Module-level state — survives Svelte reactivity cycles but not page refresh.
let handle: FileSystemFileHandle | null = null; // File System Access API path
let mobileFile: File | null = null;             // <input type="file"> fallback path
let mobileNewFile = false;                       // "New file" selected in fallback mode

function hasFsAccessApi(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window;
}

function unavailableReason(): string | undefined {
  if (typeof window === 'undefined') return 'Not in a browser context.';
  if (!isSecureContext) return 'Requires a secure context — open via https:// or http://localhost.';
  return undefined;
}

// cancel fires on Chrome 113+ / Safari 16.4+; on older iOS the promise hangs until reload.
function pickFileMobile(): Promise<File> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = knownExtensions().join(',');
    input.style.cssText = 'position:fixed;top:-9999px';
    const cleanup = () => input.remove();
    input.addEventListener('change', () => {
      cleanup();
      const file = input.files?.[0];
      if (file) resolve(file);
      else reject(new DOMException('No file selected', 'AbortError'));
    });
    input.addEventListener('cancel', () => {
      cleanup();
      reject(new DOMException('The user aborted a request.', 'AbortError'));
    });
    document.body.appendChild(input);
    input.click();
  });
}

export function localFsStorage(): { auth: StorageAuth; storage: Storage } {
  const auth: StorageAuth = {
    isAuthenticated: () => handle !== null || mobileFile !== null || mobileNewFile,

    async login(creds?: SessionCredentials) {
      if (hasFsAccessApi()) {
        const types = [{
          description: 'Copad / text documents',
          accept: { 'application/octet-stream': knownExtensions() },
        }];
        if (creds?.mode === 'new') {
          handle = await window.showSaveFilePicker({ suggestedName: 'document.yjs', types });
        } else {
          [handle] = await window.showOpenFilePicker({ types });
        }
      } else {
        // Fallback: "New file" starts an empty document; save is a no-op.
        if (creds?.mode === 'new') {
          mobileFile = null;
          mobileNewFile = true;
        } else {
          mobileFile = await pickFileMobile();
          mobileNewFile = false;
        }
      }
    },

    logout() {
      handle = null;
      mobileFile = null;
      mobileNewFile = false;
    },
  };

  const storage: Storage = {
    id: STORAGE_ID.local,
    label: 'Local file',
    get blurb(): string {
      return hasFsAccessApi()
        ? 'Opens any text or source file on your device — .yjs, .md, .txt, .html, .json, .py, .js, .rs, …'
        : 'Import a file from your device — .yjs, .md, .txt, .html, .json, … Changes sync in real time and are preserved in the browser\'s local cache.';
    },
    get availability(): StorageAvailability {
      const reason = unavailableReason();
      return reason ? { ok: false, reason } : { ok: true };
    },

    // The picked file's name selects the codec; `.yjs` is the native default.
    filename(): Filename {
      if (handle) return handle.name as Filename;
      if (mobileFile) return mobileFile.name as Filename;
      return 'document.yjs' as Filename;
    },

    contentFormat: 'binary',

    async load(): Promise<DocContent | null> {
      if (handle) {
        const file = await handle.getFile();
        if (file.size === 0) return null;
        return { format: 'binary', bytes: new Uint8Array(await file.arrayBuffer()) };
      }
      if (mobileFile) {
        if (mobileFile.size === 0) return null;
        return { format: 'binary', bytes: new Uint8Array(await mobileFile.arrayBuffer()) };
      }
      if (mobileNewFile) return null; // Empty document; content comes from collaborators.
      throw new Error('Local: not connected');
    },

    async save(content: DocContent): Promise<void> {
      if (content.format !== 'binary') throw new Error('Local storage expects binary content');
      if (handle) {
        const writable = await handle.createWritable();
        await writable.write(content.bytes as unknown as FileSystemWriteChunkType);
        await writable.close();
        return;
      }
      // Fallback path: no write-back — edits persist in the Y.Doc and local cache.
    },
  };

  return { auth, storage };
}
