#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FATAL = new Set(['high', 'critical']);
const EXCEPTIONS = new Map([
  [
    'braces|GHSA-vfj7-8cjw-p6xm',
    {
      expires: '2026-10-17',
      reason:
        'No patched braces release exists; this path is transitive build tooling via pcloud-sdk-js -> @babel/cli -> chokidar.',
    },
  ],
]);

function loadReport() {
  if (process.env.AUDIT_JSON) return JSON.parse(readFileSync(process.env.AUDIT_JSON, 'utf8'));

  const run = spawnSync('npm', ['audit', '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });
  if (!run.stdout) throw new Error(`npm audit produced no JSON: ${run.stderr.trim()}`);
  return JSON.parse(run.stdout);
}

function ghsaId(url) {
  if (typeof url !== 'string') return null;
  return url.match(/GHSA-[0-9a-z-]+$/i)?.[0] ?? null;
}

const report = loadReport();
const now = new Date(`${process.env.AUDIT_NOW ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);
const findings = [];

for (const [pkg, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vulnerability.via ?? []) {
    if (typeof via === 'string' || !FATAL.has(via.severity)) continue;
    const id = ghsaId(via.url) ?? `source-${via.source ?? 'unknown'}`;
    findings.push({ pkg, id, title: via.title ?? 'unnamed advisory', url: via.url ?? '' });
  }
}

const fatalCount =
  (report.metadata?.vulnerabilities?.high ?? 0) + (report.metadata?.vulnerabilities?.critical ?? 0);
if (fatalCount > 0 && findings.length === 0) {
  console.error('check-audit: high/critical vulnerabilities reported, but no concrete advisory could be resolved.');
  process.exit(1);
}

const violations = [];
for (const finding of findings) {
  const key = `${finding.pkg}|${finding.id}`;
  const exception = EXCEPTIONS.get(key);
  if (!exception) {
    violations.push(`${finding.pkg}: ${finding.id} — ${finding.title}`);
    continue;
  }

  const expiry = new Date(`${exception.expires}T23:59:59Z`);
  if (now > expiry) {
    violations.push(
      `${finding.pkg}: ${finding.id} exception expired ${exception.expires} — ${exception.reason}`,
    );
  } else {
    console.warn(
      `check-audit: temporary exception ${finding.pkg} ${finding.id} through ${exception.expires}: ${exception.reason}`,
    );
  }
}

if (violations.length > 0) {
  console.error('check-audit: high/critical advisory gate failed:');
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}

console.log('check-audit: no unexcepted high/critical advisories.');
