// Post (or update) the "Preview deployed" comment on a PR with its preview URL.
//
// Idempotent: a hidden marker identifies our comment, so repeated pushes update
// the same comment instead of stacking new ones.
//
// Invoked from .github/workflows/pr-preview.yml via actions/github-script.
const MARKER = '<!-- gh-pages-preview -->';

module.exports = async ({ github, context }) => {
  const pr = context.payload.pull_request.number;
  const sha = context.payload.pull_request.head.sha.slice(0, 7);
  const url = `https://adriendellagaspera.github.io/copad/pr-${pr}/`;
  const body = [
    MARKER,
    '### Preview deployed',
    '',
    `**URL:** ${url}`,
    `**Commit:** \`${sha}\``,
    '',
    '_Updated automatically on every push to this PR. Removed when the PR closes._',
    '_It may take a minute for GitHub Pages to reflect a fresh deployment._',
  ].join('\n');

  const { data: comments } = await github.rest.issues.listComments({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: pr,
  });

  const existing = comments.find((c) => c.body && c.body.includes(MARKER));
  if (existing) {
    await github.rest.issues.updateComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      comment_id: existing.id,
      body,
    });
  } else {
    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: pr,
      body,
    });
  }
};
