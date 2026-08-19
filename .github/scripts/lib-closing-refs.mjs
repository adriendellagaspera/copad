// CLOSING_RE/NONCLOSING_RE: shared between check-pr-closes-issues.mjs and any future script that
// needs "does this PR close #N", so that has exactly one definition instead of two regexes kept in
// step by hand. Mirrors reconcile-rs's scripts/lib-closing-refs.sh.
export const CLOSING_RE = /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\b:?\s*#(\d+)/gi;
export const NONCLOSING_RE = /\b(relates?\s+to|see|tracks?|blocked\s+by|part\s+of|ref(erences?)?)\b:?\s*#(\d+)/gi;
