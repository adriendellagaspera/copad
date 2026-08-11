// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { downloadBytes, exportBaseName } from './download.js';
import type { RoomId, RoomName } from '../collaboration/types.js';

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
});

describe('downloadBytes', () => {
  it('falls back to a Blob + anchor click when the File System Access API is unavailable', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    await downloadBytes(new TextEncoder().encode('hello'), 'notes.txt');

    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(revokeUrl).toHaveBeenCalledWith('blob:mock');
  });

  it('prefers the File System Access API save picker when available', async () => {
    const write = vi.fn();
    const close = vi.fn();
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    const showSaveFilePicker = vi.fn().mockResolvedValue({ createWritable });
    (window as unknown as { showSaveFilePicker: typeof showSaveFilePicker }).showSaveFilePicker =
      showSaveFilePicker;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');

    const bytes = new TextEncoder().encode('hello');
    await downloadBytes(bytes, 'notes.txt');

    expect(showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: 'notes.txt' });
    expect(write).toHaveBeenCalledWith(bytes);
    expect(close).toHaveBeenCalledTimes(1);
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('treats a cancelled save picker as success, not a fallback', async () => {
    const showSaveFilePicker = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    (window as unknown as { showSaveFilePicker: typeof showSaveFilePicker }).showSaveFilePicker =
      showSaveFilePicker;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await downloadBytes(new TextEncoder().encode('hello'), 'notes.txt');

    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('falls back to the Blob path when the save picker fails for another reason', async () => {
    const showSaveFilePicker = vi.fn().mockRejectedValue(new Error('permission denied'));
    (window as unknown as { showSaveFilePicker: typeof showSaveFilePicker }).showSaveFilePicker =
      showSaveFilePicker;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    await downloadBytes(new TextEncoder().encode('hello'), 'notes.txt');

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});

describe('exportBaseName', () => {
  const room = 'b41f2c9e' as RoomId;

  it('uses the collaborative room name when there is one', () => {
    expect(exportBaseName('Q3 plan' as RoomName, room)).toBe('Q3 plan');
  });

  it('falls back to the room id, so an unnamed export still has a stem', () => {
    expect(exportBaseName(null, room)).toBe('b41f2c9e');
  });
});
