#!/usr/bin/env bash
# Every case runs against a throwaway fixture file; nothing reaches the real GitHub API.
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-pr-closes-issues.mjs"

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

fixture() {
  local f; f="$(mktemp)"
  cat > "$f"
  echo "$f"
}

run() { ( unset GITHUB_TOKEN; PR_BODY="$1" ISSUES_JSON="$2" node "$SCRIPT" ) >/dev/null 2>&1; echo $?; }
say() { ( unset GITHUB_TOKEN; PR_BODY="$1" ISSUES_JSON="$2" node "$SCRIPT" ) 2>&1; }

echo "check-pr-closes-issues.mjs"

f=$(fixture <<'EOF'
[{"number":42,"state":"open","body":"n/a"}]
EOF
)
check "a genuinely bare mention of an open issue fails" 1 "$(run "Also touches #42 somehow." "$f")"
check "the failure names the issue and suggests both fixes" \
  1 "$(say "Also touches #42 somehow." "$f" | grep -c "Closes #42.*relates to #42")"
check "'relates to #N' is a stated intent, passes" 0 "$(run "This relates to #42." "$f")"
rm -f "$f"

f=$(fixture <<'EOF'
[{"number":42,"state":"open","body":"n/a"}]
EOF
)
check "'see #N' is a stated intent, passes" 0 "$(run "See #42 for context." "$f")"
rm -f "$f"

f=$(fixture <<'EOF'
[{"number":42,"state":"open","body":"- [x] done\n- [x] also done"}]
EOF
)
check "'Closes #N' on a fully-ticked issue passes" 0 "$(run "Closes #42" "$f")"
rm -f "$f"

f=$(fixture <<'EOF'
[{"number":42,"state":"open","body":"- [ ] not done\n- [x] done"}]
EOF
)
check "'Fixes #N' on an issue with unticked boxes fails" 1 "$(run "Fixes #42" "$f")"
check "the failure names the issue and the count" 1 "$(say "Fixes #42" "$f" | grep -c '#42.*1 unticked')"
rm -f "$f"

f=$(fixture <<'EOF'
[{"number":42,"state":"open","body":"- [ ] not done"}]
EOF
)
check "'Resolves #N' (past tense too) is recognized as closing" 1 "$(run "Resolved #42" "$f")"
rm -f "$f"

f=$(fixture <<'EOF'
[{"number":42,"state":"closed","body":"- [ ] not done"}]
EOF
)
check "closing an already-closed issue (re-land) ignores its boxes" 0 "$(run "Closes #42" "$f")"
check "a bare mention of a closed issue needs no stated intent"     0 "$(run "See also #42." "$f")"
rm -f "$f"

f=$(fixture <<'EOF'
[{"number":42,"state":"open","body":"n/a"}]
EOF
)
check "a number that resolves to nothing (404) is skipped, not failed" 0 "$(run "Also touches #999999." "$f")"
rm -f "$f"

f=$(fixture <<'EOF'
[{"number":42,"state":"open","body":"- [x] done"},{"number":7,"state":"open","body":"n/a"}]
EOF
)
check "one clean close plus one bare violation still fails" 1 "$(run "Closes #42. Also #7 needs a look." "$f")"
check "only the bare one is named"                          1 "$(say "Closes #42. Also #7 needs a look." "$f" | grep -c '^check-pr-closes-issues: #')"
rm -f "$f"

f=$(fixture <<'EOF'
[]
EOF
)
check "an empty PR body trivially passes" 0 "$(run "" "$f")"
rm -f "$f"

f=$(fixture <<'EOF'
[{"number":42,"state":"open","body":"- [x] done"}]
EOF
)
check "'fix' as a substring (prefix #42) is not a closing keyword" 1 "$(run "prefix #42" "$f")"
rm -f "$f"

check "no token and no fixture refuses to run" 1 "$( (unset GITHUB_TOKEN ISSUES_JSON; PR_BODY="Closes #42" node "$SCRIPT") >/dev/null 2>&1; echo $?)"

if [ "$failures" -gt 0 ]; then
  echo "$failures failed"
  exit 1
fi
echo "all passed"
