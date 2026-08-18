#!/usr/bin/env node
// Structural correctness of this repo's docs, in two parts. Neither is
// visible in a diff: a link that resolves nowhere still renders as a link,
// and a `docs/contract.md §N` citation still reads as a real pointer once the
// section it names is renamed or removed.
//
//   1. Every Markdown link/anchor resolves (AGENTS.md, CLAUDE.md, README.md,
//      docs/architecture.md, docs/contract.md).
//   2. Every `contract §N.M` / `docs/contract.md §N.M` citation — in those
//      same docs *and* in every src/**/*.{ts,svelte} comment — names a
//      section that still exists in docs/contract.md. This crosses the
//      Markdown/TypeScript boundary the same way reconcile-rs's
//      check-doc-structure.sh does for `SOTA.md §N.M` in rustdoc: 23 files
//      under src/ cite the contract this way today (AGENTS.md: "docs/contract.md
//      is binding... changing behaviour it describes means updating it in the
//      same commit" — a citation that quietly points at a renumbered or
//      deleted section is exactly the drift that rule exists to prevent).
//
// Bare `§N.M` (no "contract"/"docs/contract.md" qualifier) only means
// anything *inside* docs/contract.md itself — that's the only file self-citing
// its own sections; everywhere else the qualifier is what establishes which
// document is being cited, so an unqualified bare `§` elsewhere is prose, not
// a citation, and is left alone (mirrors check-doc-structure.sh's own
// precision rules: a naive matcher over-fires, so every exclusion here was
// checked against the real tree, not assumed).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rel = (p) => path.relative(REPO_ROOT, p);

let status = 0;
const fail = (msg) => {
  console.error(`check-doc-structure: ${msg}`);
  status = 1;
};

// ---- discover docs -------------------------------------------------------
const DOCS = ['AGENTS.md', 'CLAUDE.md', 'README.md', 'docs/architecture.md', 'docs/contract.md']
  .map((p) => path.join(REPO_ROOT, p))
  .filter((p) => fs.existsSync(p));

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'api') continue;
      walk(full, exts, out);
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}
const SRC_FILES = walk(path.join(REPO_ROOT, 'src'), ['.ts', '.svelte']);

// ---- GitHub-style heading slugs, per doc ---------------------------------
// Lowercase; strip Markdown emphasis/link syntax; drop punctuation other than
// word chars/spaces/hyphens; spaces to hyphens. Approximates GitHub's slugger
// for the plain-ASCII headings this repo actually has — verified against
// every #fragment link found in the tree, not asserted.
function slugify(headingText) {
  return headingText
    .replace(/[`*_]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

const anchorsByDoc = new Map(); // absPath -> Set<slug>
const explicitIdsByDoc = new Map(); // absPath -> Set<id>  (<a id="...">)
for (const doc of DOCS) {
  const text = fs.readFileSync(doc, 'utf8');
  const slugs = new Set();
  for (const m of text.matchAll(/^#{1,6}\s+(.+)$/gm)) slugs.add(slugify(m[1]));
  anchorsByDoc.set(doc, slugs);
  const ids = new Set();
  for (const m of text.matchAll(/<a\s+id="([^"]+)"/g)) ids.add(m[1]);
  explicitIdsByDoc.set(doc, ids);
}

// ---- part 1: link targets + anchors --------------------------------------
let linksChecked = 0;
for (const doc of DOCS) {
  const dir = path.dirname(doc);
  const text = fs.readFileSync(doc, 'utf8');
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:)/.test(target)) continue;

    const [filePart, frag] = target.split('#');
    let resolved = doc;
    if (filePart) {
      resolved = path.resolve(dir, filePart);
      if (!fs.existsSync(resolved)) {
        fail(`${rel(doc)}: link target does not exist: ${target}`);
        continue;
      }
    }
    if (frag !== undefined && resolved.endsWith('.md')) {
      linksChecked++;
      const known = anchorsByDoc.get(resolved) ?? anchorsByDoc.get(path.resolve(resolved));
      const ids = explicitIdsByDoc.get(resolved) ?? new Set();
      const slugs = known ?? new Set(fs.readFileSync(resolved, 'utf8').matchAll(/^#{1,6}\s+(.+)$/gm).map((h) => slugify(h[1])));
      if (!slugs.has(frag) && !ids.has(frag)) {
        fail(`${rel(doc)}: anchor does not resolve: ${target}`);
      }
    }
  }
}

// ---- part 2: contract §N.M citations -------------------------------------
const contractDoc = path.join(REPO_ROOT, 'docs/contract.md');
const contractSections = new Set(
  [...fs.readFileSync(contractDoc, 'utf8').matchAll(/^#{2,3}\s+(\d+(?:\.\d+)?)[.\s]/gm)].map((m) => m[1]),
);
if (contractSections.size === 0) fail('docs/contract.md: no numbered sections found — heading format changed?');

let citationsChecked = 0;
function checkCitations(file, text, { selfReferencing }) {
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    // Qualified form: "contract" or "docs/contract.md" immediately (one
    // optional backtick, then whitespace) before a run of one or more
    // §N(.M) tokens. Self-referencing files (docs/contract.md itself) also
    // accept the bare form — nothing else needs the qualifier there.
    const qualifiedRe = /(?:docs\/contract\.md|contract)`?\s+((?:§\d+(?:\.\d+)?[,/\s-]*)+)/g;
    const bareRe = /§\d+(?:\.\d+)?/g;
    const matches = selfReferencing ? [...line.matchAll(bareRe)].map((m) => [m[0]]) : [...line.matchAll(qualifiedRe)].map((m) => [...m[1].matchAll(bareRe)].map((s) => s[0]));
    for (const group of matches) {
      for (const token of group) {
        citationsChecked++;
        const num = token.slice(1);
        if (!contractSections.has(num)) {
          fail(`${rel(file)}:${i + 1}: cites \`docs/contract.md\` §${num}, which does not exist`);
        }
      }
    }
  });
}

for (const doc of DOCS) {
  checkCitations(doc, fs.readFileSync(doc, 'utf8'), { selfReferencing: doc === contractDoc });
}
for (const file of SRC_FILES) {
  checkCitations(file, fs.readFileSync(file, 'utf8'), { selfReferencing: false });
}

console.log(
  `check-doc-structure: ${DOCS.length} docs, ${linksChecked} anchor links, ${citationsChecked} contract §-citations (${SRC_FILES.length} source files scanned)`,
);
process.exit(status);
