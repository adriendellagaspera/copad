// Hold two invariants on every issue: exactly one type:, at least one area:.
//
// A violation re-applies status:needs-triage rather than reporting it, so the
// breach lands in the label strip and in the needs-triage filter — where a
// triager already looks. AGENTS.md reserves comments for humans, so the label
// is the channel; "triaged" becomes derived state rather than a manual claim.
//
// Invoked from .github/workflows/labels.yml via actions/github-script.

const TRIAGE = 'status:needs-triage';

module.exports = async ({ github, context, core }) => {
  const { owner, repo } = context.repo;
  const issue = context.payload.issue;
  if (!issue || issue.pull_request) return;

  const names = issue.labels.map((label) => label.name);
  const types = names.filter((name) => name.startsWith('type:'));
  const areas = names.filter((name) => name.startsWith('area:'));

  const breaches = [];
  if (types.length === 0) breaches.push('no type: label');
  if (types.length > 1) breaches.push(`${types.length} type: labels (${types.join(', ')})`);
  if (areas.length === 0) breaches.push('no area: label');

  const flagged = names.includes(TRIAGE);

  if (breaches.length && !flagged) {
    await github.rest.issues.addLabels({ owner, repo, issue_number: issue.number, labels: [TRIAGE] });
    core.info(`#${issue.number}: ${breaches.join('; ')} — ${TRIAGE} applied.`);
    return;
  }

  if (!breaches.length && flagged) {
    await github.rest.issues.removeLabel({ owner, repo, issue_number: issue.number, name: TRIAGE });
    core.info(`#${issue.number}: type: and area: both set — ${TRIAGE} removed.`);
    return;
  }

  core.info(`#${issue.number}: ${breaches.length ? breaches.join('; ') : 'labels are well-formed'}; nothing to change.`);
};
