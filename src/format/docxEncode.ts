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

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6,
];
const MAX_LIST_LEVEL = 5; // docx numbering levels are 0-indexed; we define 6 (0-5)
const ORDERED_REF = 'copad-ordered';
const LIST_INDENT_IN = 0.25; // extra indent per nesting level, matching a typical Word list

/** The `docx` package leaves body text at OOXML's own bare-spec fallback
 *  (10pt, no named font) when docDefaults is left empty — reads as
 *  illegibly small next to the editor's own 18px/13.5pt reading font.
 *  12pt/Georgia (a serif Word actually ships) is the closest sane match. */
const BODY_FONT = 'Georgia';
const BODY_SIZE_HALF_PT = 24; // 12pt

/** `level` 0-5 cycles decimal → lowerLetter → lowerRoman, matching Word's own
 *  default multi-level list style, so nested ordered lists read distinctly. */
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
    switch (mark.type.name) {
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

/** Inline content (paragraph/heading/table cell text) → docx run children,
 *  wrapping a `link`-marked run in an {@link ExternalHyperlink}. `forceStyle`
 *  is merged under each run's own marks (e.g. bolding every run in a table
 *  header cell, regardless of what marks the source text itself carries). */
function runsOf(inline: PMNode, forceStyle: IRunStylePropertiesOptions = {}): ParagraphChild[] {
  const runs: ParagraphChild[] = [];
  inline.forEach((child) => {
    if (child.type.name === 'hard_break') {
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
/** Mutable, single instance counter shared across one whole `encode()` call —
 *  NOT re-created per recursive `blocksOf` call, or two unrelated root lists
 *  in different branches (e.g. two separate blockquotes) could collide on
 *  the same instance number and render as one continuing list. */
type OrderedCounter = { next: number };

/** Turns a container's block-level children into docx paragraphs/tables — the
 *  top-level document, or the non-first children of a list_item/task_item/
 *  blockquote (their content is `paragraph block*`, so every child from the
 *  second on is itself a full block, handled one at a time by {@link blockOf}). */
function blocksOf(container: PMNode, counter: OrderedCounter, depth = -1, orderedInstance = 0): Block[] {
  const out: Block[] = [];
  container.forEach((node) => out.push(...blockOf(node, counter, depth, orderedInstance)));
  return out;
}

/** Turns a single block-level node into zero or more docx paragraphs/tables.
 *  Threads `depth` (current list nesting, -1 outside any list) and a
 *  per-reference `orderedInstance` so a *root* ordered list restarts at 1
 *  while a *nested* one continues sharing its ancestor's numbering instance —
 *  the same distinction Word itself makes between separate lists and
 *  multi-level ones. */
function blockOf(node: PMNode, counter: OrderedCounter, depth: number, orderedInstance: number): Block[] {
  switch (node.type.name) {
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
        if (child.type.name === 'paragraph') {
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
      // A root list (depth -1, i.e. not nested inside another list) gets a
      // fresh instance so it restarts numbering at 1; a nested one shares
      // its ancestor's instance so the multi-level numbering stays continuous.
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
      // Word/the docx package fall back to ~0-width columns when no width is
      // given (`w:tblW`/`w:gridCol` default to a handful of twips) — every
      // cell gets an explicit equal share of the table's own 100% width so
      // columns render at a readable size instead of collapsing to nothing.
      const colCount = node.firstChild?.childCount ?? 1;
      const colWidth: ITableWidthProperties = { size: `${100 / colCount}%`, type: WidthType.PERCENTAGE };
      const rows: TableRow[] = [];
      node.forEach((row) => {
        const cells: TableCell[] = [];
        row.forEach((cell) => {
          // A cell holds block+ content (paragraphs, lists, headings, …), not
          // bare inline runs — the common single-paragraph case renders as
          // before (with header bold forced onto its runs); anything richer
          // falls through to the general block renderer, same as the top
          // level, so no cell content is silently dropped.
          const isHeader = cell.type.name === 'table_header';
          const onlyParagraph = cell.childCount === 1 && cell.firstChild!.type.name === 'paragraph';
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
    if (i === 0 && child.type.name === 'paragraph') {
      out.push(new Paragraph({ children: runsOf(child), ...extra }));
    } else {
      out.push(...blockOf(child, counter, level, orderedInstance));
    }
  });
  return out;
}

/**
 * Word document (.docx) bytes, via the `docx` package. Covers headings,
 * emphasis/strike/underline/code marks, links, bullet/ordered/task lists
 * (nested), blockquotes, code blocks, horizontal rules and tables.
 *
 * Deliberately a plain function, not exported alongside an `ExportCodec`
 * object (#181) — `docx.ts` wraps this behind a dynamic `import()` so the
 * `docx` package (~100kB gzipped) only loads into a page that actually
 * triggers a Word export, instead of bloating the main bundle for every
 * visitor. This file may pull in the full package at module scope; only
 * import it lazily.
 */
export async function encodeDocx(doc: Y.Doc): Promise<Uint8Array> {
  const root = readPmDoc(doc);
  const document = new Document({
    styles: { default: { document: { run: { font: BODY_FONT, size: BODY_SIZE_HALF_PT } } } },
    numbering: { config: [orderedNumberingConfig()] },
    sections: [{ children: blocksOf(root, { next: 1 }) }],
  });
  return new Uint8Array(await Packer.toArrayBuffer(document));
}
