#!/usr/bin/env bash
# Publish ./dist into gh-pages under $1 (empty = branch root); with --remove as
# $2, delete $1 from gh-pages instead.
#
# Replaces peaceiris/actions-gh-pages. Production and the PR previews no longer
# share one concurrency lock (see pr-preview.yml), so two writers can reach for
# gh-pages at once and a plain push lets the loser fail outright. Every mutation
# of the branch goes through the one fetch+worktree+push retry below — which is
# why removal lives here rather than open-coded in the workflow that wants it.
set -euo pipefail

DEST_DIR="${1:-}"
MODE="${2:-publish}"
WORKTREE="gh-pages-worktree"

case "$MODE" in
  publish) ;;
  --remove)
    # Empty here would mean "remove the branch root", i.e. delete production.
    [ -n "$DEST_DIR" ] || { echo "::error::--remove needs a directory"; exit 1; }
    ;;
  *) echo "::error::unknown mode: $MODE (expected --remove)"; exit 1 ;;
esac

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git config url."https://x-access-token:${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"

if ! git fetch origin gh-pages 2>/dev/null; then
  if [ "$MODE" = --remove ]; then
    echo "gh-pages branch does not exist — nothing to remove"
    exit 0
  fi
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

  if [ "$MODE" = --remove ]; then
    rm -rf "$WORKTREE/$DEST_DIR"
  else
    if [ -n "$DEST_DIR" ]; then
      publish_path="$WORKTREE/$DEST_DIR"
      rm -rf "$publish_path"
      mkdir -p "$publish_path"
    else
      publish_path="$WORKTREE"
      # Clear the root in place. `rm -rf` on the worktree itself takes its .git
      # link with it; git then resolves to the parent repo, so `add`/`commit` land
      # the site on the checked-out branch while `push origin gh-pages` reports
      # "Everything up-to-date" and publishes nothing. Skipping pr-<N>/ keeps the
      # previews that share this branch, which a root-level wipe would take too.
      find "$WORKTREE" -mindepth 1 -maxdepth 1 \
        -not -name '.git' -not -name 'pr-*' -exec rm -rf {} +
    fi
    cp -r dist/. "$publish_path/"

    # What is actually live, readable without replaying workflow history. Nothing
    # else records it, which is why production could sit three days behind main
    # unnoticed; check-deploy-drift.sh reads this. Commit only, no timestamp, so
    # re-publishing an unchanged commit still hits the no-op path below.
    printf '{"commit":"%s","ref":"%s"}\n' \
      "${GITHUB_SHA:-unknown}" "${GITHUB_REF_NAME:-unknown}" > "$publish_path/version.json"
  fi

  git -C "$WORKTREE" add -A
  # Also the "preview directory was already gone" case under --remove.
  if git -C "$WORKTREE" diff --cached --quiet; then
    echo "Nothing changed — skipping"
    git worktree remove "$WORKTREE"
    exit 0
  fi

  if [ "$MODE" = --remove ]; then
    git -C "$WORKTREE" commit -m "cleanup: remove $DEST_DIR [skip ci]"
  else
    git -C "$WORKTREE" commit -m "deploy: ${DEST_DIR:-production} [skip ci]"
  fi

  if git -C "$WORKTREE" push origin gh-pages; then
    git worktree remove "$WORKTREE"
    exit 0
  fi

  echo "Push rejected (attempt $attempt/$max_attempts) — retrying"
  git worktree remove "$WORKTREE" --force
  git fetch origin gh-pages
  # Fetch moves origin/gh-pages, never the local branch the next worktree checks
  # out. Without this the retry rebuilds on the same stale tip and every attempt
  # is rejected for the reason the first one was.
  git branch -f gh-pages origin/gh-pages
  sleep $((attempt * 3))
done

echo "::error::Failed to push to gh-pages after $max_attempts attempts"
exit 1
