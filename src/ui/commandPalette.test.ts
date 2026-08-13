import { describe, it, expect } from 'vitest';
import type { RoomId } from '../collaboration/types.js';
import type { DocHeading, HeadingLevel, HeadingText, DocPos } from '../editor/ui/outline.js';
import {
  parsePaletteInput,
  parsePaletteItemId,
  paletteGroups,
  actionItemId,
  insertItemId,
  headingItemId,
  paletteItemName,
  type PaletteAction,
  type PaletteInsert,
  type PaletteRoom,
  type PaletteSources,
  type PaletteItemId,
  type PaletteItemKeywords,
  type PaletteItemLabel,
  type PaletteItemHint,
} from './commandPalette.js';

function headingOf(level: number, text: string, pos: number): DocHeading {
  return { level: level as HeadingLevel, text: text as HeadingText, pos: pos as DocPos };
}

function actionOf(id: string, label: string, keywords = ''): PaletteAction {
  return {
    id: id as PaletteItemId,
    label: label as PaletteItemLabel,
    keywords: keywords as PaletteItemKeywords,
  };
}

function insertOf(id: string, label: string): PaletteInsert {
  return {
    id: id as PaletteItemId,
    label: label as PaletteItemLabel,
    keywords: '' as PaletteItemKeywords,
  };
}

function roomOf(room: string, label: string): PaletteRoom {
  return {
    room: room as RoomId,
    label: label as PaletteItemLabel,
    hint: '3h ago' as PaletteItemHint,
  };
}

const SOURCES: PaletteSources = {
  headings: [headingOf(1, 'Decisions', 0), headingOf(2, 'Open questions', 40)],
  actions: [actionOf('export', 'Export a copy', 'download save'), actionOf('share', 'Share')],
  rooms: [roomOf('r1', 'Design decisions'), roomOf('r2', 'Untitled')],
  inserts: [insertOf('table', 'Table'), insertOf('quote', 'Quote')],
};

const labels = (sources: PaletteSources, raw: string): string[][] =>
  paletteGroups(sources, parsePaletteInput(raw)).map((g) => [
    g.label,
    ...g.items.map((i) => i.label),
  ]);

describe('parsePaletteInput', () => {
  it('reads a bare query as searching everything', () => {
    expect(parsePaletteInput('dec')).toEqual({ scope: { kind: 'everything' }, query: 'dec' });
  });

  it('reads each prefix as its scope', () => {
    expect(parsePaletteInput('#dec').scope).toEqual({ kind: 'headings' });
    expect(parsePaletteInput('>exp').scope).toEqual({ kind: 'actions' });
    expect(parsePaletteInput('/tab').scope).toEqual({ kind: 'insert' });
  });

  it('strips the prefix from the query', () => {
    expect(parsePaletteInput('#dec').query).toBe('dec');
    expect(parsePaletteInput('>  exp  ').query).toBe('exp');
  });

  it('treats a bare prefix as that scope with no query', () => {
    expect(parsePaletteInput('#')).toEqual({ scope: { kind: 'headings' }, query: '' });
  });

  it('leaves a prefix mid-string alone', () => {
    expect(parsePaletteInput('c# notes')).toEqual({
      scope: { kind: 'everything' },
      query: 'c# notes',
    });
  });

  it('reads an empty input as everything, no query', () => {
    expect(parsePaletteInput('   ')).toEqual({ scope: { kind: 'everything' }, query: '' });
  });
});

