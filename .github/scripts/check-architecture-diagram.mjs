#!/usr/bin/env node
// docs/architecture.md's mermaid diagram (## Architecture) draws each port's adapter set as a
// single labeled node (e.g. `Storage --> A1["dropbox · pcloud · ..."]`). eslint.config.js's
// no-restricted-imports enforces the negative half of the hexagonal boundary invariant (a domain
// file may never import a concrete adapter); nothing enforced the positive half: that the
// *documented* adapter set for each port is the *real* one. Mirrors reconcile-rs's
// check-domain-purity.sh Part 3, which found a real gap this way (a documented edge the manifests
// didn't actually have) — same mechanism here, ported from a crate-dependency graph (Cargo.toml is
// unambiguous ground truth) to a port/adapter graph (no manifest exists, so each group below hand-
// extracts its own ground truth, the same way that script hand-lists DOMAIN_FILES rather than
// inferring it).
import fs from 'node:fs';

const ARCH = 'docs/architecture.md';
const arch = fs.readFileSync(ARCH, 'utf8');

function diagramNames(nodeId) {
  const m = arch.match(new RegExp(`${nodeId}\\["([^"]*)"\\]`));
  if (!m) return null;
  return m[1]
    .replace(/\\n/g, ' ')
    .split(/[\s·]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
}

function readAll(paths) {
  return paths.map((p) => [p, fs.readFileSync(p, 'utf8')]);
}

function matchAllGroups(text, re) {
  return [...text.matchAll(re)].map((m) => m[1]);
}

const collabFiles = fs.readdirSync('src/collaboration').filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
const collabSources = readAll(collabFiles.map((f) => `src/collaboration/${f}`));

// Each entry: which diagram node, and how to derive the *real* adapter set for the port(s) that
// feed it. Hand-maintained, like reconcile-rs's DOMAIN_FILES/STANDALONE_MANIFESTS — there is no
// manifest a script can read this from mechanically.
const GROUPS = [
  {
    node: 'A1',
    port: 'Storage/StorageAuth',
    real() {
      // src/storage/index.ts is the composition root: its own import list of `*Storage`
      // factories IS the adapter set, not a heuristic over every file in the directory (most
      // files there — types.ts, auth.ts, parse.ts, ... — are not adapters at all).
      const text = fs.readFileSync('src/storage/index.ts', 'utf8');
      return matchAllGroups(text, /^import\s*\{\s*\w+Storage\s*\}\s*from\s*'\.\/(\w+)\.js';/gm).sort();
    },
  },
  {
    node: 'A2',
    port: 'Collab',
    real() {
      const names = collabSources.flatMap(([, text]) => matchAllGroups(text, /^export function (\w+Collab)\(/gm));
      return [...new Set(names)].sort();
    },
  },
  {
    node: 'A3',
    port: 'RoomAccess/RoomCipher',
    real() {
      const names = collabSources.flatMap(([, text]) =>
        matchAllGroups(text, /^export function (\w+)\([^)]*\):\s*(?:RoomAccess|RoomCipher|SecretLinkPort)\s*\{/gm),
      );
      return [...new Set(names)].sort();
    },
  },
  {
    node: 'A4',
    port: 'Codec',
    real() {
      // The `codecs: Codec[]` array is the Codec *port*'s membership specifically —
      // `exportCodecs`/`ExportCodec` (docx) is a different, unpictured port; see the comment
      // beside that array in src/format/index.ts.
      const text = fs.readFileSync('src/format/index.ts', 'utf8');
      const m = text.match(/codecs:\s*Codec\[\]\s*=\s*\[([^\]]*)\]/);
      if (!m) return [];
      return matchAllGroups(m[1] + ',', /(\w+)Codec\s*,/g).sort();
    },
  },
];

let status = 0;
for (const { node, port, real } of GROUPS) {
  const documented = diagramNames(node);
  if (documented === null) {
    console.error(`check-architecture-diagram: no node ${node} found in ${ARCH}'s mermaid diagram — update the script or the diagram`);
    status = 1;
    continue;
  }
  const actual = real();

  for (const name of actual) {
    if (!documented.includes(name)) {
      console.error(`check-architecture-diagram: ${port} adapter '${name}' exists in code but ${ARCH}'s ${node} node doesn't draw it`);
      status = 1;
    }
  }
  for (const name of documented) {
    if (!actual.includes(name)) {
      console.error(`check-architecture-diagram: ${ARCH}'s ${node} node draws '${name}' for ${port}, which the code doesn't have`);
      status = 1;
    }
  }
}

if (status === 0) {
  console.log(`check-architecture-diagram: ${GROUPS.length} port group(s) checked, diagram matches code`);
} else {
  console.error('');
  console.error(`${ARCH}'s mermaid diagram and the real adapter set disagree. The code is ground truth:`);
  console.error('fix the diagram, or fix the adapter if the diagram was the intent.');
}

process.exit(status);
