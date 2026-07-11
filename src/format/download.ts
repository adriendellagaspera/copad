// showSaveFilePicker's ambient `Window` augmentation lives in storage/local.ts
// (the other module that needs it) and applies project-wide — no import needed.

/**
 * Trigger a browser download of `bytes` named `filename`. Prefers the File
 * System Access API's save picker so the user can choose where the file
 * goes; falls back to a Blob + anchor click where unavailable (Firefox,
 * Safari). iOS Safari ignores the `download` attribute on `blob:` URLs and
 * opens the file instead of saving it — a known WebKit limitation with no
 * script-side workaround.
 */
export async function downloadBytes(bytes: Uint8Array, filename: string): Promise<void> {
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: filename });
      const writable = await handle.createWritable();
      await writable.write(bytes as unknown as FileSystemWriteChunkType);
      await writable.close();
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return; // user cancelled
      // Any other picker failure (permission denial, …) falls through to the Blob path.
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
