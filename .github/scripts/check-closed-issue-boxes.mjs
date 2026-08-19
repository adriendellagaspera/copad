#!/usr/bin/env node
// Scheduled audit: a closed issue must carry no unticked acceptance-checklist
// box. Every copad issue template ships `- [ ]` acceptance criteria
// (bug_report.yml, enhancement.yml, spike.yml, decision.yml); nothing checked
// whether a closed issue left any unticked, so a half-delivered bundle can
// close `completed` with undone rows buried in the body. Mirrors
// reconcile-rs's check-issue-triage.sh rule 7 — and is the mechanism that
// makes bundling separable work into one issue *visible* (AGENTS.md "Filing
// issues").
//
// Bounded by BOXES_SINCE: an issue closed before this check existed predates
// the rule and can't honestly be back-filled — ticking a box on a closed
// issue to satisfy a linter records work as done that nobody verified. Those
// are counted as history, not named.
//
// Live mode calls the GitHub REST API (GITHUB_TOKEN + GITHUB_REPOSITORY, as
// Actions sets by default). CLOSED_ISSUES_JSON points at a captured payload
// instead (an array of {number, title, body, closed_at}), so the rule can be
// exercised against a fixture without a network round trip or a token.
import fs from 'node:fs';

const REPO = process.env.GITHUB_REPOSITORY ?? 'adriendellagaspera/copad';
const BOXES_SINCE = process.env.BOXES_SINCE ?? '2026-08-19';

async function fetchClosedIssues() {
  if (process.env.CLOSED_ISSUES_JSON) {
    return JSON.parse(fs.readFileSync(process.env.CLOSED_ISSUES_JSON, 'utf8'));
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('check-closed-issue-boxes: GITHUB_TOKEN is required (or set CLOSED_ISSUES_JSON)');
    process.exit(1);
  }
  const issues = [];
  for (let page = 1; ; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/issues?state=closed&per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) {
      console.error(`check-closed-issue-boxes: GitHub API returned ${res.status}`);
      process.exit(1);
    }
    const batch = await res.json();
    issues.push(...batch.filter((i) => !i.pull_request)); // the issues endpoint also returns PRs
    if (batch.length < 100) break;
  }
  return issues;
}

function uncheckedBoxCount(body) {
  return [...(body ?? '').matchAll(/^[ \t]*[-*][ \t]+\[ \]/gm)].length;
}

const issues = await fetchClosedIssues();

let violations = 0;
let historical = 0;
for (const issue of issues) {
  const open = uncheckedBoxCount(issue.body);
  if (open === 0) continue;
  const closedAt = issue.closed_at ?? issue.closedAt ?? '';
  if (closedAt >= BOXES_SINCE) {
    violations++;
    console.error(`  #${issue.number} closed with ${open} unticked box(es) — ${issue.title}`);
  } else {
    historical++;
  }
}

if (historical > 0) {
  console.log(`  · ${historical} issue(s) closed before ${BOXES_SINCE} carry unticked boxes — predate the rule, not gated`);
}
console.log(`check-closed-issue-boxes: ${issues.length} closed issues checked, ${violations} violation(s), ${historical} historical`);

if (violations > 0) {
  console.error('');
  console.error('A closed issue left acceptance boxes unticked — split it (the undone rows');
  console.error('become a new issue) or tick what was actually verified against the tree.');
  process.exit(1);
}
