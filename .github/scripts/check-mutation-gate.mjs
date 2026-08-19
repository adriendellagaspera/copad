#!/usr/bin/env node
// Does a change's *tests* actually detect faults in the code the change touched? Coverage cannot
// answer this: Meta's ACH study found 49% of fault-detecting generated tests added zero line
// coverage (arXiv:2501.12862) — a coverage-delta gate would discard half of the tests that
// mattered. Mutation does answer it: inject a plausible fault into the changed lines, require the
// suite to fail. Mirrors reconcile-rs's check-mutation-gate.sh, ported from cargo-mutants'
// `--in-diff <file>` (a native flag) to StrykerJS, which has no such flag (tracked upstream as
// stryker-js#551/#2843, both years-old and unresolved) — this script computes the same thing by
// hand: parse `git diff` hunks into per-file changed line ranges, pass them to `--mutate`.
//
// Scope is the diff, not the workspace: a full sweep is slow and belongs to the nightly job in
// mutation-testing.yml, reported as a trend rather than gating every PR on it.
//
// Only .ts files are mutated, never .svelte — Stryker *can* instrument Svelte templates (verified:
// it mutates template-level string comparisons too), but their meaningful coverage lives in the
// Playwright e2e suite, a different test runner this integration never invokes. Including them
// would flag untested-by-vitest UI branches as "surviving mutants" for reasons that have nothing
// to do with test quality.
//
// DIFF_TEXT_FILE points at a captured `git diff` payload instead of shelling out to git, so the
// line-range parser can be exercised by check-mutation-gate.test.sh without a real repo. PRINT_ONLY
// stops after computing the --mutate argument and prints it instead of invoking Stryker, so the
// test suite never has to actually run a mutation test to check the parser.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const BASE_REF = process.argv[2] ?? 'origin/main';

function diffText(baseRef) {
  if (process.env.DIFF_TEXT_FILE) {
    return fs.readFileSync(process.env.DIFF_TEXT_FILE, 'utf8');
  }
  return execFileSync('git', ['diff', `${baseRef}...HEAD`, '--', 'src'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  });
}

// Walks unified-diff hunks, tracking the current line number in the *new* file: a context line
// (' ') or added line ('+') both occupy a line in the new file and advance the counter; a removed
// line ('-') does not, since it no longer exists there. Every '+' line's current number is a
// changed line worth mutating.
function changedLinesByFile(diff) {
  const files = new Map();
  let currentFile = null;
  let newLine = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice('+++ b/'.length);
      continue;
    }
    if (line.startsWith('@@ ')) {
      const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      newLine = m ? Number(m[1]) : null;
      continue;
    }
    if (currentFile === null || newLine === null) continue;
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) {
      if (!files.has(currentFile)) files.set(currentFile, new Set());
      files.get(currentFile).add(newLine);
      newLine++;
    } else if (line.startsWith('-')) {
      // Removed line: consumes no line number in the new file.
    } else if (line.startsWith(' ')) {
      newLine++;
    }
  }
  return files;
}

function onlyMutableSource(files) {
  return new Map([...files].filter(([f]) => f.endsWith('.ts') && !f.endsWith('.test.ts')));
}

function toRanges(lineNumbers) {
  const sorted = [...lineNumbers].sort((a, b) => a - b);
  const ranges = [];
  let start = null;
  let prev = null;
  for (const n of sorted) {
    if (start === null) {
      start = n;
    } else if (n !== prev + 1) {
      ranges.push([start, prev]);
      start = n;
    }
    prev = n;
  }
  if (start !== null) ranges.push([start, prev]);
  return ranges;
}

function buildMutateArg(files) {
  const parts = [];
  for (const [file, lineNumbers] of files) {
    for (const [start, end] of toRanges(lineNumbers)) {
      parts.push(`${file}:${start}-${end}`);
    }
  }
  return parts.join(',');
}

const files = onlyMutableSource(changedLinesByFile(diffText(BASE_REF)));
const mutateArg = buildMutateArg(files);

if (!mutateArg) {
  console.error(`check-mutation-gate: no src/**/*.ts changes against ${BASE_REF}, nothing to check`);
  process.exit(0);
}

console.error(`check-mutation-gate: mutating lines changed against ${BASE_REF}`);
console.error(`                     ${mutateArg}`);

if (process.env.PRINT_ONLY) {
  console.log(mutateArg);
  process.exit(0);
}

try {
  execFileSync('npx', ['stryker', 'run', '--mutate', mutateArg], { stdio: 'inherit' });
} catch {
  process.exit(1);
}
console.log('check-mutation-gate: no surviving mutants in the diff');
