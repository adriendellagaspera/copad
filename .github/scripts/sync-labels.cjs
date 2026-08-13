// Make GitHub's labels match .github/labels.cjs, and prune what that file dropped.
//
// Invoked from .github/workflows/labels.yml via actions/github-script.
// LABELS_APPLY=false plans without mutating; LABELS_PRUNE=false keeps strays.

const desired = require('../labels.cjs');

const FACETS = ['type:', 'area:', 'status:', 'surface:'];
const UNPREFIXED = ['good first issue'];

function validate(labels, core) {
  const problems = [];
  const seen = new Set();

  for (const label of labels) {
    const { name, color, description } = label;
    if (!name) problems.push(`a label has no name: ${JSON.stringify(label)}`);
    if (seen.has(name)) problems.push(`${name}: declared twice`);
    seen.add(name);
    if (!/^[0-9a-f]{6}$/.test(color ?? '')) problems.push(`${name}: color must be six lowercase hex digits`);
    if (!description) problems.push(`${name}: needs a description — it is what a triager reads in the picker`);
    if (!FACETS.some((f) => name.startsWith(f)) && !UNPREFIXED.includes(name)) {
      problems.push(`${name}: not on a facet (${FACETS.join(' ')}) and not an allowed unprefixed label`);
    }
  }

  if (problems.length) {
    for (const problem of problems) core.error(problem);
    throw new Error(`.github/labels.cjs is invalid (${problems.length} problem(s)).`);
  }
}

module.exports = async ({ github, context, core }) => {
  const { owner, repo } = context.repo;
  const apply = process.env.LABELS_APPLY !== 'false';
  const prune = process.env.LABELS_PRUNE !== 'false';

  validate(desired, core);

  const existing = await github.paginate(github.rest.issues.listLabelsForRepo, { owner, repo, per_page: 100 });
  const byName = new Map(existing.map((label) => [label.name, label]));
  const wanted = new Set(desired.map((label) => label.name));

  const created = [];
  const updated = [];
  const deleted = [];

  for (const { name, color, description } of desired) {
    const current = byName.get(name);
    if (!current) {
      created.push(name);
      if (apply) await github.rest.issues.createLabel({ owner, repo, name, color, description });
      continue;
    }
    if (current.color !== color || (current.description ?? '') !== description) {
      updated.push(name);
      if (apply) await github.rest.issues.updateLabel({ owner, repo, name, color, description });
    }
  }

  if (prune) {
    for (const label of existing) {
      if (wanted.has(label.name)) continue;
      deleted.push(label.name);
      if (apply) await github.rest.issues.deleteLabel({ owner, repo, name: label.name });
    }
  }

  const verb = apply ? '' : 'would be ';
  const summary = [
    `created: ${created.length ? `${verb}${created.join(', ')}` : 'none'}`,
    `updated: ${updated.length ? `${verb}${updated.join(', ')}` : 'none'}`,
    `deleted: ${deleted.length ? `${verb}${deleted.join(', ')}` : 'none'}`,
  ].join('\n');

  core.info(summary);
  await core.summary.addHeading('Label sync', 3).addCodeBlock(summary).write();
};
