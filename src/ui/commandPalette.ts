import type { RoomId } from '../collaboration/types.js';
import type { DocHeading, DocPos } from '../editor/ui/outline.js';

/** What the user typed, prefix stripped. */
export type PaletteQuery = string & { readonly _brand: 'PaletteQuery' };

/** Identifies a row so the component can resolve it back to an action. */
export type PaletteItemId = string & { readonly _brand: 'PaletteItemId' };

/** A row's primary text. */
export type PaletteItemLabel = string & { readonly _brand: 'PaletteItemLabel' };

/** A row's secondary text — heading level, when a room was last opened. */
export type PaletteItemHint = string & { readonly _brand: 'PaletteItemHint' };

/** Extra words a row matches on beyond its label. */
export type PaletteItemKeywords = string & { readonly _brand: 'PaletteItemKeywords' };

/** A group's heading in the result list. */
export type PaletteGroupLabel = string & { readonly _brand: 'PaletteGroupLabel' };

/** A code-facing name for a row, distinct from the user-facing {@link PaletteItemLabel}. */
export type PaletteItemName = string & { readonly _brand: 'PaletteItemName' };

/** The one cast site for {@link PaletteItemName} — names are defined in source
 *  (an action's identity, a slash item's title), never parsed from user input. */
export const paletteItemName = (raw: string): PaletteItemName => raw as PaletteItemName;

/** Which sources a query searches — narrowed by a leading `#`, `>` or `/`. */
export type PaletteScope =
  | { readonly kind: 'everything' }
  | { readonly kind: 'headings' }
  | { readonly kind: 'actions' }
  | { readonly kind: 'insert' };

export interface PaletteInput {
  readonly scope: PaletteScope;
  readonly query: PaletteQuery;
}

export interface PaletteAction {
  readonly id: PaletteItemId;
  readonly label: PaletteItemLabel;
  readonly keywords: PaletteItemKeywords;
  readonly hint?: PaletteItemHint;
}

/** A block the `/` scope can insert. Carries no command — the component resolves `id`. */
export interface PaletteInsert {
  readonly id: PaletteItemId;
  readonly label: PaletteItemLabel;
  readonly keywords: PaletteItemKeywords;
  readonly hint?: PaletteItemHint;
}

/** A remembered room, already labelled by the caller — `openedLabel` needs a clock. */
export interface PaletteRoom {
  readonly room: RoomId;
  readonly label: PaletteItemLabel;
  readonly hint?: PaletteItemHint;
}

export interface PaletteSources {
  readonly headings: readonly DocHeading[];
  readonly actions: readonly PaletteAction[];
  readonly rooms: readonly PaletteRoom[];
  readonly inserts: readonly PaletteInsert[];
}

export interface PaletteItem {
  readonly id: PaletteItemId;
  readonly label: PaletteItemLabel;
  readonly hint?: PaletteItemHint;
}

export interface PaletteGroup {
  readonly label: PaletteGroupLabel;
  readonly items: readonly PaletteItem[];
}

/** What picking a row means. The component resolves this, never a raw string. */
export type PaletteTarget =
  | { readonly kind: 'heading'; readonly pos: DocPos }
  | { readonly kind: 'insert'; readonly name: PaletteItemName }
  | { readonly kind: 'room'; readonly room: RoomId }
  | { readonly kind: 'action'; readonly name: PaletteItemName };

export const headingItemId = (pos: DocPos): PaletteItemId => `heading:${pos}` as PaletteItemId;
export const roomItemId = (room: RoomId): PaletteItemId => `room:${room}` as PaletteItemId;
export const insertItemId = (name: PaletteItemName): PaletteItemId => `insert:${name}` as PaletteItemId;
export const actionItemId = (name: PaletteItemName): PaletteItemId => `action:${name}` as PaletteItemId;

/**
 * The other half of the id constructors above — a row's id back into what it
 * means. An unrecognised id reads as an action, which is the arm whose
 * handler is a lookup that can miss harmlessly rather than a document write.
 */
export function parsePaletteItemId(id: PaletteItemId): PaletteTarget {
  const cut = id.indexOf(':');
  const rest = id.slice(cut + 1);
  switch (id.slice(0, cut)) {
    case 'heading': {
      const pos = Number(rest);
      if (Number.isInteger(pos) && pos >= 0) return { kind: 'heading', pos: pos as DocPos };
      break;
    }
    case 'insert':
      return { kind: 'insert', name: rest as PaletteItemName };
    case 'room':
      return { kind: 'room', room: rest as RoomId };
  }
  return { kind: 'action', name: rest as PaletteItemName };
}

