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

type LocalState =
  | { readonly mode: 'idle' }
  | { readonly mode: 'native'; readonly handle: FileSystemFileHandle }
  | { readonly mode: 'imported'; readonly file: File }
  | { readonly mode: 'new' };

// Module-level state — survives Svelte reactivity cycles but not page refresh.
let state: LocalState = { mode: 'idle' };

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
    isAuthenticated: () => state.mode !== 'idle',

    async login(creds?: SessionCredentials) {
      if (hasFsAccessApi()) {
        const types = [{
          description: 'Copad / text documents',
          accept: { 'application/octet-stream': knownExtensions() },
        }];
        if (creds?.mode === 'new') {
          state = { mode: 'native', handle: await window.showSaveFilePicker({ suggestedName: 'document.yjs', types }) };
        } else {
          const [handle] = await window.showOpenFilePicker({ types });
          state = { mode: 'native', handle };
        }
      } else {
        // Fallback: "New file" starts an empty document; save is a no-op.
        state = creds?.mode === 'new'
          ? { mode: 'new' }
          : { mode: 'imported', file: await pickFileMobile() };
      }
    },

    logout() {
      state = { mode: 'idle' };
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
      if (state.mode === 'native') return state.handle.name as Filename;
      if (state.mode === 'imported') return state.file.name as Filename;
      return 'document.yjs' as Filename;
    },

    contentFormat: 'binary',

    async load(): Promise<DocContent | null> {
      if (state.mode === 'native') {
        const file = await state.handle.getFile();
        if (file.size === 0) return null;
        return { format: 'binary', bytes: new Uint8Array(await file.arrayBuffer()) };
      }
      if (state.mode === 'imported') {
        if (state.file.size === 0) return null;
        return { format: 'binary', bytes: new Uint8Array(await state.file.arrayBuffer()) };
      }
      if (state.mode === 'new') return null; // Empty document; content comes from collaborators.
      throw new Error('Local: not connected');
    },

    async save(content: DocContent): Promise<void> {
      if (content.format !== 'binary') throw new Error('Local storage expects binary content');
      if (state.mode === 'native') {
        const writable = await state.handle.createWritable();
        await writable.write(content.bytes as unknown as FileSystemWriteChunkType);
        await writable.close();
        return;
      }
      // Fallback path: no write-back — edits persist in the Y.Doc and local cache.
    },
  };

  return { auth, storage };
}
