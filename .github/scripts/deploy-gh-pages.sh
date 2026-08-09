#!/usr/bin/env bash
# Publish ./dist into gh-pages, under $1 (empty = branch root).
#
# Replaces peaceiris/actions-gh-pages: since PR previews and the production
# deploy no longer share one global concurrency lock (see pr-preview.yml),
# two deploys can race to push gh-pages at once. A plain push would let the
# loser fail outright; this retries with a fresh fetch+worktree each time,
# same pattern the cleanup job in pr-preview.yml already uses.
set -euo pipefail

DEST_DIR="${1:-}"
WORKTREE="gh-pages-worktree"

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git config url."https://x-access-token:${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"

if ! git fetch origin gh-pages 2>/dev/null; then
  echo "gh-pages branch does not exist — creating it"
  git checkout --orphan gh-pages
  git rm -rf . >/dev/null 2>&1 || true
  git commit --allow-empty -m "init gh-pages"
  git push origin gh-pages
  git checkout -
fi

max_attempts=5
for attempt in $(seq 1 "$max_attempts"); do
  git worktree add "$WORKTREE" gh-pages

  publish_path="$WORKTREE${DEST_DIR:+/$DEST_DIR}"
  rm -rf "$publish_path"
  mkdir -p "$publish_path"
  cp -r dist/. "$publish_path/"

  git -C "$WORKTREE" add -A
  if git -C "$WORKTREE" diff --cached --quiet; then
    echo "Nothing changed — skipping deploy"
    git worktree remove "$WORKTREE"
    exit 0
  fi

  git -C "$WORKTREE" commit -m "deploy: ${DEST_DIR:-production} [skip ci]"

  if git -C "$WORKTREE" push origin gh-pages; then
    git worktree remove "$WORKTREE"
    exit 0
  fi

  echo "Push rejected (attempt $attempt/$max_attempts) — retrying"
  git worktree remove "$WORKTREE" --force
  git fetch origin gh-pages
  sleep $((attempt * 3))
done

echo "::error::Failed to push to gh-pages after $max_attempts attempts"
exit 1
