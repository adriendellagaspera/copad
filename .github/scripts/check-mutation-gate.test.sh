#!/usr/bin/env bash
# Exercises the diff-to---mutate-range parser in isolation (PRINT_ONLY + DIFF_TEXT_FILE): a
# synthetic diff in, the computed --mutate argument out, no git repo and no real Stryker run
# needed. Actually invoking Stryker per case would make this suite minutes long for no extra
# coverage of the part that's actually novel here — the range arithmetic.
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-mutation-gate.mjs"

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

run() { PRINT_ONLY=1 DIFF_TEXT_FILE="$1" node "$SCRIPT" 2>/dev/null | tail -1; }

echo "check-mutation-gate.mjs"

f=$(fixture <<'EOF'
diff --git a/src/foo.ts b/src/foo.ts
index 1111111..2222222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -10,7 +10,9 @@ export function foo() {
   const a = 1;
   const b = 2;
-  return a + b;
+  const c = 3;
+  return a + b + c;
 }

 export function bar() {
EOF
)
check "two consecutive added lines collapse into one range" "src/foo.ts:12-13" "$(run "$f")"
rm -f "$f"

f=$(fixture <<'EOF'
diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,2 +1,2 @@
-const a = 1;
+const a = 2;
 const b = 1;
@@ -10,2 +10,3 @@
 const c = 1;
+const d = 2;
 const e = 1;
EOF
)
check "two separate hunks in one file produce two ranges" "src/foo.ts:1-1,src/foo.ts:11-11" "$(run "$f")"
rm -f "$f"

f=$(fixture <<'EOF'
diff --git a/src/foo.test.ts b/src/foo.test.ts
--- a/src/foo.test.ts
+++ b/src/foo.test.ts
@@ -1,1 +1,2 @@
+import { foo } from './foo.js';
 import { describe } from 'vitest';
EOF
)
check "a .test.ts-only diff yields nothing to mutate" "" "$(run "$f")"
rm -f "$f"

f=$(fixture <<'EOF'
diff --git a/src/bar.svelte b/src/bar.svelte
--- a/src/bar.svelte
+++ b/src/bar.svelte
@@ -1,2 +1,3 @@
 <script>
+  let x = 1;
 </script>
EOF
)
check "a .svelte-only diff yields nothing to mutate" "" "$(run "$f")"
rm -f "$f"

f=$(fixture <<'EOF'
diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 1;
+const b = 2;
 const c = 1;
EOF
)
check "a pure removal-then-addition (same line) reports the new line, not the old" "src/foo.ts:2-2" "$(run "$f")"
rm -f "$f"

f=$(fixture <<'EOF'
diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,1 @@
 const a = 1;
-const b = 1;
-const c = 1;
EOF
)
check "a pure deletion (no added lines) yields nothing to mutate" "" "$(run "$f")"
rm -f "$f"

f=$(fixture <<'EOF'
diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,2 @@
 const a = 1;
+const b = 2;
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -5,1 +5,2 @@
 const c = 1;
+const d = 2;
EOF
)
check "multiple files each get their own entry" "src/a.ts:2-2,src/b.ts:6-6" "$(run "$f")"
rm -f "$f"

f=$(fixture <<'EOF'
EOF
)
check "an empty diff yields nothing to mutate" "" "$(run "$f")"
rm -f "$f"

if [ "$failures" -gt 0 ]; then
  echo "$failures failed"
  exit 1
fi
echo "all passed"
