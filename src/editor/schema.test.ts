import { describe, it, expect } from 'vitest';
import { schema } from './schema.js';
import { EditorState } from 'prosemirror-state';

describe('schema', () => {
  it('has all required marks', () => {
    expect(schema.marks.strong).toBeDefined();
    expect(schema.marks.em).toBeDefined();
    expect(schema.marks.code).toBeDefined();
    expect(schema.marks.strike).toBeDefined();
    expect(schema.marks.underline).toBeDefined();
  });

  it('every mark is non-inclusive, so typing after a closed mark exits it instead of continuing inside', () => {
    // prosemirror-schema-basic's strong/em/code default to inclusive: true;
    // link already ships inclusive: false. Every mark here must match link's
    // behaviour (CommonMark/Word/Docs/Notion: closing a mark always exits
    // it) — otherwise typing right after e.g. `**bold**` or `` `code` ``
    // silently continues inside the mark.
    for (const name of ['strong', 'em', 'code', 'strike', 'underline', 'link']) {
      expect(schema.marks[name].spec.inclusive, `${name}.spec.inclusive`).toBe(false);
    }
  });

  it('has all required nodes', () => {
    expect(schema.nodes.paragraph).toBeDefined();
    expect(schema.nodes.heading).toBeDefined();
    expect(schema.nodes.blockquote).toBeDefined();
    expect(schema.nodes.bullet_list).toBeDefined();
    expect(schema.nodes.ordered_list).toBeDefined();
    expect(schema.nodes.list_item).toBeDefined();
    expect(schema.nodes.code_block).toBeDefined();
    expect(schema.nodes.task_list).toBeDefined();
    expect(schema.nodes.task_item).toBeDefined();
    expect(schema.nodes.table).toBeDefined();
    expect(schema.nodes.table_row).toBeDefined();
    expect(schema.nodes.table_cell).toBeDefined();
    expect(schema.nodes.table_header).toBeDefined();
  });

  it('can create a paragraph with text', () => {
    const node = schema.nodes.paragraph.create({}, schema.text('hello'));
    expect(node.textContent).toBe('hello');
  });

  it('can create heading nodes at levels 1 and 2', () => {
    const h1 = schema.nodes.heading.create({ level: 1 }, schema.text('Title'));
    const h2 = schema.nodes.heading.create({ level: 2 }, schema.text('Sub'));
    expect(h1.attrs.level).toBe(1);
    expect(h2.attrs.level).toBe(2);
  });

  it('round-trips a heading through JSON', () => {
    const node = schema.nodes.heading.create({ level: 1 }, schema.text('Title'));
    const restored = schema.nodeFromJSON(node.toJSON());
    expect(restored.textContent).toBe('Title');
    expect(restored.attrs.level).toBe(1);
  });

  it('creates an editor state with the schema without throwing', () => {
    const state = EditorState.create({ schema });
    expect(state.doc.type).toBe(schema.nodes.doc);
  });

  it('strike mark toDOM returns <s> element spec', () => {
    const strike = schema.marks.strike;
    const mark = strike.create();
    const spec = strike.spec.toDOM!(mark, false);
    expect(spec).toEqual(['s', 0]);
  });

  it('underline mark toDOM returns <u> element spec', () => {
    const underline = schema.marks.underline;
    const mark = underline.create();
    const spec = underline.spec.toDOM!(mark, false);
    expect(spec).toEqual(['u', 0]);
  });

  it('creates an unchecked task_item by default', () => {
    const item = schema.nodes.task_item.create(null, schema.nodes.paragraph.create());
    expect(item.attrs.checked).toBe(false);
  });

  it('creates a checked task_item when given the attr', () => {
    const item = schema.nodes.task_item.create({ checked: true }, schema.nodes.paragraph.create());
    expect(item.attrs.checked).toBe(true);
  });

  it('task_list requires at least one task_item', () => {
    const list = schema.nodes.task_list.create(
      null,
      schema.nodes.task_item.create(null, schema.nodes.paragraph.create())
    );
    expect(list.childCount).toBe(1);
    expect(list.firstChild?.type.name).toBe('task_item');
  });

  it('creates a table with a header row and a body row', () => {
    const { table, table_row, table_cell, table_header } = schema.nodes;
    const doc = table.create(null, [
      table_row.create(null, [table_header.create(), table_header.create()]),
      table_row.create(null, [table_cell.create(), table_cell.create()]),
    ]);
    expect(doc.childCount).toBe(2);
    expect(doc.firstChild?.child(0).type.name).toBe('table_header');
    expect(doc.child(1).child(0).type.name).toBe('table_cell');
  });

  // `table` moved to its own `tableBlock` group (kept out of cellContent, so
  // tables can't nest inside cells) — every non-cell content expression that
  // used to draw from the plain `block` group must still admit it, or this
  // silently regresses which containers a table can live in.
  it('allows a table nested inside a blockquote', () => {
    const { blockquote, table, table_row, table_cell, paragraph } = schema.nodes;
    const t = table.create(null, table_row.create(null, table_cell.create(null, paragraph.create())));
    expect(() => blockquote.createChecked(null, t)).not.toThrow();
  });

  it('allows a table nested inside a list item', () => {
    const { list_item, table, table_row, table_cell, paragraph } = schema.nodes;
    const t = table.create(null, table_row.create(null, table_cell.create(null, paragraph.create())));
    expect(() => list_item.createChecked(null, [paragraph.create(), t])).not.toThrow();
  });

  it('allows a table nested inside a task item', () => {
    const { task_item, table, table_row, table_cell, paragraph } = schema.nodes;
    const t = table.create(null, table_row.create(null, table_cell.create(null, paragraph.create())));
    expect(() => task_item.createChecked(null, [paragraph.create(), t])).not.toThrow();
  });
});
