import { knownExtensions } from './index.js';

// showOpenFilePicker not yet in TypeScript's lib.dom.d.ts at this version.
declare global {
  interface Window {
    showOpenFilePicker(opts?: {
      multiple?: boolean;
      types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }): Promise<FileSystemFileHandle[]>;
  }
}

export function hasFsAccessApi(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window;
}

// cancel fires on Chrome 113+ / Safari 16.4+; on older iOS the promise hangs until reload.
export function pickFileMobile(): Promise<File> {
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

/** Prompt the user to pick one file from disk for reading — native picker when available, else a hidden `<input>`. */
export async function pickFile(): Promise<File> {
  if (hasFsAccessApi()) {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'Copad / text documents', accept: { 'application/octet-stream': knownExtensions() } }],
    });
    return handle.getFile();
  }
  return pickFileMobile();
}