describe('parsePaletteItemId', () => {
  it('round-trips every constructor', () => {
    expect(parsePaletteItemId(headingItemId(42 as DocPos))).toEqual({ kind: 'heading', pos: 42 });
    expect(parsePaletteItemId(insertItemId(paletteItemName('Table')))).toEqual({
      kind: 'insert',
      name: 'Table',
    });
    expect(parsePaletteItemId(actionItemId(paletteItemName('export')))).toEqual({
      kind: 'action',
      name: 'export',
    });
  });

  it('keeps a room id whole, colons and all', () => {
    expect(parsePaletteItemId('room:a:b' as PaletteItemId)).toEqual({ kind: 'room', room: 'a:b' });
  });

  it('falls back to an action rather than a bogus document position', () => {
    expect(parsePaletteItemId('heading:nope' as PaletteItemId).kind).toBe('action');
    expect(parsePaletteItemId('heading:-3' as PaletteItemId).kind).toBe('action');
    expect(parsePaletteItemId('nonsense' as PaletteItemId).kind).toBe('action');
  });
});

describe('paletteGroups', () => {
  it('rests on recent rooms and the first headings, never blank', () => {
    expect(labels(SOURCES, '')).toEqual([
      ['In this document', 'Decisions', 'Open questions'],
      ['Your documents', 'Design decisions', 'Untitled'],
    ]);
  });

  it('caps each resting group so the panel stays short', () => {
    const many = Array.from({ length: 9 }, (_, i) => roomOf(`r${i}`, `Room ${i}`));
    const [, rooms] = labels({ ...SOURCES, rooms: many }, '');
    expect(rooms).toHaveLength(1 + 5);
  });

  it('searches headings, actions and rooms together on a bare query', () => {
    expect(labels(SOURCES, 'dec')).toEqual([
      ['In this document', 'Decisions'],
      ['Your documents', 'Design decisions'],
    ]);
  });

  it('drops groups with no match rather than showing an empty heading', () => {
    expect(labels(SOURCES, 'Open')).toEqual([['In this document', 'Open questions']]);
  });

  it('returns nothing at all when nothing matches', () => {
    expect(paletteGroups(SOURCES, parsePaletteInput('zzzz'))).toEqual([]);
  });

  it('matches an action on its keywords, not just its label', () => {
    expect(labels(SOURCES, 'download')).toEqual([['Actions', 'Export a copy']]);
  });

  it('narrows to one source under a prefix', () => {
    expect(labels(SOURCES, '#dec')).toEqual([['In this document', 'Decisions']]);
    expect(labels(SOURCES, '>share')).toEqual([['Actions', 'Share']]);
  });

  it('lists a whole source under a bare prefix, uncapped', () => {
    expect(labels(SOURCES, '#')).toEqual([
      ['In this document', 'Decisions', 'Open questions'],
    ]);
  });

  it('offers inserts only under their prefix', () => {
    expect(labels(SOURCES, '/')).toEqual([['Insert', 'Table', 'Quote']]);
    expect(labels(SOURCES, 'Table').flat()).not.toContain('Table');
  });

  it('ignores case on both sides of the match', () => {
    expect(labels(SOURCES, 'DECISIONS')[0]).toContain('Decisions');
  });

  it('identifies a heading row by position, so duplicate titles stay distinct', () => {
    const twins = [headingOf(2, 'Notes', 4), headingOf(2, 'Notes', 90)];
    const [group] = paletteGroups({ ...SOURCES, headings: twins }, parsePaletteInput('#notes'));
    expect(group.items.map((i) => i.id)).toEqual(['heading:4', 'heading:90']);
  });

  it('round-trips a row id back into what picking it means', () => {
    const [inDoc, yours] = paletteGroups(SOURCES, parsePaletteInput(''));
    expect(parsePaletteItemId(inDoc.items[0].id)).toEqual({ kind: 'heading', pos: 0 });
    expect(parsePaletteItemId(yours.items[0].id)).toEqual({ kind: 'room', room: 'r1' });
  });

  it('survives every source being empty', () => {
    const empty: PaletteSources = { headings: [], actions: [], rooms: [], inserts: [] };
    expect(paletteGroups(empty, parsePaletteInput(''))).toEqual([]);
    expect(paletteGroups(empty, parsePaletteInput('x'))).toEqual([]);
  });
});
