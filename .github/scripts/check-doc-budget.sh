#!/usr/bin/env bash
# AGENTS.md + CLAUDE.md must stay at or under 200 lines together: CLAUDE.md opens
# with @AGENTS.md, so a reader gets the sum.
set -Eeuo pipefail

MAX_LINES=200
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR/../.."

BUDGETED_FILES=(AGENTS.md CLAUDE.md)

total=0
for f in "${BUDGETED_FILES[@]}"; do
    n=$(wc -l <"$f")
    printf '  %-12s %4d\n' "$f" "$n"
    total=$((total + n))
done

printf '  %-12s %4d / %d\n' "total" "$total" "$MAX_LINES"

if [ "$total" -gt "$MAX_LINES" ]; then
    echo >&2
    echo "check-doc-budget: AGENTS.md + CLAUDE.md are $total lines, over the $MAX_LINES-line budget by $((total - MAX_LINES))." >&2
    echo "Move prose to docs/architecture.md rather than compressing it." >&2
    exit 1
fi
