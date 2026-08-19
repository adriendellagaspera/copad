#!/usr/bin/env bash
# Every case runs against a throwaway tmp tree shaped like the real repo (docs/architecture.md,
# src/storage/index.ts, src/collaboration/*.ts, src/format/index.ts), not the real repo's own
# files — the script's job is validating *this* repo's actual content, which pre-commit/CI already
# exercise for real on every run; this suite tests the parsing logic in isolation instead of
# re-asserting facts about the real diagram, which would drift the moment the diagram legitimately
# changes.
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-architecture-diagram.mjs"

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

tree() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/docs" "$d/src/storage" "$d/src/collaboration" "$d/src/format"
  cat > "$d/docs/architecture.md" <<'EOF'
```mermaid
flowchart TB
    Storage --> A1["alpha · beta"]
    Collab --> A2["gammaCollab"]
    RoomAccess --> A3["deltaAccess"]
    Codec --> A4["epsilon · zeta"]
```
EOF
  cat > "$d/src/storage/index.ts" <<'EOF'
import { alphaStorage } from './alpha.js';
import { betaStorage } from './beta.js';
EOF
  cat > "$d/src/collaboration/gamma.ts" <<'EOF'
export function gammaCollab(opts) { return opts; }
EOF
  cat > "$d/src/collaboration/delta.ts" <<'EOF'
export function deltaAccess(): RoomAccess {
  return {};
}
EOF
  # exportCodecs declared *before* codecs, and with an extra entry codecs lacks: a ground-truth
  # extractor that matches "Codec[]" without requiring the "codecs:" field name (or that just takes
  # the first "Codec[]..." occurrence in the file) picks up thetaCodec here — wrong port, wrong set.
  cat > "$d/src/format/index.ts" <<'EOF'
export const exportCodecs: ExportCodec[] = [epsilonCodec, zetaCodec, thetaCodec];
export const codecs: Codec[] = [epsilonCodec, zetaCodec];
EOF
  echo "$d"
}

run() { ( cd "$1" && node "$SCRIPT" ) >/dev/null 2>&1; echo $?; }
say() { ( cd "$1" && node "$SCRIPT" ) 2>&1; }

echo "check-architecture-diagram.mjs"

d=$(tree)
check "a matching diagram and codebase passes" 0 "$(run "$d")"
rm -rf "$d"

d=$(tree)
sed -i.bak 's/alpha · beta/alpha · beta · faketon/' "$d/docs/architecture.md"
check "a diagram edge with no real adapter fails" 1 "$(run "$d")"
check "the failure names the fake edge"           1 "$(say "$d" | grep -c "'faketon'.*doesn't have")"
rm -rf "$d"

d=$(tree)
sed -i.bak 's/alpha · beta/alpha/' "$d/docs/architecture.md"
check "a real adapter missing from the diagram fails" 1 "$(run "$d")"
check "the failure names the missing adapter"          1 "$(say "$d" | grep -c "'beta'.*doesn't draw it")"
rm -rf "$d"

d=$(tree)
sed -i.bak "s/import { betaStorage } from '.\/beta.js';//" "$d/src/storage/index.ts"
check "a diagram edge with a now-removed adapter fails" 1 "$(run "$d")"
rm -rf "$d"

d=$(tree)
sed -i.bak "s/export function gammaCollab.*/&\\nexport function etaCollab(opts) { return opts; }/" "$d/src/collaboration/gamma.ts"
check "a new Collab adapter not yet drawn fails" 1 "$(run "$d")"
rm -rf "$d"

d=$(tree)
check "exportCodecs (declared before codecs, with an extra entry) isn't mistaken for it" 0 "$(run "$d")"
rm -rf "$d"

d=$(tree)
rm "$d/docs/architecture.md"
check "a missing architecture doc is refused, not silently skipped" 1 "$(run "$d")"
rm -rf "$d"

if [ "$failures" -gt 0 ]; then
  echo "$failures failed"
  exit 1
fi
echo "all passed"
