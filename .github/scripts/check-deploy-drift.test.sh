#!/usr/bin/env bash
# Every case runs against a throwaway origin in a temp dir; nothing reaches a real remote.
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-deploy-drift.sh"
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com

failures=0
check() {
  if [ "$2" = "$3" ]; then
    echo "  ok   $1"
  else
    echo "  FAIL $1"
    echo "         expected: $2"
    echo "         actual:   $3"
    failures=$((failures + 1))
  fi
}

# main holds three commits aged two hours; $1 is what gh-pages claims is live
# ("none" publishes no version.json at all).
fixture() {
  local live_ref="$1" dir; dir="$(mktemp -d)"
  local old; old=$(( $(date +%s) - 7200 ))
  (
    cd "$dir" || exit 1
    git init -q --bare origin.git
    git init -q seed && cd seed || exit 1
    git remote add origin "$dir/origin.git"
    for i in 1 2 3; do
      echo "$i" > "f$i"
      git add .
      GIT_AUTHOR_DATE="$old +0000" GIT_COMMITTER_DATE="$old +0000" git commit -qm "c$i"
    done
    git branch -M main && git push -q -u origin main
    local sha
    case "$live_ref" in
      head) sha=$(git rev-parse main) ;;
      behind) sha=$(git rev-parse main~2) ;;
      none) sha="" ;;
    esac
    git checkout -q --orphan gh-pages && git rm -rqf .
    echo built > index.html
    [ -n "$sha" ] && printf '{"commit":"%s","ref":"main"}\n' "$sha" > version.json
    git add -A && git commit -qm gh-pages && git push -q -u origin gh-pages
    cd "$dir" && rm -rf seed
    git clone -q -b main origin.git work
  ) >/dev/null 2>&1
  echo "$dir"
}

run() { ( cd "$1/work" && shift && "$@" bash "$SCRIPT" ) >/dev/null 2>&1; echo $?; }
say() { ( cd "$1/work" && bash "$SCRIPT" ) 2>&1 | tail -1; }

echo "check-deploy-drift.sh"

d=$(fixture head)
check "live at main HEAD passes" 0 "$(run "$d")"
rm -rf "$d"

d=$(fixture behind)
check "live behind a settled main fails" 1 "$(run "$d")"
check "the error counts the gap"         1 "$(say "$d" | grep -c '2 commits ahead')"
rm -rf "$d"

# A deploy for a just-pushed commit may still be running.
d=$(fixture behind)
( cd "$d/work" && echo fresh > fresh.txt && git add -A && git commit -qm fresh && git push -q origin main ) >/dev/null 2>&1
check "a just-moved main is still in grace" 0 "$(run "$d")"
check "past the grace window it fails"      1 "$(run "$d" env GRACE_SECONDS=0)"
rm -rf "$d"

d=$(fixture none)
check "an unstamped gh-pages fails" 1 "$(run "$d")"
rm -rf "$d"

if [ "$failures" -gt 0 ]; then
  echo "$failures failed"
  exit 1
fi
echo "all passed"
