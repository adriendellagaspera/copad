import type { Node as PMNode, Mark } from 'prosemirror-model';
import { schema, nodeNameOf, markNameOf, type MarkName } from './schema.js';
import { headingLevel, linkHref, taskItemChecked } from './parse.js';
import { richTableToHtml, tableToPipeTableLines } from '../format/tableMarkdown.js';

// `hardBreak` is overridden to `<br>` for GFM cells: a pipe-table row is one line.
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
      // No underline branch: Markdown has no underline syntax, so it copies as plain text.
    }
    if (link) { const href = linkHref(link); if (href) text = `[${text}](${href})`; }
    out += text;
  });
  return out;
}

function isSimpleCell(cell: PMNode): boolean {
  return cell.childCount === 1 && nodeNameOf(cell.firstChild!) === 'paragraph';
}

export type TableRender = { kind: 'simple'; lines: string[] } | { kind: 'rich' };

export function classifyTable(table: PMNode): TableRender {
  let simple = true;
  table.forEach((row) => row.forEach((cell) => {
    if (!isSimpleCell(cell)) simple = false;
  }));
  return simple ? { kind: 'simple', lines: simpleTableToMarkdownLines(table) } : { kind: 'rich' };
}

function simpleTableToMarkdownLines(table: PMNode): string[] {
  return tableToPipeTableLines(table, (cell) => {
    const para = cell.firstChild;
    return para ? serializeInline(para, '<br>').replace(/\|/g, '\\|').trim() : '';
  });
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
      let i = 1;
      return serializeListItems(node, indent, () => (ordered ? `${i++}. ` : '- '));
    }
    case 'task_list':
      return serializeListItems(node, indent, (item) => `- [${taskItemChecked(item) ? 'x' : ' '}] `);
    case 'table': {
      // richTableToHtml needs a DOM; safe here, this path only runs in the browser.
      const render = classifyTable(node);
      return render.kind === 'simple' ? render.lines.join('\n') : richTableToHtml(node);
    }
    default:
      return serializeInline(node);
  }
}

/** Shared body for `bullet_list`/`ordered_list`/`task_list`: one line per
 *  item, indented to align continuation lines under the marker `marker(item)`
 *  produces for that item. */
function serializeListItems(list: PMNode, indent: string, marker: (item: PMNode) => string): string {
  const lines: string[] = [];
  list.forEach((item) => {
    const m = marker(item);
    const body = serializeChildren(item, indent + ' '.repeat(m.length)).trimEnd();
    const [first, ...rest] = body.split('\n');
    lines.push(indent + m + first.trimStart());
    rest.forEach((l) => lines.push(l));
  });
  return lines.join('\n');
}

function serializeChildren(node: PMNode, indent = ''): string {
  const blocks: string[] = [];
  node.forEach((child) => blocks.push(serializeBlock(child, indent)));
  return blocks.join('\n\n');
}

export function docToMarkdown(doc: PMNode): string {
  return serializeChildren(doc).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
