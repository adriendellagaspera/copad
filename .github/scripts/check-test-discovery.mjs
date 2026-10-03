#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.TEST_DISCOVERY_ROOT ?? path.join(scriptDir, '../..'));
const scanRoots = (process.env.TEST_DISCOVERY_PATHS ?? 'src,scripts')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function importsVitest(source) {
  return /\bfrom\s+['"]vitest['"]|\bimport\s*\(\s*['"]vitest['"]\s*\)|\brequire\s*\(\s*['"]vitest['"]\s*\)/.test(source);
}

const files = scanRoots.flatMap((dir) => filesUnder(path.join(root, dir)));
const violations = [];
for (const file of files) {
  const relative = path.relative(root, file);
  const discoverable = file.endsWith('.test.ts');
  const testShaped = file.endsWith('.spec.ts') || importsVitest(fs.readFileSync(file, 'utf8'));
  if (testShaped && !discoverable) violations.push(relative);
}

if (violations.length > 0) {
  for (const file of violations) console.error(`  ${file}: test-shaped file is not named *.test.ts`);
  console.error(`check-test-discovery: ${violations.length} undiscovered test file(s)`);
  process.exit(1);
}

console.log(`check-test-discovery: ${files.length} TypeScript file(s) checked, 0 undiscovered tests`);
