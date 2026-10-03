Orient before you read. Measured on this repo: `rg -n RoomId` costs ~18.8KB of
output; `rg -c RoomId` or `rg -l RoomId` costs ~2KB — roughly 9x for the same
question ("where, and how much").

- Start with `rg -l <pattern>` (which files) or `rg -c <pattern>` (how many hits
  per file), not `rg -n` or a full `Read`, unless you already know you need every
  matching line.
- `node_modules/`, `dist/`, `docs/api/` are already out of ripgrep's default
  surface (git-ignored); root `.rgignore` excludes tracked `package-lock.json` too.
  Use `rg -u` when a task is intentionally about ignored files such as the lockfile.
- `npm run docs` regenerates a full TypeDoc index (AGENTS.md "Finding things") —
  prefer it over grepping for a symbol's doc comment and exact export shape.
