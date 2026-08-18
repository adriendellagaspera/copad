#!/bin/bash
set -euo pipefail

# Web only. A local checkout links the hooks itself (README "Git hooks") and
# already has its own node_modules; touching a contributor's own machine from
# a hook they did not ask for is not this script's business.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# A fresh container starts with no node_modules, so lint/check/test — and
# therefore ./pre-push below — can't run at all without this.
npm install

# A fresh container also starts with no .git/hooks symlinks, so
# ./pre-commit/./pre-push silently never fire for an agent unless something
# links them at session start (README "Git hooks"). Best-effort: a missing
# .git/hooks directory (e.g. a non-git checkout) skips rather than fails the
# session — npm install above is the part that actually has to succeed.
if [ -d "$CLAUDE_PROJECT_DIR/.git/hooks" ]; then
  for hook in pre-commit pre-push; do
    link="$CLAUDE_PROJECT_DIR/.git/hooks/$hook"
    if [ ! -L "$link" ] || [ "$(readlink "$link")" != "../../$hook" ]; then
      ln -sf "../../$hook" "$link"
      echo "session-start: linked $hook"
    fi
  done
fi