const IN_DOCUMENT = 'In this document' as PaletteGroupLabel;
const ACTIONS = 'Actions' as PaletteGroupLabel;
const YOUR_DOCUMENTS = 'Your documents' as PaletteGroupLabel;
const INSERT = 'Insert' as PaletteGroupLabel;

/** How many rows each source contributes to the resting panel, before any query. */
const RESTING_ROWS = 5;

const PREFIXES: ReadonlyMap<string, PaletteScope> = new Map([
  ['#', { kind: 'headings' }],
  ['>', { kind: 'actions' }],
  ['/', { kind: 'insert' }],
]);

/**
 * The single parse of raw palette input into a scope and a query — the one
 * cast site for {@link PaletteQuery}. A bare prefix is a scope with an empty
 * query, which is how "show me every heading" is expressed.
 */
export function parsePaletteInput(raw: string): PaletteInput {
  const trimmed = raw.trimStart();
  const scope = PREFIXES.get(trimmed.slice(0, 1));
  if (!scope) return { scope: { kind: 'everything' }, query: raw.trim() as PaletteQuery };
  return { scope, query: trimmed.slice(1).trim() as PaletteQuery };
}

function matches(query: PaletteQuery, label: string, keywords: string): boolean {
  const q = query.toLowerCase();
  if (!q) return true;
  return label.toLowerCase().includes(q) || keywords.toLowerCase().includes(q);
}

function headingItems(headings: readonly DocHeading[], query: PaletteQuery): PaletteItem[] {
  return headings
    .filter((h) => matches(query, h.text, ''))
    .map((h) => ({
      id: headingItemId(h.pos),
      label: h.text as string as PaletteItemLabel,
      hint: `Heading ${h.level}` as PaletteItemHint,
    }));
}

function named(
  entries: readonly (PaletteAction | PaletteInsert)[],
  query: PaletteQuery,
): PaletteItem[] {
  return entries
    .filter((e) => matches(query, e.label, e.keywords))
    .map(({ id, label, hint }) => ({ id, label, hint }));
}

function roomItems(rooms: readonly PaletteRoom[], query: PaletteQuery): PaletteItem[] {
  return rooms
    .filter((r) => matches(query, r.label, r.room))
    .map((r) => ({ id: roomItemId(r.room), label: r.label, hint: r.hint }));
}

function nonEmpty(groups: readonly PaletteGroup[]): PaletteGroup[] {
  return groups.filter((g) => g.items.length > 0);
}

/**
 * The grouped result list for `input`. Empty groups are dropped, so an empty
 * array means "no matches" and the component can say so rather than drawing
 * headings over nothing.
 *
 * With no query the panel rests on the most recent rooms and the document's
 * first headings — it is never blank on open. Inserts are reachable only
 * through their `/` prefix: in `everything` scope they would double the list
 * with commands the editor's own slash menu already offers at the caret, where
 * they can be applied.
 */
export function paletteGroups(sources: PaletteSources, input: PaletteInput): PaletteGroup[] {
  const { scope, query } = input;

  if (scope.kind === 'headings') {
    return nonEmpty([{ label: IN_DOCUMENT, items: headingItems(sources.headings, query) }]);
  }
  if (scope.kind === 'actions') {
    return nonEmpty([{ label: ACTIONS, items: named(sources.actions, query) }]);
  }
  if (scope.kind === 'insert') {
    return nonEmpty([{ label: INSERT, items: named(sources.inserts, query) }]);
  }

  if (!query) {
    return nonEmpty([
      { label: IN_DOCUMENT, items: headingItems(sources.headings, query).slice(0, RESTING_ROWS) },
      { label: YOUR_DOCUMENTS, items: roomItems(sources.rooms, query).slice(0, RESTING_ROWS) },
    ]);
  }

  return nonEmpty([
    { label: IN_DOCUMENT, items: headingItems(sources.headings, query) },
    { label: ACTIONS, items: named(sources.actions, query) },
    { label: YOUR_DOCUMENTS, items: roomItems(sources.rooms, query) },
  ]);
}
