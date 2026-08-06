# Copad

This file exists only because Claude Code auto-loads a file with this exact
name. It imports `AGENTS.md` below via `@path` — the pattern Claude Code's own
docs recommend for a repo that already has an `AGENTS.md`
([docs.claude.com/en/docs/memory#agentsmd](https://code.claude.com/docs/en/memory#agentsmd)) —
so the rules load automatically instead of depending on an instruction to go
read them.

**Do not grow this file beyond the import, the three links below, and a
`## Claude Code` section for instructions that would be meaningless to any
other agent** (a plan-mode trigger, a Claude-only tool quirk — there is none
today). Everything else is a rule (→ `AGENTS.md`) or reference (→
`docs/architecture.md`); grow one of those instead, never here. Claude Code's
own guidance targets under 200 lines per `CLAUDE.md`, and an import loads at
launch same as inline content — it does not save context — so that ceiling
applies to `AGENTS.md` too once it's imported here.

@AGENTS.md

The rest is reference material, deliberately **not** imported — large, and
irrelevant to most single tasks, so it's read on demand instead of costing
every session's context regardless of relevance:

- **Architecture reference** (ports/adapters, wiring, env vars, deployment): [`docs/architecture.md`](docs/architecture.md).
- **The contract** (binding, not indicative): [`docs/contract.md`](docs/contract.md) —
  read it before touching presence, the write gate, storage durability, room
  identifiers, or what the editor allows when alone.
- **Product overview, quick start, deployment steps**: [`README.md`](README.md).
