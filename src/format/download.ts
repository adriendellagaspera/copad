import type { RoomId, RoomName } from '../collaboration/types.js';

/** The stem of a downloaded export, before a codec appends its extension. */
export type ExportBaseName = string & { readonly _brand: 'ExportBaseName' };

export function exportBaseName(name: RoomName | null, room: RoomId): ExportBaseName {
  return (name ?? room) as string as ExportBaseName;
}

export async function downloadBytes(bytes: Uint8Array, filename: string): Promise<void> {
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: filename });
      const writable = await handle.createWritable();
      await writable.write(bytes as unknown as FileSystemWriteChunkType);
      await writable.close();
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }
  const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
