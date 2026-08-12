import type { Node as PMNode, Mark } from 'prosemirror-model';
import { schema } from './schema.js';
import { headingLevel, linkHref, taskItemChecked } from './parse.js';
import { richTableToHtml } from '../format/tableMarkdown.js';

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
    const has = (name: string): Mark | undefined => marks.find((m) => m.type.name === name);
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
  return cell.childCount === 1 && cell.firstChild!.type.name === 'paragraph';
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
  const t = node.type.name;
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
      // richTableToHtml needs a DOM; safe here, this path only runs in the browser.
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

export function docToMarkdown(doc: PMNode): string {
  return serializeChildren(doc).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
