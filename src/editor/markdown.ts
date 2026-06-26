import type { Node as PMNode, Mark } from 'prosemirror-model';
import { schema } from './schema.js';
import { headingLevel, linkHref } from './parse.js';

/** Serialize inline content (text + marks) of a textblock to Markdown. */
function serializeInline(node: PMNode): string {
  let out = '';
  node.forEach((child) => {
    if (!child.isText) {
      if (child.type === schema.nodes.hard_break) out += '  \n';
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
