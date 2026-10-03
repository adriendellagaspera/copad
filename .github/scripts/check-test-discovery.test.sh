#!/usr/bin/env bash
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-test-discovery.mjs"

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

run_fixture() {
  TEST_DISCOVERY_ROOT="$1" node "$SCRIPT" >/dev/null 2>&1
  echo $?
}

echo "check-test-discovery.mjs"

check "current tree passes" 0 "$(node "$SCRIPT" >/dev/null 2>&1; echo $?)"

tmp=$(mktemp -d)
mkdir -p "$tmp/src" "$tmp/scripts"
cat > "$tmp/src/good.test.ts" <<'EOF'
import { describe, it } from 'vitest';
describe('good', () => { it('runs', () => {}); });
EOF
check "a discoverable *.test.ts passes" 0 "$(run_fixture "$tmp")"

cat > "$tmp/src/missed.spec.ts" <<'EOF'
import { it } from 'vitest';
it('would be skipped', () => {});
EOF
check "a deliberately misnamed *.spec.ts fails" 1 "$(run_fixture "$tmp")"
rm "$tmp/src/missed.spec.ts"

cat > "$tmp/src/helper.ts" <<'EOF'
import { describe } from 'vitest';
describe('hidden test', () => {});
EOF
check "a Vitest import in a non-test filename fails" 1 "$(run_fixture "$tmp")"
rm -rf "$tmp"

if [ "$failures" -gt 0 ]; then
  echo "$failures failed"
  exit 1
fi
echo "all passed"
