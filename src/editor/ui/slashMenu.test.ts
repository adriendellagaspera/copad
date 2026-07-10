// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { tableNodeTypes } from 'prosemirror-tables';
import { schema } from '../schema.js';
import { filterItems, menuItems, SLASH_ITEMS, slashMenuPlugin, slashKey } from './slashMenu.js';

describe('slash menu filtering', () => {
  it('returns every item for an empty query', () => {
    expect(filterItems('')).toHaveLength(SLASH_ITEMS.length);
    expect(filterItems('   ')).toHaveLength(SLASH_ITEMS.length);
  });

  it('matches on title (case-insensitive)', () => {
    const r = filterItems('HEAD');
    expect(r.length).toBe(3);
    expect(r.every((i) => i.title.startsWith('Heading'))).toBe(true);
  });

  it('matches on keywords, not just the title', () => {
    expect(filterItems('divider').map((i) => i.title)).toContain('Divider');
    expect(filterItems('hr').map((i) => i.title)).toContain('Divider');
    expect(filterItems('unordered').map((i) => i.title)).toContain('Bulleted list');
    expect(filterItems('todo').map((i) => i.title)).toContain('Checklist');
    expect(filterItems('grid').map((i) => i.title)).toContain('Table');
  });

  it('returns nothing for a non-matching query', () => {
    expect(filterItems('zzzz')).toHaveLength(0);
  });
});

describe('slash menu applicability (menuItems)', () => {
  function paragraphState(): EditorState {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('hi'))]);
    return EditorState.create({ schema, doc, selection: TextSelection.create(doc, 1) });
  }

  function inTableCellState(): EditorState {
    const t = tableNodeTypes(schema);
    const cell = () => t.cell.createAndFill()!;
    const row = () => t.row.create(null, [cell(), cell()]);
    const table = t.table.create(null, [row(), row()]);
    const doc = schema.node('doc', null, [table]);
    // +3: into the table, into the first row, into the first cell's paragraph.
    return EditorState.create({ schema, doc, selection: TextSelection.near(doc.resolve(3)) });
  }

  it('offers Table in a plain paragraph', () => {
    expect(menuItems(paragraphState(), 'table').map((i) => i.title)).toContain('Table');
  });

  it('drops Table when the caret is already inside a table (no nesting)', () => {
    const items = menuItems(inTableCellState(), 'table').map((i) => i.title);
    expect(items).not.toContain('Table');
    // A query with no applicable match yields an empty menu rather than one
    // that deletes the trigger and inserts nothing.
    expect(items).toHaveLength(0);
  });

  it('still offers block types that DO apply inside a cell (e.g. Heading)', () => {
    expect(menuItems(inTableCellState(), 'heading').map((i) => i.title)).toContain('Heading 1');
  });
});

describe('slash menu Escape handling', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function mountView(): EditorView {
    const state = EditorState.create({ schema, plugins: [slashMenuPlugin()] });
    const dom = document.createElement('div');
    document.body.appendChild(dom);
    const view = new EditorView(dom, {
      state,
      dispatchTransaction(tr) {
        view.updateState(view.state.apply(tr));
      },
    });
    return view;
  }

  it('closes the menu and re-asserts focus if Escape is followed by an async blur', () => {
    vi.useFakeTimers();
    const view = mountView();
    view.dispatch(view.state.tr.insertText('/foo'));
    expect(slashKey.getState(view.state)?.active).toBe(true);

    const focusSpy = vi.spyOn(view, 'focus');
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    view.dom.dispatchEvent(event);

    // The menu closes immediately regardless of what focus does afterward.
    expect(slashKey.getState(view.state)?.active).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(focusSpy).toHaveBeenCalledTimes(1);

    // Simulate Firefox asynchronously blurring the contenteditable right
    // after the Escape keydown, despite its default action being prevented.
    view.dom.dispatchEvent(new FocusEvent('blur'));

    vi.runAllTimers();
    expect(focusSpy).toHaveBeenCalledTimes(2);
  });
});
