import type { Node as PMNode, Mark } from 'prosemirror-model';
import { schema } from './schema.js';
import { headingLevel, linkHref, taskItemChecked } from './parse.js';

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
    const has = (name: string): Mark | undefined => marks.find((m) => m.type.name === name);
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
      const rows: string[][] = [];
      node.forEach((row) => {
        const cells: string[] = [];
        row.forEach((cell) => cells.push(serializeInline(cell, '<br>').replace(/\|/g, '\\|').trim()));
        rows.push(cells);
      });
      const colCount = rows[0]?.length ?? 0;
      return [
        `| ${(rows[0] ?? []).join(' | ')} |`,
        `| ${Array(colCount).fill('---').join(' | ')} |`,
        ...rows.slice(1).map((cells) => `| ${cells.join(' | ')} |`),
      ].join('\n');
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
