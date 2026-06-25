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
});
