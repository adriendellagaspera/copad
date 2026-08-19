<!--
AGENTS.md: table over narrative, the delta not the process.
lint/check/test/doc-budget are hook-gated (pre-commit/pre-push, AGENTS.md
"Commands") — this push already proved them, so don't re-list or re-run them
here. List only what the hooks don't cover.
-->

| | |
|---|---|
| Issue | #NNN |
| Change | |
| Why | |

## Verification

- [ ] `npm run test:scripts` passes — not hooked (only relevant if `.github/scripts/` changed)
- [ ] `docs/contract.md`, `docs/architecture.md` and/or `README.md` updated in
      this PR, if it changes behaviour they describe (AGENTS.md: "in the same
      commit")
