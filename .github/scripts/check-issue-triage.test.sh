#!/usr/bin/env bash
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-issue-triage.mjs"

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
  local f
  f="$(mktemp)"
  cat > "$f"
  echo "$f"
}

run() { (unset GITHUB_TOKEN; ISSUE_TRIAGE_JSON="$1" node "$SCRIPT") >/dev/null 2>&1; echo $?; }
say() { (unset GITHUB_TOKEN; ISSUE_TRIAGE_JSON="$1" node "$SCRIPT") 2>&1; }

echo "check-issue-triage.mjs"

f=$(fixture <<'EOF'
[
  {"number":1,"state":"open","labels":[{"name":"status:blocked"}],"body":"Blocked by #2"},
  {"number":2,"state":"closed","labels":[],"body":""}
]
EOF
)
check "blocked issue with a closed blocker fails" 1 "$(run "$f")"
check "blocked finding names the issue" 1 "$(say "$f" | grep -c '#1 is status:blocked')"
rm -f "$f"

f=$(fixture <<'EOF'
[
  {"number":1,"state":"open","labels":[{"name":"status:blocked"}],"body":"Depends on | #2"},
  {"number":2,"state":"open","labels":[],"body":""}
]
EOF
)
check "blocked issue with a live blocker passes" 0 "$(run "$f")"
rm -f "$f"

f=$(fixture <<'EOF'
[
  {"number":3,"state":"open","labels":[{"name":"type:tracking"}],"body":"","sub_issues_summary":{"total":4,"completed":4}}
]
EOF
)
check "tracking issue with all children complete fails" 1 "$(run "$f")"
check "tracking finding names the issue" 1 "$(say "$f" | grep -c '#3 is type:tracking')"
rm -f "$f"

f=$(fixture <<'EOF'
[
  {"number":4,"state":"open","labels":[{"name":"type:tracking"}],"body":"","sub_issues_summary":{"total":4,"completed":3}},
  {"number":5,"state":"open","labels":[{"name":"type:debt"}],"body":""}
]
EOF
)
check "tracking issue with remaining work passes" 0 "$(run "$f")"
rm -f "$f"

check "no token and no fixture refuses to run" 1 "$( (unset GITHUB_TOKEN ISSUE_TRIAGE_JSON; node "$SCRIPT") >/dev/null 2>&1; echo $?)"

if [ "$failures" -gt 0 ]; then
  echo "$failures failed"
  exit 1
fi
echo "all passed"
