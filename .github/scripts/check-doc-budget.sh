#!/usr/bin/env bash
# AGENTS.md + CLAUDE.md must stay at or under 200 lines together: CLAUDE.md opens
# with @AGENTS.md, so a reader gets the sum.
#
# docs/architecture.md and docs/contract.md are budgeted separately from that
# pair, and separately from each other: neither is imported into AGENTS.md or
# read every session the way AGENTS.md+CLAUDE.md are (CLAUDE.md: each is read
# situationally, "as [things] become relevant" / before touching what
# docs/contract.md governs) — a combined cap would either starve one doc or
# let the other's growth hide behind it. Same shape as reconcile-rs's SOTA.md
# cap: a durable reference still isn't unbounded, and raising a cap stays a
# deliberate, visible decision rather than silent drift.
set -Eeuo pipefail

AGENTS_MAX_LINES=200
ARCHITECTURE_MAX_LINES=400
CONTRACT_MAX_LINES=420

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR/../.."

status=0

echo "AGENTS.md + CLAUDE.md (cumulative, read in full every session):"
total=0
for f in AGENTS.md CLAUDE.md; do
    n=$(wc -l <"$f")
    printf '  %-21s %4d\n' "$f" "$n"
    total=$((total + n))
done
printf '  %-21s %4d / %d\n' "total" "$total" "$AGENTS_MAX_LINES"
if [ "$total" -gt "$AGENTS_MAX_LINES" ]; then
    echo >&2
    echo "check-doc-budget: AGENTS.md + CLAUDE.md are $total lines, over the $AGENTS_MAX_LINES-line budget by $((total - AGENTS_MAX_LINES))." >&2
    echo "Move prose to docs/architecture.md rather than compressing it." >&2
    status=1
fi

echo
echo "Reference docs (read situationally, each capped on its own):"
check_doc() {
    local f=$1 max=$2 n
    n=$(wc -l <"$f")
    printf '  %-21s %4d / %d\n' "$f" "$n" "$max"
    if [ "$n" -gt "$max" ]; then
        echo >&2
        echo "check-doc-budget: $f is $n lines, over its $max-line budget by $((n - max))." >&2
        echo "Either trim it, or raise the cap in this script and say why in the commit." >&2
        status=1
    fi
}
check_doc docs/architecture.md "$ARCHITECTURE_MAX_LINES"
check_doc docs/contract.md "$CONTRACT_MAX_LINES"

exit "$status"
