import { describe, it, expect } from 'vitest';
import { parsePCloudUploadResponse } from './parse.js';

describe('parsePCloudUploadResponse', () => {
  it('reads a successful upload', () => {
    const r = parsePCloudUploadResponse({ result: 0, fileids: [12345], metadata: [{}] });
    expect(r.result).toBe(0);
    expect(r.fileids).toEqual([12345]);
  });

  it('keeps the error message of a failed upload', () => {
    const r = parsePCloudUploadResponse({ result: 2000, error: 'Log in failed.' });
    expect(r.result).toBe(2000);
    expect(r.error).toBe('Log in failed.');
    expect(r.fileids).toEqual([]);
  });

  it('reports no file id when a zero result stored nothing', () => {
    expect(parsePCloudUploadResponse({ result: 0, fileids: [] }).fileids).toEqual([]);
  });

  it('treats a missing fileids field as no file stored', () => {
    expect(parsePCloudUploadResponse({ result: 0 }).fileids).toEqual([]);
  });

  it('drops non-numeric file ids rather than trusting them', () => {
    expect(parsePCloudUploadResponse({ result: 0, fileids: [1, 'x', null, 2] }).fileids)
      .toEqual([1, 2]);
  });

  it('rejects a non-object body', () => {
    expect(() => parsePCloudUploadResponse(null)).toThrow(/Unexpected pCloud upload response/);
    expect(() => parsePCloudUploadResponse('nope')).toThrow(/Unexpected pCloud upload response/);
  });

  it('rejects a body with no numeric result', () => {
    expect(() => parsePCloudUploadResponse({ error: 'boom' }))
      .toThrow(/pCloud upload response malformed/);
  });
});
