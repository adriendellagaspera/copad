import { describe, it, expect } from 'vitest';
import { docContentBytes } from './types.js';

describe('docContentBytes', () => {
  it('returns the bytes as-is for binary content', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(docContentBytes({ format: 'binary', bytes })).toBe(bytes);
  });

  it('UTF-8 encodes text content', () => {
    expect(docContentBytes({ format: 'text', text: 'hello' })).toEqual(new TextEncoder().encode('hello'));
  });

  it('round-trips non-ASCII text', () => {
    const bytes = docContentBytes({ format: 'text', text: 'héllo — wörld' });
    expect(new TextDecoder().decode(bytes)).toBe('héllo — wörld');
  });
});
