# Copad — rules for AI agents

**Keep this file lean.** `CLAUDE.md`'s `@AGENTS.md` imports it wholesale into every session, and an import costs
the same context as inline content — hence the line budget (`npm run check:doc-budget`). Add a rule only if it
is general and relevant on nearly every task; anything narrower belongs in an in-code comment (see Comments) or
in `docs/architecture.md`.

## Commands

- `npm run lint` — ESLint; enforces the gated rules below.
- `npm run check` — svelte-check; type-checks `.svelte` and `.ts`.
- `npm test` — vitest, the full unit suite.
- `npm run test:scripts` — bash suites for the gh-pages deploy scripts.
- `npm run build` — production build.
- `npm run docs` — regenerates the API reference into `docs/api/` (git-ignored).
- `npm run check:doc-budget` — fails if `AGENTS.md`+`CLAUDE.md` exceed 200 combined, or
  `docs/architecture.md`/`docs/contract.md` exceed their own separate caps.
- `npm run check:audit` / `check:licenses` — dependency advisories (high/critical fail the build) and a license
  allowlist; gated in CI, not part of the local lint/check/test loop.
- `npm run check:closed-issue-boxes` — scheduled audit, not part of the local loop: a closed issue must carry no
  unticked acceptance box (`BOXES_SINCE` in the script exempts issues closed before the rule existed).
- `npm run check:doc-structure` — every doc link/anchor resolves, and every `contract §N.M` citation (docs and
  `src/` comments alike) names a real section.
- `npm run check:mutation-gate` — Stryker on PR-diff `.ts` lines only (`stryker.config.mjs`); a surviving mutant
  means the tests ran the changed code but didn't check it. CI-only, not in the local loop.
- `npm run check:pr-closes-issues` — PR-body only, not the local loop: every open issue mentioned bare must
  state intent (`Closes`/`relates to`), and one this PR closes must have no unticked box.
- `npm run format:md:check` — Prettier (printWidth 112, proseWrap always) on the five docs above; `format:md`
  fixes it. Comment line length in code is a separate ESLint rule (see Comments).
- `npm run dev` — Vite dev server; needs `npm run signaling` (WebRTC, default) or `npm run collab` (WebSocket
  transport) running alongside it for collaboration to work locally.

`check:doc-budget`/`check:doc-structure`/`lint`/`check`/`test` are gated automatically
([`./pre-commit`](./pre-commit), [`./pre-push`](./pre-push)) — never run them by hand first, that only re-plays
a check a hook already owns. `test:scripts` isn't hooked: run it yourself when you touch `.github/scripts/`.
`ci.yml` (triggered by the push itself) is the superset — everything above plus `check:audit`/`check:licenses`,
`build`, and the Playwright `e2e` suite.

## The contract comes first

- **Every fact lives in exactly one place; everywhere else links to it.** A restatement is a second copy that
  drifts, and the drifted copy is read as true. Governs code comments, docs, issues and PRs alike.
- One subject per issue — prefer `type:tracking` + linked sub-issues over bundling separable work (not
  mechanically gated; a scheduled audit flags a closed issue with unticked boxes, which is what bundling
  produces when it fails).
- [`docs/contract.md`](docs/contract.md) is **binding, not indicative**. Read it before changing anything about
  presence, the write gate, storage durability, room identifiers, or what the editor allows when alone.
- Changing behaviour it describes means updating it **in the same commit**; the same holds for
  [`docs/architecture.md`](docs/architecture.md) and `README.md`. These files brief every agent, so a stale line
  propagates into work that was never wrong on purpose.

## Type system rules

- Use the branded-string pattern for every domain concept that is a primitive at runtime:
  `type RoomId = string & { readonly _brand: 'RoomId' }`.
