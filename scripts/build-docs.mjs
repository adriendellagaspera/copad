#!/usr/bin/env node
// Renders docs/contract.md into a standalone HTML page styled like the rest of
// Copad, so About's "The contract" link lands on Copad's own documentation
// instead of GitHub's blob view. docs/contract.md stays the single source of
// truth (AGENTS.md: "every fact lives in exactly one place") — this only
// changes how it's presented, run as part of `npm run build` (package.json),
// so every build (GitHub Pages and self-hosted alike) ships dist/docs/contract.html.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_MD = path.join(REPO_ROOT, 'docs/contract.md');
const OUT_FILE = path.join(REPO_ROOT, 'dist/docs/contract.html');
const SOURCE_URL = 'https://github.com/adriendellagaspera/copad/blob/main/docs/contract.md';

// Mirrors GitHub's own heading-anchor algorithm closely enough to keep
// existing `#2-the-two-transports-promise-different-things`-style anchors
// (aboutCopy.ts's PRIVACY_URL) resolving: lowercase, strip everything but
// letters/digits/marks/connector-punctuation/spaces/hyphens, spaces to hyphens,
// de-duplicate repeats with a numeric suffix.
function githubSlug(text, seen) {
  const base = text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .trim()
    .replace(/ /g, '-');
  let slug = base;
  for (let n = 1; seen.has(slug); n += 1) slug = `${base}-${n}`;
  seen.add(slug);
  return slug;
}

function headingText(inlineToken) {
  return inlineToken.children
    .filter((t) => t.type === 'text' || t.type === 'code_inline')
    .map((t) => t.content)
    .join('');
}

export function renderContractPage(markdown) {
  const md = new MarkdownIt({ html: false, linkify: true });
  const seen = new Set();
  md.renderer.rules.heading_open = (tokens, idx) => {
    const inline = tokens[idx + 1];
    const id = githubSlug(headingText(inline), seen);
    return `<${tokens[idx].tag} id="${id}">`;
  };
  return pageShell(md.render(markdown));
}

function pageShell(articleHtml) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>The contract — Copad documentation</title>
<meta name="description" content="Copad's binding contract: what the write gate promises, and when." />
<style>${STYLE}</style>
</head>
<body>
<div class="page">
  <header class="nav">
    <a class="home" href="../">← Copad</a>
    <a href="${SOURCE_URL}">View source</a>
  </header>
  <article class="doc">${articleHtml}</article>
  <footer class="foot">
    Generated from <code>docs/contract.md</code> — binding, not indicative.
  </footer>
</div>
</body>
</html>
`;
}

const STYLE = `
:root {
  --bg: #f6f6f4; --surface: #ffffff; --border: #e6e4e0; --border-strong: #d3d0ca;
  --text: #1d1c1a; --text-muted: #6b6862; --text-faint: #9a968e;
  --accent: #2563eb; --accent-hover: #1d4ed8;
  --code-bg: #f3f2ef; --code-fg: #9333ea; --codeblock-bg: #1e293b; --codeblock-fg: #e2e8f0;
  --font-ui: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-read: "Source Serif 4", Georgia, "Iowan Old Style", "Times New Roman", serif;
  --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", "Fira Code", monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16161a; --surface: #1e1e24; --border: #2e2e38; --border-strong: #3a3a46;
    --text: #ececf0; --text-muted: #a6a6b0; --text-faint: #6f6f7c;
    --accent: #6b8efb; --accent-hover: #85a2ff;
    --code-bg: #2b2b34; --code-fg: #d8b4fe; --codeblock-bg: #11141b; --codeblock-fg: #cbd5e1;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font-family: var(--font-ui); line-height: 1.5;
}
.page { max-width: 76ch; margin: 0 auto; padding: 2rem 1.5rem 4rem; }
.nav {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 2rem; font-size: 0.9rem;
}
.nav a { color: var(--text-muted); text-decoration: none; }
.nav a:hover { color: var(--accent); }
.nav .home { font-weight: 600; }
.doc { font-family: var(--font-read); font-size: 1.0625rem; }
.doc h1, .doc h2, .doc h3, .doc h4 {
  font-family: var(--font-read); font-weight: 600; line-height: 1.25;
  scroll-margin-top: 1.5rem;
}
.doc h1 { font-size: 1.75rem; margin: 0 0 1.5rem; }
.doc h2 { font-size: 1.375rem; margin: 2.5rem 0 1rem; padding-top: 1rem; border-top: 1px solid var(--border); }
.doc h3 { font-size: 1.125rem; margin: 2rem 0 0.75rem; }
.doc h4 { font-size: 1rem; margin: 1.5rem 0 0.5rem; }
.doc p, .doc ul, .doc ol { margin: 0 0 1rem; }
.doc a { color: var(--accent); }
.doc a:hover { color: var(--accent-hover); }
.doc blockquote {
  margin: 0 0 1rem; padding: 0.25rem 1rem; border-left: 3px solid var(--border-strong);
  color: var(--text-muted);
}
.doc code {
  font-family: var(--font-mono); font-size: 0.875em; background: var(--code-bg);
  color: var(--code-fg); padding: 0.1em 0.35em; border-radius: 4px;
}
.doc pre {
  background: var(--codeblock-bg); color: var(--codeblock-fg); padding: 1rem;
  border-radius: 8px; overflow-x: auto;
}
.doc pre code { background: none; color: inherit; padding: 0; }
.doc table { width: 100%; border-collapse: collapse; margin: 0 0 1.5rem; font-size: 0.9375rem; display: block; overflow-x: auto; }
.doc th, .doc td { border: 1px solid var(--border); padding: 0.5rem 0.75rem; text-align: left; vertical-align: top; }
.doc th { background: var(--surface); font-family: var(--font-ui); }
.doc hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
.foot {
  margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border);
  color: var(--text-faint); font-size: 0.8125rem;
}
.foot code { font-family: var(--font-mono); }
`;

function main() {
  const markdown = fs.readFileSync(SOURCE_MD, 'utf8');
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, renderContractPage(markdown));
  console.log(`build-docs: wrote ${path.relative(REPO_ROOT, OUT_FILE)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
