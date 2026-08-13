import { describe, it, expect, vi } from 'vitest';
import { schema } from '../schema.js';
import { headingsOf, memoiseHeadings } from './outline.js';

function heading(level: number, text?: string) {
  return schema.node('heading', { level }, text ? schema.text(text) : undefined);
}

function paragraph(text: string) {
  return schema.node('paragraph', null, schema.text(text));
}

function doc(...content: ReturnType<typeof heading>[]) {
  return schema.node('doc', null, content);
}

describe('headingsOf', () => {
  it('returns nothing for a document without headings', () => {
    expect(headingsOf(doc(paragraph('body')))).toEqual([]);
  });

  it('collects headings in document order with their levels', () => {
    const d = doc(heading(1, 'One'), paragraph('body'), heading(3, 'Three'), heading(2, 'Two'));
    expect(headingsOf(d).map((h) => [h.level, h.text])).toEqual([
      [1, 'One'],
      [3, 'Three'],
      [2, 'Two'],
    ]);
  });

  it('reports a position that resolves back to the heading', () => {
    const d = doc(paragraph('body'), heading(2, 'Target'));
    const [found] = headingsOf(d);
    expect(d.nodeAt(found.pos)?.textContent).toBe('Target');
  });

  it('labels an empty heading rather than returning a blank row', () => {
    expect(headingsOf(doc(heading(1))).map((h) => h.text)).toEqual(['Untitled']);
  });

  it('falls back to level 1 when the attr is malformed', () => {
    const malformed = schema.node('heading', { level: 'two' }, schema.text('Odd'));
    expect(headingsOf(doc(malformed))[0].level).toBe(1);
  });

  it('finds headings nested inside other blocks', () => {
    const quote = schema.node('blockquote', null, [heading(2, 'Quoted')]);
    expect(headingsOf(doc(quote)).map((h) => h.text)).toEqual(['Quoted']);
  });
});

describe('memoiseHeadings', () => {
  it('walks once for repeated reads of the same doc', () => {
    const d = doc(heading(1, 'One'));
    const walk = vi.spyOn(d, 'descendants');
    const read = memoiseHeadings();

    read(d);
    read(d);
    read(d);

    expect(walk).toHaveBeenCalledTimes(1);
  });

  it('returns the identical array, so downstream consumers see no change', () => {
    const d = doc(heading(1, 'One'));
    const read = memoiseHeadings();
    expect(read(d)).toBe(read(d));
  });

  it('re-walks once the document is a different tree', () => {
    const read = memoiseHeadings();
    expect(read(doc(heading(1, 'One'))).map((h) => h.text)).toEqual(['One']);
    expect(read(doc(heading(1, 'Two'))).map((h) => h.text)).toEqual(['Two']);
  });

  it('handles a null doc before the editor has mounted', () => {
    const read = memoiseHeadings();
    expect(read(null)).toEqual([]);
    expect(read(doc(heading(1, 'One')))).toHaveLength(1);
  });
});
