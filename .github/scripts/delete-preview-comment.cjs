// Delete the "Preview deployed" comment when a PR closes, so no link to the
// removed preview directory is left behind.
//
// Invoked from .github/workflows/pr-preview.yml via actions/github-script.
const MARKER = '<!-- gh-pages-preview -->';

module.exports = async ({ github, context }) => {
  const pr = context.payload.pull_request.number;

  const { data: comments } = await github.rest.issues.listComments({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: pr,
  });

  const existing = comments.find((c) => c.body && c.body.includes(MARKER));
  if (existing) {
    await github.rest.issues.deleteComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      comment_id: existing.id,
    });
  }
};
