#!/usr/bin/env node
// Every open issue mentioned bare in a PR's own description must state its intent: either a
// recognized GitHub closing keyword (Closes/Fixes/Resolves #N — closes it at merge time) or an
// explicit non-closing lead-in (relates to/see/tracks/blocked by/part of/ref #N). A bare "#N" with
// neither is ambiguous — nothing forces the author (or a reviewer) to say which one was meant.
//
// Converse, same subject from the other end: an issue this PR *closes* must have nothing left
// unticked in it. check-closed-issue-boxes.mjs already reports that, but only after the fact, on a
// weekly tick. Here the same question costs seconds, asked of the person about to close the issue
// while they still have the context, and before the close rather than after: tick what this PR
// delivers, split or re-home what it does not. check-closed-issue-boxes.mjs stays the backstop for
// closes this cannot see — by hand in the UI, or by a commit message rather than a description.
//
// Numbers are a shared namespace between issues and PRs, and the GitHub Issues API does not
// separate them: /issues/{n} resolves a pull request number too, and reports it "open" like an
// open issue. So an open PR mentioned here needs an intent word exactly like an issue does.
//
// Reads the PR body from $PR_BODY (an env var, never interpolated into a shell command — a PR body
// is attacker-controlled text). Live mode calls the GitHub REST API (GITHUB_TOKEN +
// GITHUB_REPOSITORY, as Actions sets by default). ISSUES_JSON points at a captured payload instead
// (an array of {number, state, body}), so the rule can be exercised against a fixture without a
// network round trip or a token.
import fs from 'node:fs';
import { CLOSING_RE, NONCLOSING_RE } from './lib-closing-refs.mjs';

const REPO = process.env.GITHUB_REPOSITORY ?? 'adriendellagaspera/copad';
const BODY = process.env.PR_BODY ?? '';

function extractNumbers(text, re) {
  return [...new Set([...text.matchAll(re)].map((m) => m[m.length - 1]))];
}

const allRefs = extractNumbers(BODY, /#(\d+)/g);
const closingRefs = extractNumbers(BODY, CLOSING_RE);
const nonClosingRefs = extractNumbers(BODY, NONCLOSING_RE);

let fixture;
if (process.env.ISSUES_JSON) {
  const list = JSON.parse(fs.readFileSync(process.env.ISSUES_JSON, 'utf8'));
  fixture = new Map(list.map((i) => [String(i.number), i]));
} else if (!process.env.GITHUB_TOKEN) {
  console.error('check-pr-closes-issues: GITHUB_TOKEN is required (or set ISSUES_JSON)');
  process.exit(1);
}

async function getIssue(number) {
  if (fixture) return fixture.get(number) ?? null;
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues/${number}`, {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    console.error(`check-pr-closes-issues: GitHub API returned ${res.status} for #${number}`);
    process.exit(1);
  }
  return res.json();
}

function uncheckedBoxCount(body) {
  return [...(body ?? '').matchAll(/^[ \t]*[-*][ \t]+\[ \]/gm)].length;
}

let status = 0;

for (const n of allRefs) {
  if (closingRefs.includes(n) || nonClosingRefs.includes(n)) continue;
  const issue = await getIssue(n);
  if (issue?.state === 'open') {
    console.error(
      `check-pr-closes-issues: #${n} is open and mentioned without stating intent — add 'Closes #${n}' if this PR resolves it, or 'relates to #${n}' if it doesn't`,
    );
    status = 1;
  }
}

for (const n of closingRefs) {
  const issue = await getIssue(n);
  if (issue?.state !== 'open') continue;
  const open = uncheckedBoxCount(issue.body);
  if (open > 0) {
    console.error(
      `check-pr-closes-issues: this PR closes #${n}, which still has ${open} unticked box(es) — tick what this PR delivers, and split or re-home what it does not, before merging`,
    );
    status = 1;
  }
}

if (status === 0) {
  console.log(
    `check-pr-closes-issues: ${allRefs.length} reference(s), ${closingRefs.length} closing — intent stated, nothing closes with unticked boxes`,
  );
}

process.exit(status);
