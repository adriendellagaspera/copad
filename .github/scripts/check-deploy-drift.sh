#!/usr/bin/env bash
# Fail when the commit served at the gh-pages root is not main's HEAD.
#
# Deploy failures that announce themselves are already covered: a red run is a
# red run. This exists for the other kind — the run that never happens. Between
# 2026-08-08 and 2026-08-11 every production deploy was cancelled before its
# first step by a jammed concurrency group, and because `cancelled` is not
# `failure`, nothing anywhere turned red while main drifted 65 commits ahead of
# the live site. No step inside a deploy can report a deploy that didn't run.
set -euo pipefail

# A deploy takes a couple of minutes and this can fire mid-run, so a HEAD this
# young is not yet expected to be live.
GRACE_SECONDS="${GRACE_SECONDS:-1800}"

git fetch --quiet origin main gh-pages

head_sha=$(git rev-parse origin/main)
head_age=$(( $(date +%s) - $(git log -1 --format=%ct origin/main) ))

if ! live_json=$(git show origin/gh-pages:version.json 2>/dev/null); then
  echo "::error::gh-pages carries no version.json, so nothing has been published by a deploy since the stamp was added. Production is serving an unknown, older build: run the Deploy workflow (Actions -> Deploy -> Run workflow)."
  exit 1
fi

live_sha=$(printf '%s' "$live_json" | jq -r '.commit')

if [ "$live_sha" = "$head_sha" ]; then
  echo "Live and main agree: $head_sha"
  exit 0
fi

if [ "$head_age" -lt "$GRACE_SECONDS" ]; then
  echo "main moved ${head_age}s ago; its deploy may still be running. Live: $live_sha"
  exit 0
fi

behind=$(git rev-list --count "$live_sha..$head_sha" 2>/dev/null || echo '?')
echo "::error::Production is stale: gh-pages serves $live_sha, main is at $head_sha ($behind commits ahead). Check Actions -> Deploy for runs that were cancelled or stuck queued rather than failed, then re-run the workflow."
exit 1
