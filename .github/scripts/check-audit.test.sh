#!/usr/bin/env bash
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-audit.mjs"
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

run() { AUDIT_JSON="$1" AUDIT_NOW="$2" node "$SCRIPT" >/dev/null 2>&1; echo $?; }

echo "check-audit.mjs"

f=$(fixture <<'EOF'
{"vulnerabilities":{"braces":{"severity":"high","via":[{"source":123,"name":"braces","dependency":"braces","title":"stack exhaustion","url":"https://github.com/advisories/GHSA-vfj7-8cjw-p6xm","severity":"high"}]},"pcloud-sdk-js":{"severity":"high","via":["@babel/cli"]}},"metadata":{"vulnerabilities":{"high":2,"critical":0}}}
EOF
)
check "exact braces advisory passes before review date" 0 "$(run "$f" 2026-10-03)"
check "braces exception expires" 1 "$(run "$f" 2026-10-18)"
rm -f "$f"

f=$(fixture <<'EOF'
{"vulnerabilities":{"other":{"severity":"high","via":[{"source":456,"name":"other","dependency":"other","title":"different high","url":"https://github.com/advisories/GHSA-aaaa-bbbb-cccc","severity":"high"}]}},"metadata":{"vulnerabilities":{"high":1,"critical":0}}}
EOF
)
check "unrelated high advisory still fails" 1 "$(run "$f" 2026-10-03)"
rm -f "$f"

f=$(fixture <<'EOF'
{"vulnerabilities":{"other":{"severity":"high","via":[{"source":123,"name":"other","dependency":"other","title":"same id wrong package","url":"https://github.com/advisories/GHSA-vfj7-8cjw-p6xm","severity":"high"}]}},"metadata":{"vulnerabilities":{"high":1,"critical":0}}}
EOF
)
check "exception is package-specific" 1 "$(run "$f" 2026-10-03)"
rm -f "$f"

f=$(fixture <<'EOF'
{"vulnerabilities":{"moderate":{"severity":"moderate","via":[{"source":789,"name":"moderate","dependency":"moderate","title":"moderate advisory","url":"https://github.com/advisories/GHSA-dddd-eeee-ffff","severity":"moderate"}]}},"metadata":{"vulnerabilities":{"moderate":1,"high":0,"critical":0}}}
EOF
)
check "moderate advisory remains non-fatal" 0 "$(run "$f" 2026-10-03)"
rm -f "$f"

if [ "$failures" -gt 0 ]; then
  echo "$failures failed"
  exit 1
fi
echo "all passed"
