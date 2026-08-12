#!/usr/bin/env bash
# Every case runs against a throwaway origin in a temp dir; nothing reaches a real remote.
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-gh-pages.sh"
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
export GITHUB_TOKEN=dummy GITHUB_REF_NAME=main

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

# gh-pages starts with production, a stale asset, a version stamp and one preview.
fixture() {
  local dir; dir="$(mktemp -d)"
  (
    cd "$dir" || exit 1
    git init -q --bare origin.git
    git init -q seed && cd seed || exit 1
    git remote add origin "$dir/origin.git"
    echo source > README.md && git add . && git commit -qm init
    git branch -M main && git push -q -u origin main
    git checkout -q --orphan gh-pages && git rm -rqf .
    echo PRODUCTION > index.html
    echo stale > obsolete.js
    printf '{"commit":"old","ref":"main"}\n' > version.json
    mkdir -p pr-42 && echo "preview 42" > pr-42/index.html
    git add . && git commit -qm gh-pages && git push -q -u origin gh-pages
    cd "$dir" && rm -rf seed
    git clone -q -b main origin.git work
    mkdir -p work/dist && echo "NEW BUILD" > work/dist/index.html
  ) >/dev/null 2>&1
  echo "$dir"
}

run() { ( cd "$1/work" && GITHUB_SHA="${SHA:-testsha}" bash "$SCRIPT" "${@:2}" ) >/dev/null 2>&1; echo $?; }
live() { git -C "$1/work" fetch -q origin gh-pages; git -C "$1/work" show "origin/gh-pages:$2" 2>/dev/null || echo "<absent>"; }

echo "deploy-gh-pages.sh"

d=$(fixture)
check "production publish exits 0"            0                                  "$(run "$d" '')"
check "production publish replaces the root"  "NEW BUILD"                        "$(live "$d" index.html)"
check "production publish stamps the commit"  '{"commit":"testsha","ref":"main"}' "$(live "$d" version.json)"
check "production publish keeps previews"     "preview 42"                       "$(live "$d" pr-42/index.html)"
check "production publish sweeps stale files" "<absent>"                         "$(live "$d" obsolete.js)"
check "production publish commits gh-pages"   "deploy: production [skip ci]"     "$(git -C "$d/work" log -1 --format=%s origin/gh-pages)"
# The bug this guards: a deleted worktree .git link sends the commit to the checked-out branch.
check "production publish leaves main alone"  0                                  "$(git -C "$d/work" rev-list --count origin/main..main)"
rm -rf "$d"

d=$(fixture)
check "preview publish exits 0"               0            "$(SHA=prevsha run "$d" pr-77)"
check "preview publish writes its subdir"     "NEW BUILD"  "$(live "$d" pr-77/index.html)"
check "preview publish leaves the root"       "PRODUCTION" "$(live "$d" index.html)"
rm -rf "$d"

d=$(fixture)
run "$d" '' >/dev/null
before=$(git -C "$d/work" rev-parse origin/gh-pages)
check "republishing the same build is a no-op" 0        "$(run "$d" '')"
check "no-op pushes no commit"                 "$before" "$(live "$d" version.json >/dev/null; git -C "$d/work" rev-parse origin/gh-pages)"
rm -rf "$d"

d=$(fixture)
check "--remove exits 0"                    0                            "$(run "$d" pr-42 --remove)"
check "--remove deletes the preview"        "<absent>"                   "$(live "$d" pr-42/index.html)"
check "--remove keeps production"           "PRODUCTION"                 "$(live "$d" index.html)"
check "--remove keeps the version stamp"    '{"commit":"old","ref":"main"}' "$(live "$d" version.json)"
check "--remove names the removal"          "cleanup: remove pr-42 [skip ci]" "$(git -C "$d/work" log -1 --format=%s origin/gh-pages)"
check "--remove on an absent dir is a no-op" 0                           "$(run "$d" pr-42 --remove)"
rm -rf "$d"

d=$(fixture)
check "--remove refuses an empty dir"    1            "$(run "$d" '' --remove)"
check "refusing leaves production"       "PRODUCTION" "$(live "$d" index.html)"
check "an unknown mode is refused"       1            "$(run "$d" pr-42 --bogus)"
check "refusing leaves the preview"      "preview 42" "$(live "$d" pr-42/index.html)"
rm -rf "$d"

# A competing push lands between our worktree and our push, so attempt 1 is
# genuinely rejected and the retry has to rebuild on the new tip.
d=$(fixture)
git clone -q -b gh-pages "$d/origin.git" "$d/rival" 2>/dev/null
cat > "$d/work/.git/hooks/pre-push" <<HOOK
#!/usr/bin/env bash
[ -f "$d/raced" ] && exit 0
touch "$d/raced"
cd "$d/rival" && mkdir -p pr-99 && echo "preview 99" > pr-99/index.html
git add -A && git commit -qm "rival" && git push -q origin gh-pages
HOOK
chmod +x "$d/work/.git/hooks/pre-push"
check "a lost push race still deploys"      0            "$(run "$d" '')"
check "the retry publishes the build"       "NEW BUILD"  "$(live "$d" index.html)"
check "the retry rebuilds on the new tip"   "rival"      "$(git -C "$d/work" log --format=%s origin/gh-pages | sed -n 2p)"
check "the retry keeps the other's preview" "preview 99" "$(live "$d" pr-99/index.html)"
rm -rf "$d"

if [ "$failures" -gt 0 ]; then
  echo "$failures failed"
  exit 1
fi
echo "all passed"