- Never pass a bare `string`, `number`, or `boolean` at an internal function boundary. Internal code uses named
  types everywhere: parameters, return types, object fields, Svelte `$props()`. (Not gated — "internal" vs "IO
  boundary" needs judgment a generic lint can't make; caught in review.)
- `string`, `number`, `boolean`, `Record`, `object`, and `{}` are only allowed at IO boundaries — not inside
  core logic. (Same as above: review, not lint.)
- Do not add `any` — **gated**, `@typescript-eslint/no-explicit-any` in `eslint.config.js`. Do not widen to
  `unknown` unless you are writing a parser that immediately narrows (not gated: the "unless" makes this a
  review call).
- A duration is `Milliseconds`, a point in time is `EpochMs` (`src/time.ts`) — never a bare `number` for either.
  Construct an `EpochMs` only via `now()` there. **Gated** for `src/collaboration/**`, `src/storage/**`,
  `src/ui/toasts.svelte.ts`, `Editor.svelte`, `App.svelte` (`no-restricted-syntax` bans `Date.now()` outside
  `src/time.ts` in those); other verticals haven't adopted the brand yet, so it isn't gated app-wide.

## IO boundary rules (parse, don't validate)

- Parse data exactly once, at the IO boundary, into the right branded/named type. After that, trust the type —
  never re-check at call sites.
- A function that returns `boolean` to signal validity is a validator: wrong. A function that returns the domain
  type (or throws) is a parser: right.
- IO boundaries and how to handle each:
  - Env vars → call the existing `resolve*()` config functions; they return branded types (`SignalingUrl`,
    `WebsocketUrl`, …).
  - `localStorage` → never touch it. Bind a key to a parser and a serializer with `localStore<T>()` from
    `src/persistence/local.ts` — the only module allowed to reach `localStorage` — and read/write typed values
    through it. **Gated**: `no-restricted-globals` in `eslint.config.js` bans `localStorage` everywhere under
    `src/` except that one file (and test mocks).
  - URL params → cast in `App.svelte`, the single entry point.
  - Network peer data → use `parsePeerAwarenessState(raw: unknown)` in `src/collaboration/parse.ts`; do not read
    awareness state elsewhere.
  - External API JSON → type the interface, cast at `response.json()`.
  - Filename from browser API → cast to `Filename` inside the storage adapter.
  - ProseMirror node/mark kind → `nodeNameOf`/`markNameOf` (`src/editor/schema.ts`), never a bare `type.name` vs
    a literal: the closed union makes a typo an error.

## Finding things

- `npm run docs` generates a TypeDoc markdown index into `docs/api/` — git-ignored, regenerate on demand: every
  export, its doc comment and its exact location, read straight from the code. Prefer it or `grep`; there is no
  hand-maintained "where things live" doc, on purpose.

## Hexagonal architecture rules

- Ports live in `types.ts` / `auth.ts` files; adapters implement them elsewhere.
- The domain (Editor, format codecs, collab core) never imports a concrete adapter directly — a storage backend,
  or y-webrtc/y-websocket. **Gated**: `no-restricted-imports` in `eslint.config.js` (composition roots that
  construct adapters — `storage/index.ts`, `storage/parse.ts`, the two Collab adapters — are excepted).
- `CollabConnect` is typed `(room: RoomId) => Collab`; callers cannot reach through it into y-webrtc/y-websocket
  internals.
- `docs/architecture.md`'s ports/adapters diagram must name the real adapter set. **Gated**:
  `npm run check:architecture-diagram`.
- Add new storage or collab support by implementing the port interface and wiring it in `App.svelte`. Never add
  adapter-specific code inside `Editor.svelte`.

## Naming conventions

- No OO suffixes: not `XxxAdapter`, `XxxProvider`, `XxxFactory`, `XxxManager`, `XxxService`, `XxxHandler`. Not
  gated — false positives exist (`markRuleHandler`, `kService`); stays a review call.
- Use factory functions (`foo(): FooType`) returning plain objects, not classes. **Partially gated**:
  `no-restricted-syntax` bans a class `implements`-ing a port; `class X extends Error` stays legal — not the
  pattern being banned.
- Name branded types after what the value **is**: `RoomId` not `id`, `CursorColor` not `color`, `FileExtension`
  not `ext`.
- Brand names must be unambiguous under `grep` across the whole codebase.

## Svelte rules

- Use `$state.raw()` for ProseMirror objects (`EditorView`, `EditorState`) — they aren't designed to be deeply
  proxied, and `$state()` would try.
- Use `untrack()` when a prop is intentionally read once at component init, not tracked reactively.

## Discriminated unions

- Model mutually exclusive states with discriminated unions, not optional fields. Example:
  `StorageAvailability = { ok: true } | { ok: false; reason: string }`.
- Add a discriminant field (`active`, `ok`, `format`, `type`) that TypeScript can narrow on. Callers must handle
  all arms.

## Comments

- Default to **zero** in-code comments. Naming, types and structure carry the meaning; a comment that restates
  the code is noise, and it rots.
- A comment is tolerated only when the _reason_ for the code cannot be read from the code at all, and it must be
  ultra-concise — one line wherever possible:
  - an external system's non-obvious behaviour (pCloud returns API errors inside an HTTP 200);
  - a constraint the compiler cannot express and a future reader would undo.
- Never comment what a function does, what a type means, what a well-named variable holds, or why a change was
  made — that is what names and git are for.
- Prefer fixing the code over explaining it: a comment that feels necessary usually marks a bad name or a
  missing type.
- When you touch a file, bring its existing comments down to this bar.
- **Gated**: `local/comment-max-len` in `eslint.config.js` caps every comment line at 120 chars — shorten it,
  don't wrap it. Docs get the equivalent via `format:md:check` (see Commands).
- **Comments belong to humans.** An agent never posts one. It reads what a human wrote, challenges it when the
  code says otherwise, and — with that human in session — folds the outcome into the body, the title, or the
  code: the change is the reply. Bodies are where information lives; same bar there — table over narrative, the
  delta not the process. The only non-human comment is CI's preview link (`.github/workflows/pr-preview.yml`),
  not yours to write or delete.

## Checklist before every commit

Gated (`npm run lint` / `npm run check` fail the build on these — still worth a self-check, but a violation
cannot silently merge):

- [ ] `npm run lint` passes with zero errors (no `any`; no class implementing a port; no `localStorage` outside
      `src/persistence/local.ts`; no adapter import inside `Editor.svelte` or `src/format/**`; no `Date.now()`
      outside `src/time.ts` within `src/collaboration/**`/`Editor.svelte`/`App.svelte`).
- [ ] `npm run check` passes with zero errors.

Not mechanically checkable — review judgment only:

- [ ] No unguarded `as unknown`, no widening casts outside parsers.
- [ ] Every new domain value (URL, id, name, key) has a branded type.
- [ ] New IO boundaries call a parse/resolve function; raw data does not escape.
- [ ] Code _navigating_ node kinds uses `nodeNameOf`/`markNameOf`, never a bare `type.name` compared to a
      literal; a schema name in a config literal takes `satisfies NodeName`. Test assertions are exempt: a typo
      fails them anyway.
- [ ] New function signatures use named types, not bare primitives.
- [ ] New Svelte props use named types in `$props()`.
- [ ] No OO-suffixed name unless it's genuinely not the pattern being banned (see Naming conventions).
- [ ] No new comment that the code already says; comments in touched files slimmed.
