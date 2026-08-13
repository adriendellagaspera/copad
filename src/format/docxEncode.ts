import type * as Y from 'yjs';
import type { Node as PMNode } from 'prosemirror-model';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ExternalHyperlink,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  LevelFormat,
  BorderStyle,
  WidthType,
  convertInchesToTwip,
  type IRunStylePropertiesOptions,
  type IParagraphPropertiesOptions,
  type ITableWidthProperties,
  type ParagraphChild,
} from 'docx';
import { readPmDoc } from './pm.js';
import { headingLevel, linkHref, taskItemChecked } from '../editor/parse.js';
import { nodeNameOf, markNameOf } from '../editor/schema.js';

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6,
];
const MAX_LIST_LEVEL = 5; // docx numbering levels are 0-indexed; we define 6 (0-5)
const ORDERED_REF = 'copad-ordered';
const LIST_INDENT_IN = 0.25;

// The docx package leaves body text at OOXML's bare-spec fallback (10pt, no named font) when docDefaults is empty — illegibly small next to the editor's own reading font.
const BODY_FONT = 'Georgia';
const BODY_SIZE_HALF_PT = 24; // 12pt

// Cycles decimal -> lowerLetter -> lowerRoman, matching Word's own default multi-level list style.
function orderedFormat(level: number): (typeof LevelFormat)[keyof typeof LevelFormat] {
  return [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3]!;
}

function orderedNumberingConfig() {
  return {
    reference: ORDERED_REF,
    levels: Array.from({ length: MAX_LIST_LEVEL + 1 }, (_, level) => ({
      level,
      format: orderedFormat(level),
      text: `%${level + 1}.`,
      style: {
        paragraph: {
          indent: { left: convertInchesToTwip(LIST_INDENT_IN * (level + 1)), hanging: convertInchesToTwip(0.25) },
        },
      },
    })),
  };
}

function runStyleOf(node: PMNode): { style: IRunStylePropertiesOptions; href: string | null } {
  const style: { bold?: boolean; italics?: boolean; strike?: boolean; underline?: object; font?: string } = {};
  let href: string | null = null;
  node.marks.forEach((mark) => {
    switch (markNameOf(mark)) {
      case 'strong': style.bold = true; break;
      case 'em': style.italics = true; break;
      case 'strike': style.strike = true; break;
      case 'underline': style.underline = {}; break;
      case 'code': style.font = 'Consolas'; break;
      case 'link': href = linkHref(mark); break;
    }
  });
  return { style, href };
}

function runsOf(inline: PMNode, forceStyle: IRunStylePropertiesOptions = {}): ParagraphChild[] {
  const runs: ParagraphChild[] = [];
  inline.forEach((child) => {
    if (nodeNameOf(child) === 'hard_break') {
      runs.push(new TextRun({ break: 1 }));
      return;
    }
    if (!child.isText) return;
    const { style, href } = runStyleOf(child);
    const run = new TextRun({ text: child.text ?? '', ...forceStyle, ...style });
    runs.push(href ? new ExternalHyperlink({ children: [run], link: href }) : run);
  });
  return runs;
}

type Block = Paragraph | Table;
// Shared across one whole encode() call, never re-created per recursive blocksOf call — otherwise two unrelated root lists could collide on the same instance number and render as one continuing list.
type OrderedCounter = { next: number };

function blocksOf(container: PMNode, counter: OrderedCounter, depth = -1, orderedInstance = 0): Block[] {
  const out: Block[] = [];
  container.forEach((node) => out.push(...blockOf(node, counter, depth, orderedInstance)));
  return out;
}

