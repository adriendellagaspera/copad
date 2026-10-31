// Keep the nightly mutation shards exhaustive and disjoint as source modules evolve.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const groups = [
  { directories: ['collaboration'], patterns: ['src/collaboration/**/*.ts'] },
  { directories: ['editor', 'format'], patterns: ['src/editor/**/*.ts', 'src/format/**/*.ts'] },
  { directories: ['network', 'persistence', 'storage'], patterns: [
    'src/network/**/*.ts', 'src/persistence/**/*.ts', 'src/storage/**/*.ts', 'src/*.ts',
  ] },
  { directories: ['ui'], patterns: ['src/ui/**/*.ts'] },
];

const files = execFileSync('git', ['ls-files', '--', 'src'], { encoding: 'utf8' })
  .split('\n')
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
assert(files.length > 0, 'no TypeScript sources available for mutation coverage');
const counts = groups.map(() => 0);
for (const file of files) {
  const relative = file.slice('src/'.length);
  const directory = relative.includes('/') ? relative.split('/')[0] : null;
  const owners = groups.flatMap((group, index) =>
    group.directories.includes(directory) || (index === 2 && directory === null)
      ? [index] : []);
  assert.equal(owners.length, 1, `exactly one nightly shard must cover ${file}`);
  counts[owners[0]] += 1;
}
assert(counts.every((count) => count > 0), 'nightly mutation shards must not be empty');
if (process.argv[2] === '--verify') {
  console.log('Mutation shards cover all', files.length, 'tracked TS source files:', counts);
} else {
  const shard = Number(process.argv[2]);
  assert(Number.isInteger(shard) && shard >= 0 && shard < groups.length,
    'expected shard index 0..3 or --verify');
  console.log([...groups[shard].patterns, '!src/**/*.test.ts'].join(','));
}
