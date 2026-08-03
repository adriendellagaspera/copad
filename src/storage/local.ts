import type { Storage, StorageAvailability, LoginOptions, DocContent, Filename } from './types.js';
import { DocFormat, OpenMode, LoginKind } from './types.js';
import type { StorageAuth } from './auth.js';
import { knownExtensions } from '../format/index.js';
import { STORAGE_ID } from './constants.js';

// Not yet in TypeScript's lib.dom.d.ts.
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

const LocalMode = { Idle: 'idle', Native: 'native', Imported: 'imported', New: 'new' } as const;
type LocalMode = (typeof LocalMode)[keyof typeof LocalMode];

type LocalState =
  | { readonly mode: typeof LocalMode.Idle }
  | { readonly mode: typeof LocalMode.Native; readonly handle: FileSystemFileHandle }
  | { readonly mode: typeof LocalMode.Imported; readonly file: File }
  | { readonly mode: typeof LocalMode.New };

let state: LocalState = { mode: LocalMode.Idle };

function hasFsAccessApi(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window;
}

function unavailableReason(): string | undefined {
  if (typeof window === 'undefined') return 'Not in a browser context.';
  if (!isSecureContext) return 'Requires a secure context — open via https:// or http://localhost.';
  return undefined;
}

// `cancel` needs Chrome 113+ / Safari 16.4+; older iOS leaves this pending until reload.
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
      else reject(new Error('No file selected'));
    });
    input.addEventListener('cancel', () => {
      cleanup();
      reject(new Error('The user aborted a request.'));
    });
    document.body.appendChild(input);
    input.click();
  });
}

export function localFsStorage(): { auth: StorageAuth; storage: Storage } {
  const auth: StorageAuth = {
    isAuthenticated: () => state.mode !== LocalMode.Idle,

    async login(opts?: LoginOptions) {
      const createNew = opts?.kind === LoginKind.Open && opts.mode === OpenMode.New;
      if (hasFsAccessApi()) {
        const types = [{
          description: 'Copad / text documents',
          accept: { 'application/octet-stream': knownExtensions() },
        }];
        if (createNew) {
          state = { mode: LocalMode.Native, handle: await window.showSaveFilePicker({ suggestedName: 'document.yjs', types }) };
        } else {
          const [handle] = await window.showOpenFilePicker({ types });
          state = { mode: LocalMode.Native, handle };
        }
      } else {
        state = createNew
          ? { mode: LocalMode.New }
          : { mode: LocalMode.Imported, file: await pickFileMobile() };
      }
    },

    logout() {
      state = { mode: LocalMode.Idle };
    },
  };

  const storage: Storage = {
    id: STORAGE_ID.local,
    label: 'Local file',
    get blurb(): string {
      return hasFsAccessApi()
        ? 'Opens any text or source file on your device — .yjs, .md, .txt, .html, .json, .py, .js, .rs, …'
        : 'Import a file from your device — .yjs, .md, .txt, .html, .json, … Changes sync in real time and stay in this browser\'s local cache; this browser can\'t write them back to the original file.';
    },
    get availability(): StorageAvailability {
      const reason = unavailableReason();
      return reason ? { ok: false, reason } : { ok: true };
    },

    filename(): Filename {
      const name =
        state.mode === LocalMode.Native ? state.handle.name
        : state.mode === LocalMode.Imported ? state.file.name
        : 'document.yjs';
      return name as Filename;
    },

    contentFormat: DocFormat.Binary,

    async load(): Promise<DocContent | null> {
      switch (state.mode) {
        case LocalMode.Native: {
          const file = await state.handle.getFile();
          return file.size === 0
            ? null
            : { format: DocFormat.Binary, bytes: new Uint8Array(await file.arrayBuffer()) };
        }
        case LocalMode.Imported:
          return state.file.size === 0
            ? null
            : { format: DocFormat.Binary, bytes: new Uint8Array(await state.file.arrayBuffer()) };
        case LocalMode.New:
          return null;
        case LocalMode.Idle:
          throw new Error('Local: not connected');
      }
    },

    async save(content: DocContent): Promise<void> {
      if (content.format !== DocFormat.Binary) throw new Error('Local storage expects binary content');
      switch (state.mode) {
        case LocalMode.Native: {
          const writable = await state.handle.createWritable();
          await writable.write(content.bytes as unknown as FileSystemWriteChunkType);
          await writable.close();
          return;
        }
        case LocalMode.Imported:
        case LocalMode.New:
          throw new Error(
            'this browser can\'t write files back (no File System Access API). ' +
              'Changes stay in the session and the local cache — connect a cloud ' +
              'backend or export the document to keep them.'
          );
        case LocalMode.Idle:
          throw new Error('Local: not connected');
      }
    },
  };

  return { auth, storage };
}
