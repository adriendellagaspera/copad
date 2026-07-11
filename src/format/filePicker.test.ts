// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { hasFsAccessApi, pickFile } from './filePicker.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('hasFsAccessApi', () => {
  it('is false when the browser has no showOpenFilePicker (happy-dom default)', () => {
    expect(hasFsAccessApi()).toBe(false);
  });

  it('is true once showOpenFilePicker is present', () => {
    vi.stubGlobal('showOpenFilePicker', vi.fn());
    expect(hasFsAccessApi()).toBe(true);
  });
});

describe('pickFile — native File System Access API path', () => {
  it('resolves the file returned by the picked handle', async () => {
    const file = new File(['hello'], 'notes.md');
    vi.stubGlobal(
      'showOpenFilePicker',
      vi.fn().mockResolvedValue([{ getFile: () => Promise.resolve(file) }]),
    );

    await expect(pickFile()).resolves.toBe(file);
  });

  it('passes the known codec extensions as the accept filter', async () => {
    const showOpenFilePicker = vi.fn().mockResolvedValue([{ getFile: () => Promise.resolve(new File([], 'x')) }]);
    vi.stubGlobal('showOpenFilePicker', showOpenFilePicker);

    await pickFile();

    const opts = showOpenFilePicker.mock.calls[0][0];
    const accepted = opts.types[0].accept['application/octet-stream'];
    expect(accepted).toContain('.yjs');
    expect(accepted).toContain('.md');
  });
});

describe('pickFile — <input type=file> fallback (no File System Access API)', () => {
  it('resolves with the file the user picks', async () => {
    const file = new File(['hello'], 'notes.md');
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      Object.defineProperty(this, 'files', { value: [file], configurable: true });
      this.dispatchEvent(new Event('change'));
    });

    await expect(pickFile()).resolves.toBe(file);
  });

  it('sets accept to the known codec extensions', async () => {
    let capturedAccept = '';
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      capturedAccept = this.accept;
      Object.defineProperty(this, 'files', { value: [new File([], 'x.txt')], configurable: true });
      this.dispatchEvent(new Event('change'));
    });

    await pickFile();

    expect(capturedAccept).toContain('.md');
    expect(capturedAccept).toContain('.yjs');
  });

  it('rejects when the user cancels', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      this.dispatchEvent(new Event('cancel'));
    });

    await expect(pickFile()).rejects.toThrow('aborted');
  });

  it('rejects when no file was selected', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      this.dispatchEvent(new Event('change'));
    });

    await expect(pickFile()).rejects.toThrow('No file selected');
  });
});
