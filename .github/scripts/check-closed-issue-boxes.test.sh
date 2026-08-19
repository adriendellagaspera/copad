#!/usr/bin/env bash
# Every case runs against a throwaway fixture file; nothing reaches the real GitHub API.
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-closed-issue-boxes.mjs"

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

run() { ( unset GITHUB_TOKEN; CLOSED_ISSUES_JSON="$1" node "$SCRIPT" ) >/dev/null 2>&1; echo $?; }
say() { ( unset GITHUB_TOKEN; CLOSED_ISSUES_JSON="$1" node "$SCRIPT" ) 2>&1; }

echo "check-closed-issue-boxes.mjs"

f=$(fixture <<'EOF'
[{"number":1,"title":"all ticked","body":"- [x] a\n- [x] b","closed_at":"2026-01-01T00:00:00Z"}]
EOF
)
check "all-ticked issue passes" 0 "$(run "$f")"
rm -f "$f"

f=$(fixture <<'EOF'
[{"number":2,"title":"no checklist","body":"just prose, no boxes at all","closed_at":"2026-01-01T00:00:00Z"}]
EOF
)
check "issue with no checklist passes" 0 "$(run "$f")"
rm -f "$f"

f=$(fixture <<'EOF'
[{"number":3,"title":"old violation","body":"- [ ] undone","closed_at":"2020-01-01T00:00:00Z"}]
EOF
)
check "violation before BOXES_SINCE is historical, passes" 0 "$(run "$f")"
check "historical violation is still logged"               1 "$(say "$f" | grep -c 'predate the rule')"
rm -f "$f"

f=$(fixture <<'EOF'
[{"number":4,"title":"new violation","body":"- [ ] undone\n- [x] done","closed_at":"2099-01-01T00:00:00Z"}]
EOF
)
check "violation after BOXES_SINCE fails" 1 "$(run "$f")"
check "the failure names the issue"       1 "$(say "$f" | grep -c '#4 closed with 1 unticked')"
rm -f "$f"

f=$(fixture <<'EOF'
[{"number":5,"title":"on the boundary","body":"* [ ] undone","closed_at":"2026-08-19T00:00:00Z"}]
EOF
)
check "closed_at exactly equal to BOXES_SINCE counts as in-scope" 1 "$(BOXES_SINCE=2026-08-19T00:00:00Z run "$f")"
rm -f "$f"

f=$(fixture <<'EOF'
[{"number":6,"title":"widened cutoff","body":"- [ ] undone","closed_at":"2020-01-01T00:00:00Z"}]
EOF
)
check "widening BOXES_SINCE turns historical into a violation" 1 "$(BOXES_SINCE=1970-01-01 run "$f")"
rm -f "$f"

f=$(fixture <<'EOF'
[{"number":7,"title":"prose brackets","body":"the [ ] operator indexes an array, see foo[ ]bar","closed_at":"2099-01-01T00:00:00Z"}]
EOF
)
check "a bracket pair that isn't a GFM checkbox is ignored" 0 "$(run "$f")"
rm -f "$f"

f=$(fixture <<'EOF'
[{"number":10,"title":"box not at line start","body":"see item- [ ] this trails mid-line, not a real box","closed_at":"2099-01-01T00:00:00Z"}]
EOF
)
check "a checkbox-like pattern mid-line (not line-start) is ignored" 0 "$(run "$f")"
rm -f "$f"

f=$(fixture <<'EOF'
[{"number":8,"title":"null body","body":null,"closed_at":"2099-01-01T00:00:00Z"},{"number":9,"title":"missing body key","closed_at":"2099-01-01T00:00:00Z"}]
EOF
)
check "a null or missing body doesn't crash" 0 "$(run "$f")"
rm -f "$f"

check "no token and no fixture refuses to run" 1 "$( (unset GITHUB_TOKEN CLOSED_ISSUES_JSON; node "$SCRIPT") >/dev/null 2>&1; echo $?)"

if [ "$failures" -gt 0 ]; then
  echo "$failures failed"
  exit 1
fi
echo "all passed"
