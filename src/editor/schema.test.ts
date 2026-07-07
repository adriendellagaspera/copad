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

  it('creates a checked and unchecked task_item', () => {
    const unchecked = schema.nodes.task_item.create({}, schema.nodes.paragraph.create());
    const checked = schema.nodes.task_item.create({ checked: true }, schema.nodes.paragraph.create());
    expect(unchecked.attrs.checked).toBe(false);
    expect(checked.attrs.checked).toBe(true);
  });

  it('creates a table with a header row and body cells', () => {
    const header = schema.nodes.table_header.create();
    const cell = schema.nodes.table_cell.create();
    const table = schema.nodes.table.create(null, [
      schema.nodes.table_row.create(null, [header, header]),
      schema.nodes.table_row.create(null, [cell, cell]),
    ]);
    expect(table.childCount).toBe(2);
    expect(table.child(0).child(0).type.name).toBe('table_header');
    expect(table.child(1).child(0).type.name).toBe('table_cell');
  });
});
