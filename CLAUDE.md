# Copad

This file exists only because Claude Code auto-loads a file with this exact
name — nothing here is Claude-specific. It imports `AGENTS.md` below via
Claude Code's `@path` memory-import syntax, so the rules load automatically
instead of depending on an instruction to go read them.

@AGENTS.md

The rest is reference material, deliberately **not** imported — large, and
irrelevant to most single tasks, so it's read on demand instead of costing
every session's context regardless of relevance:

- **Architecture reference** (ports/adapters, wiring, env vars, deployment): [`docs/architecture.md`](docs/architecture.md).
- **The contract** (binding, not indicative): [`docs/contract.md`](docs/contract.md) —
  read it before touching presence, the write gate, storage durability, room
  identifiers, or what the editor allows when alone.
- **Product overview, quick start, deployment steps**: [`README.md`](README.md).
