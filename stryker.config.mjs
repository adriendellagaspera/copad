// Mutation testing (issue #336): measures whether the test suite actually detects a fault, not
// just whether it runs. See .github/scripts/check-mutation-gate.mjs for the PR-diff gate this
// backs, and .github/workflows/mutation-testing.yml for the nightly full-sweep trend job.
//
// .svelte files are deliberately excluded from `mutate`, even though Stryker can instrument them
// (verified: it mutates template-level expressions too) — their meaningful coverage lives in the
// Playwright e2e suite, a different test runner this integration never invokes, so a mutant there
// would "survive" for reasons that have nothing to do with test quality.
export default {
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
  testRunner: 'vitest',
  coverageAnalysis: 'perTest',
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  reporters: ['clear-text', 'progress'],
  thresholds: { high: 100, low: 100, break: 100 },
};
