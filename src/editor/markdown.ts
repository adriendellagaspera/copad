import type { Node as PMNode, Mark } from 'prosemirror-model';
import { schema, nodeNameOf, markNameOf, type MarkName } from './schema.js';
import { headingLevel, linkHref, taskItemChecked } from './parse.js';
import { richTableToHtml } from '../format/tableMarkdown.js';

/** Serialize inline content (text + marks) of a textblock to Markdown.
 *  `hardBreak` is the text a `hard_break` node becomes — the standard
 *  trailing-two-spaces convention by default, overridden to `<br>` for GFM
 *  table cells (see the `table` case below), since a real newline can't
 *  appear inside a single-line pipe-table row. */
export function serializeInline(node: PMNode, hardBreak = '  \n'): string {
  let out = '';
  node.forEach((child) => {
    if (!child.isText) {
      if (child.type === schema.nodes.hard_break) out += hardBreak;
      return;
    }
    let text = child.text ?? '';
    const marks = child.marks;
    const has = (name: MarkName): Mark | undefined => marks.find((m) => markNameOf(m) === name);
    const link = has('link');
    if (has('code')) {
      text = `\`${text}\``;
    } else {
      if (has('strong')) text = `**${text}**`;
      if (has('em')) text = `*${text}*`;
      if (has('strike')) text = `~~${text}~~`;
      // No `has('underline')` branch, deliberately: Markdown has no native
      // underline syntax (same as the real Codec in format/markdown.ts), so
      // underlined text is copied as plain text.
    }
    if (link) { const href = linkHref(link); if (href) text = `[${text}](${href})`; }
    out += text;
  });
  return out;
}

/** A cell counts as "simple" — expressible as one line of a GFM pipe-table
 *  row — only when its sole child is a single plain paragraph (no lists,
 *  headings, quotes, code blocks, dividers, or multiple paragraphs). */
function isSimpleCell(cell: PMNode): boolean {
  return cell.childCount === 1 && nodeNameOf(cell.firstChild!) === 'paragraph';
}

/** How a table renders to Markdown, decided once per table rather than
 *  re-derived at each caller: every cell simple → the GFM pipe-table lines
 *  themselves; anything richer → `'rich'`, leaving the actual rendering
 *  (embedded HTML, or a no-DOM plain-text degrade) to the caller, since that
 *  choice depends on the environment, not the table's own shape. Shared with
 *  the lossless round-trip `Codec` in `format/markdown.ts`, so the simple/
 *  rich decision lives in exactly one place. */
export type TableRender = { kind: 'simple'; lines: string[] } | { kind: 'rich' };

export function classifyTable(table: PMNode): TableRender {
  let simple = true;
  table.forEach((row) => row.forEach((cell) => {
    if (!isSimpleCell(cell)) simple = false;
  }));
  return simple ? { kind: 'simple', lines: simpleTableToMarkdownLines(table) } : { kind: 'rich' };
}

/** GFM pipe-table lines for a table whose every cell is simple (see
 *  {@link classifyTable}). Reads each cell's sole paragraph directly
 *  (`cell.firstChild`) rather than the cell itself, since every cell wraps
 *  its content in a paragraph (`cellContent: 'block+'`, see schema.ts) even
 *  in the simple case. */
function simpleTableToMarkdownLines(table: PMNode): string[] {
  const rows: string[][] = [];
  table.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => {
      const para = cell.firstChild;
      cells.push(para ? serializeInline(para, '<br>').replace(/\|/g, '\\|').trim() : '');
    });
    rows.push(cells);
  });
  const colCount = rows[0]?.length ?? 0;
  return [
    `| ${(rows[0] ?? []).join(' | ')} |`,
    `| ${Array(colCount).fill('---').join(' | ')} |`,
    ...rows.slice(1).map((cells) => `| ${cells.join(' | ')} |`),
  ];
}

function serializeBlock(node: PMNode, indent = ''): string {
  const t = nodeNameOf(node);
  switch (t) {
    case 'paragraph':
      return indent + serializeInline(node);
    case 'heading':
      return `${'#'.repeat(headingLevel(node))} ${serializeInline(node)}`;
    case 'blockquote':
      return serializeChildren(node, indent)
        .split('\n')
        .map((l) => `> ${l}`.trimEnd())
        .join('\n');
    case 'code_block':
      return '```\n' + (node.textContent ?? '') + '\n```';
    case 'horizontal_rule':
      return '---';
    case 'bullet_list':
    case 'ordered_list': {
      const ordered = t === 'ordered_list';
      const lines: string[] = [];
      let i = 1;
      node.forEach((item) => {
        const marker = ordered ? `${i}. ` : '- ';
        const body = serializeChildren(item, indent + ' '.repeat(marker.length)).trimEnd();
        const [first, ...rest] = body.split('\n');
        lines.push(indent + marker + first.trimStart());
        rest.forEach((l) => lines.push(l));
        i += 1;
      });
      return lines.join('\n');
    }
    case 'task_list': {
      const lines: string[] = [];
      node.forEach((item) => {
        const marker = `- [${taskItemChecked(item) ? 'x' : ' '}] `;
        const body = serializeChildren(item, indent + ' '.repeat(marker.length)).trimEnd();
        const [first, ...rest] = body.split('\n');
        lines.push(indent + marker + first.trimStart());
        rest.forEach((l) => lines.push(l));
      });
      return lines.join('\n');
    }
    case 'table': {
      // Rich (multi-block) cell content has no GFM pipe-table equivalent —
      // fall back to an embedded raw HTML block, same as the lossless
      // round-trip Codec (format/markdown.ts) does, and safe to call
      // unconditionally here since this function only ever runs in the
      // browser (the "Copy as Markdown" toolbar button).
      const render = classifyTable(node);
      return render.kind === 'simple' ? render.lines.join('\n') : richTableToHtml(node);
    }
    default:
      return serializeInline(node);
  }
}

function serializeChildren(node: PMNode, indent = ''): string {
  const blocks: string[] = [];
  node.forEach((child) => blocks.push(serializeBlock(child, indent)));
  return blocks.join('\n\n');
}

/** Serialize the whole document to Markdown. */
export function docToMarkdown(doc: PMNode): string {
  return serializeChildren(doc).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
