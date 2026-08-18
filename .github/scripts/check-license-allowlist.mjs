#!/usr/bin/env node
// License-compliance gate: every dependency's license must be on the allowlist
// below, mirroring reconcile-rs's deny.toml `[licenses] allow = [...]` for the
// same reason — an unreviewed license entering the tree is a compliance risk
// nobody chose, not something a green build should hide.
//
// A license value is either a single SPDX id, or a parenthesised boolean
// expression license-checker-rseidelsohn already normalises, e.g.
// "(MIT OR GPL-3.0-or-later)" (jszip) or "(MIT AND Zlib)" (pako). OR is
// compliant if any branch is allowed — the consumer picks which term to use.
// AND must have every branch allowed — all terms bind at once.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'MPL-2.0',
  'BlueOak-1.0.0',
  'CC-BY-4.0',
  'CC-BY-3.0',
  'CC0-1.0',
  'Python-2.0',
  'Unlicense',
  'Zlib',
]);

function isCompliant(license) {
  const expr = license.trim().replace(/^\(|\)$/g, '');
  if (expr.includes(' OR ')) return expr.split(' OR ').some((part) => isCompliant(part));
  if (expr.includes(' AND ')) return expr.split(' AND ').every((part) => isCompliant(part));
  return ALLOWED.has(expr);
}

const binPath = path.join(REPO_ROOT, 'node_modules/.bin/license-checker-rseidelsohn');
const raw = execFileSync(binPath, ['--json'], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20,
});
const packages = JSON.parse(raw);

// license-checker-rseidelsohn reports every `private: true` package's own
// license as the literal string "UNLICENSED", including this repo's own root
// package — regardless of its real package.json `license` field. Not a
// third-party compliance question (nothing is being distributed), so it's
// excluded from the scan rather than allowlisted, which would also accept an
// actually-unlicensed *dependency* by the same string.
const violations = Object.entries(packages)
  .filter(([, info]) => !info.private)
  .filter(([, info]) => !isCompliant(info.licenses ?? 'UNKNOWN'))
  .map(([pkg, info]) => `  ${pkg}: ${info.licenses ?? 'UNKNOWN'}`);

if (violations.length > 0) {
  console.error('check-license-allowlist: license(s) not on the allowlist:');
  console.error(violations.join('\n'));
  console.error('');
  console.error('Either the dependency needs replacing, or the license belongs on the');
  console.error('allowlist in this script — say why in the commit.');
  process.exit(1);
}

console.log(`check-license-allowlist: ${Object.keys(packages).length} packages, all licenses allowed.`);
