// Make GitHub Pages serve the gh-pages branch at / (root).
//
// The branch-based deploy scheme (production + pr-<N>/ previews coexisting on
// gh-pages) only works when Pages' source is the gh-pages branch. Left on the
// default "GitHub Actions" source, every push to gh-pages is silently ignored:
// the live site keeps serving a stale pre-migration artifact, so the root may
// look fine while every /copad/pr-<N>/ preview 404s.
//
// This self-heals that setting on every deploy. Best-effort: it never throws,
// so it can't fail the build — it only warns with the manual fix if the token
// lacks the rights.
//
// Invoked from .github/workflows/deploy.yml via actions/github-script.
module.exports = async ({ github, context, core }) => {
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const source = { branch: 'gh-pages', path: '/' };
  const manual =
    'Set it manually: Settings → Pages → Source = "Deploy from a branch", branch = gh-pages, folder = / (root).';

  try {
    const { data } = await github.rest.repos.getPages({ owner, repo });
    if (
      data.build_type === 'legacy' &&
      data.source &&
      data.source.branch === source.branch &&
      data.source.path === source.path
    ) {
      core.info('Pages already serves gh-pages / (root).');
      return;
    }
    await github.rest.repos.updateInformationAboutPagesSite({
      owner,
      repo,
      build_type: 'legacy',
      source,
    });
    core.info('Switched Pages source to the gh-pages branch / (root).');
  } catch (error) {
    if (error.status === 404) {
      try {
        await github.rest.repos.createPagesSite({
          owner,
          repo,
          build_type: 'legacy',
          source,
        });
        core.info('Enabled Pages on the gh-pages branch / (root).');
        return;
      } catch (createError) {
        core.warning(`Could not enable Pages automatically: ${createError.message}. ${manual}`);
        return;
      }
    }
    core.warning(`Could not configure Pages automatically: ${error.message}. ${manual}`);
  }
};
