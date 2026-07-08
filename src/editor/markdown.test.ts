import { describe, it, expect } from 'vitest';
import { schema } from './schema.js';
import { docToMarkdown } from './markdown.js';
import type { Node as PMNode } from 'prosemirror-model';

const md = (...blocks: PMNode[]): string => docToMarkdown(schema.node('doc', null, blocks));
const para = (content: PMNode | PMNode[]) => schema.node('paragraph', null, content);

describe('docToMarkdown', () => {
  it('serializes headings with the right level', () => {
    expect(md(schema.node('heading', { level: 1 }, schema.text('Title')))).toContain('# Title');
    expect(md(schema.node('heading', { level: 3 }, schema.text('Sub')))).toContain('### Sub');
  });

  it('serializes inline marks', () => {
    expect(md(para(schema.text('x', [schema.marks.strong.create()])))).toContain('**x**');
    expect(md(para(schema.text('x', [schema.marks.em.create()])))).toContain('*x*');
    expect(md(para(schema.text('x', [schema.marks.code.create()])))).toContain('`x`');
    expect(md(para(schema.text('x', [schema.marks.strike.create()])))).toContain('~~x~~');
  });

  it('serializes links', () => {
    const link = schema.marks.link.create({ href: 'https://e.com' });
    expect(md(para(schema.text('site', [link])))).toContain('[site](https://e.com)');
  });

  it('serializes a bullet list', () => {
    const list = schema.node('bullet_list', null, [
      schema.node('list_item', null, [para(schema.text('one'))]),
      schema.node('list_item', null, [para(schema.text('two'))]),
    ]);
    const out = md(list);
    expect(out).toContain('- one');
    expect(out).toContain('- two');
  });

  it('serializes code blocks and horizontal rules', () => {
    expect(md(schema.node('code_block', null, schema.text('let x = 1')))).toContain('```');
    expect(md(schema.node('code_block', null, schema.text('let x = 1')))).toContain('let x = 1');
    expect(md(schema.node('horizontal_rule'))).toContain('---');
  });

  it('flattens underline to plain text (no Markdown syntax for it)', () => {
    const out = md(para(schema.text('under', [schema.marks.underline.create()])));
    expect(out).toContain('under');
    expect(out).not.toMatch(/<\/?u>/);
  });

  it('keeps a link when the linked text is also underlined', () => {
    const link = schema.marks.link.create({ href: 'https://e.com' });
    const underline = schema.marks.underline.create();
    const out = md(para(schema.text('site', [link, underline])));
    expect(out).toContain('[site](https://e.com)');
  });

  it('serializes a checklist with checked and unchecked items', () => {
    const list = schema.node('task_list', null, [
      schema.node('task_item', { checked: true }, [para(schema.text('done'))]),
      schema.node('task_item', { checked: false }, [para(schema.text('todo'))]),
    ]);
    const out = md(list);
    expect(out).toContain('- [x] done');
    expect(out).toContain('- [ ] todo');
  });

  it('serializes a table as a GFM pipe table', () => {
    const { table, table_row, table_cell, table_header } = schema.nodes;
    const t = table.create(null, [
      table_row.create(null, [table_header.create(null, schema.text('A')), table_header.create(null, schema.text('B'))]),
      table_row.create(null, [table_cell.create(null, schema.text('1')), table_cell.create(null, schema.text('2'))]),
    ]);
    const out = md(t);
    expect(out).toContain('| A | B |');
    expect(out).toContain('| --- | --- |');
    expect(out).toContain('| 1 | 2 |');
  });

  it('serializes a hard break inside a table cell as literal <br>, not a real newline', () => {
    const { table, table_row, table_cell, hard_break } = schema.nodes;
    const t = table.create(null, [
      table_row.create(null, [
        table_cell.create(null, [schema.text('one'), hard_break.create(), schema.text('two')]),
      ]),
    ]);
    const out = md(t);
    expect(out).toContain('one<br>two');
    // The whole row must stay on a single line — a real newline would break
    // the pipe-table syntax.
    expect(out.split('\n').some((l) => l.includes('one') && l.includes('two'))).toBe(true);
  });

  it('serializes a hard break in a plain paragraph as trailing-two-spaces (unchanged outside tables)', () => {
    const { hard_break } = schema.nodes;
    const out = md(para([schema.text('one'), hard_break.create(), schema.text('two')]));
    expect(out).toContain('one  \ntwo');
  });
});