// depth is current list nesting (-1 outside any list); orderedInstance lets a root ordered list restart at 1 while a nested one shares its ancestor's numbering instance.
function blockOf(node: PMNode, counter: OrderedCounter, depth: number, orderedInstance: number): Block[] {
  switch (nodeNameOf(node)) {
    case 'paragraph':
      return [new Paragraph({ children: runsOf(node) })];

    case 'heading':
      return [new Paragraph({
        heading: HEADING_LEVELS[Math.min(Math.max(headingLevel(node), 1), 6) - 1],
        children: runsOf(node),
      })];

    case 'blockquote': {
      const out: Block[] = [];
      node.forEach((child) => {
        if (nodeNameOf(child) === 'paragraph') {
          const runs = runsOf(child);
          out.push(new Paragraph({
            children: runs.length ? runs : [new TextRun('')],
            indent: { left: convertInchesToTwip(0.5) },
            border: { left: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 8 } },
          }));
        } else {
          out.push(...blockOf(child, counter, depth, orderedInstance));
        }
      });
      return out;
    }

    case 'code_block': {
      const lines = node.textContent.split('\n');
      const children: ParagraphChild[] = [];
      lines.forEach((line, i) => {
        if (i > 0) children.push(new TextRun({ break: 1, font: 'Consolas' }));
        children.push(new TextRun({ text: line, font: 'Consolas' }));
      });
      return [new Paragraph({ children })];
    }

    case 'horizontal_rule':
      return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } } })];

    case 'bullet_list': {
      const level = Math.min(depth + 1, MAX_LIST_LEVEL);
      const out: Block[] = [];
      node.forEach((item) => out.push(...listItemOf(item, counter, { bullet: { level } }, level, orderedInstance)));
      return out;
    }

    case 'ordered_list': {
      const level = Math.min(depth + 1, MAX_LIST_LEVEL);
      const instance = depth === -1 ? counter.next++ : orderedInstance;
      const out: Block[] = [];
      node.forEach((item) =>
        out.push(...listItemOf(item, counter, { numbering: { reference: ORDERED_REF, level, instance } }, level, instance))
      );
      return out;
    }

    case 'task_list': {
      const out: Block[] = [];
      node.forEach((item) => {
        const glyph = taskItemChecked(item) ? '☑' : '☐';
        const firstPara = item.firstChild;
        const children: ParagraphChild[] = [new TextRun(`${glyph} `), ...(firstPara ? runsOf(firstPara) : [])];
        out.push(new Paragraph({ children, indent: { left: convertInchesToTwip(LIST_INDENT_IN * (depth + 2)) } }));
        item.forEach((child, _offset, i) => {
          if (i > 0) out.push(...blockOf(child, counter, depth + 1, orderedInstance));
        });
      });
      return out;
    }

    case 'table': {
      // Word/docx fall back to ~0-width columns when no width is given; every cell gets an explicit equal share of 100% instead.
      const colCount = node.firstChild?.childCount ?? 1;
      const colWidth: ITableWidthProperties = { size: `${100 / colCount}%`, type: WidthType.PERCENTAGE };
      const rows: TableRow[] = [];
      node.forEach((row) => {
        const cells: TableCell[] = [];
        row.forEach((cell) => {
          // A cell holds block+ content, not bare inline runs; anything richer than one paragraph falls through to the general block renderer so nothing is silently dropped.
          const isHeader = nodeNameOf(cell) === 'table_header';
          const onlyParagraph = cell.childCount === 1 && nodeNameOf(cell.firstChild!) === 'paragraph';
          const children: Block[] = onlyParagraph
            ? [new Paragraph({ children: runsOf(cell.firstChild!, isHeader ? { bold: true } : {}) })]
            : blocksOf(cell, counter);
          cells.push(new TableCell({ width: colWidth, children }));
        });
        rows.push(new TableRow({ children: cells }));
      });
      return [new Table({ rows, width: { size: '100%', type: WidthType.PERCENTAGE } })];
    }

    default:
      return [];
  }
}

function listItemOf(
  item: PMNode,
  counter: OrderedCounter,
  extra: IParagraphPropertiesOptions,
  level: number,
  orderedInstance: number,
): Block[] {
  const out: Block[] = [];
  item.forEach((child, _offset, i) => {
    if (i === 0 && nodeNameOf(child) === 'paragraph') {
      out.push(new Paragraph({ children: runsOf(child), ...extra }));
    } else {
      out.push(...blockOf(child, counter, level, orderedInstance));
    }
  });
  return out;
}

// Plain function, not an ExportCodec object (#181): docx.ts wraps this behind a dynamic import() so the ~100kB docx package only loads into a page that actually triggers a Word export. Only import this file lazily.
export async function encodeDocx(doc: Y.Doc): Promise<Uint8Array> {
  const root = readPmDoc(doc);
  const document = new Document({
    styles: { default: { document: { run: { font: BODY_FONT, size: BODY_SIZE_HALF_PT } } } },
    numbering: { config: [orderedNumberingConfig()] },
    sections: [{ children: blocksOf(root, { next: 1 }) }],
  });
  return new Uint8Array(await Packer.toArrayBuffer(document));
}
