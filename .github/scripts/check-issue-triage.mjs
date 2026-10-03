#!/usr/bin/env node
import fs from 'node:fs';

const REPO = process.env.GITHUB_REPOSITORY ?? 'adriendellagaspera/copad';

function labelNames(issue) {
  return (issue.labels ?? []).map((label) => typeof label === 'string' ? label : label.name);
}

function dependencyNumbers(body) {
  const numbers = [];
  const pattern = /\b(?:blocked\s+by|depends?\s+on)\b(?:\s*[:|–—-]\s*|\s+)#(\d+)/gi;
  for (const match of (body ?? '').matchAll(pattern)) numbers.push(Number(match[1]));
  return numbers;
}

async function githubJson(path) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required (or set ISSUE_TRIAGE_JSON)');
  const response = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status} for ${path}`);
  return response.json();
}

async function fetchIssues() {
  if (process.env.ISSUE_TRIAGE_JSON) {
    return JSON.parse(fs.readFileSync(process.env.ISSUE_TRIAGE_JSON, 'utf8'));
  }
  const issues = [];
  for (let page = 1; ; page++) {
    const batch = await githubJson(`/issues?state=all&per_page=100&page=${page}`);
    issues.push(...batch.filter((issue) => !issue.pull_request));
    if (batch.length < 100) break;
  }
  const tracking = issues.filter((issue) => issue.state === 'open' && labelNames(issue).includes('type:tracking'));
  const details = await Promise.all(tracking.map((issue) => githubJson(`/issues/${issue.number}`)));
  const detailsByNumber = new Map(details.map((issue) => [issue.number, issue]));
  return issues.map((issue) => detailsByNumber.get(issue.number) ?? issue);
}

let issues;
try {
  issues = await fetchIssues();
} catch (error) {
  console.error(`check-issue-triage: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
const violations = [];

for (const issue of issues) {
  if (issue.state !== 'open') continue;
  const labels = labelNames(issue);

  if (labels.includes('status:blocked')) {
    const dependencies = dependencyNumbers(issue.body);
    const live = dependencies.filter((number) => byNumber.get(number)?.state === 'open');
    if (live.length === 0) {
      violations.push(`#${issue.number} is status:blocked but names no still-open blocker`);
    }
  }

  if (labels.includes('type:tracking')) {
    const summary = issue.sub_issues_summary;
    if (summary?.total > 0 && summary.completed === summary.total) {
      violations.push(`#${issue.number} is type:tracking with all ${summary.total} sub-issues complete`);
    }
  }
}

for (const violation of violations) console.error(`  ${violation}`);
console.log(`check-issue-triage: ${issues.length} issue(s) checked, ${violations.length} finding(s)`);
if (violations.length > 0) process.exit(1);
