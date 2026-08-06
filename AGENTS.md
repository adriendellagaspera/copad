# Copad — rules for AI agents

## The contract comes first

- [`docs/contract.md`](docs/contract.md) is **binding, not indicative**. Read it
  before changing anything about presence, the write gate, storage durability,
  room identifiers, or what the editor allows when alone.
- Changing behaviour it describes means updating it **in the same commit**. A
  spec that lags the code is worse than no spec: it is read as true.
- The same holds for `CLAUDE.md` and `README.md`. When you touch an area they
  describe, bring their description back in line — these files brief every
  agent, so a stale line propagates into work that was never wrong on purpose.

## Type system rules

- Use the branded-string pattern for every domain concept that is a primitive at
  runtime: `type RoomId = string & { readonly _brand: 'RoomId' }`.
- Never pass a bare `string`, `number`, or `boolean` at an internal function
  boundary. Internal code uses named types everywhere: parameters, return types,
  object fields, Svelte `$props()`. (Not gated — "internal" vs "IO boundary" needs
  judgment a generic lint can't make; caught in review.)
- `string`, `number`, `boolean`, `Record`, `object`, and `{}` are only allowed
  at IO boundaries — not inside core logic. (Same as above: review, not lint.)
- Do not add `any` — **gated**, `@typescript-eslint/no-explicit-any` in
  `eslint.config.js`. Do not widen to `unknown` unless you are writing a parser
  that immediately narrows (not gated: the "unless" makes this a review call).

## IO boundary rules (parse, don't validate)

- Parse data exactly once, at the IO boundary, into the right branded/named type.
  After that, trust the type — never re-check at call sites.
- A function that returns `boolean` to signal validity is a validator: wrong.
  A function that returns the domain type (or throws) is a parser: right.
- IO boundaries and how to handle each:
  - Env vars → call the existing `resolve*()` config functions; they return
    branded types (`SignalingUrl`, `WebsocketUrl`, …).
  - `localStorage` → never touch it. Bind a key to a parser and a serializer
    with `localStore<T>()` from `src/persistence/local.ts` — the only module
    allowed to reach `localStorage` — and read/write typed values through it.
    **Gated**: `no-restricted-globals` in `eslint.config.js` bans `localStorage`
    everywhere under `src/` except that one file (and test mocks).
  - URL params → cast in `App.svelte`, the single entry point.
  - Network peer data → use `parsePeerAwarenessState(raw: unknown)` in
    `src/collaboration/parse.ts`; do not read awareness state elsewhere.
  - External API JSON → type the interface, cast at `response.json()`.
  - Filename from browser API → cast to `Filename` inside the storage adapter.

## Finding things

- `npm run docs` generates a markdown API index (TypeDoc) into `docs/api/` —
  git-ignored, regenerate on demand. Every export, its doc comment, and its
  exact source location, always current because it's read straight from the
  code. Prefer it (or `grep` — names are grep-unambiguous by the rule above)
  over asking; there is no hand-maintained "where things live" doc to read
  instead, on purpose.

## Hexagonal architecture rules

- Ports live in `types.ts` / `auth.ts` files; adapters implement them elsewhere.
- The domain (Editor, format codecs, collab core) never imports from an adapter
  directly. `Editor.svelte` receives only the `Storage` port, never a concrete
  adapter or `StorageAuth`. **Gated**: `no-restricted-imports` in
  `eslint.config.js` bans importing any concrete storage adapter from
  `Editor.svelte` or `src/format/**`.
- `CollabConnect` is typed `(room: RoomId) => Collab`. Callers cannot reach
  through it into y-webrtc or y-websocket internals.
- Add new storage or collab support by implementing the port interface and wiring
  it in `App.svelte`. Never add adapter-specific code inside `Editor.svelte`.

## Naming conventions

- No OO suffixes: not `XxxAdapter`, `XxxProvider`, `XxxFactory`, `XxxManager`,
  `XxxService`, `XxxHandler`. Not gated: a blind suffix regex false-positives on
  names that are legitimately not the OO pattern this bans — e.g.
  `markRuleHandler` (`src/editor/plugins.ts`, a plain function handling an input
  rule) and `kService` (`src/storage/s3.ts`, AWS's own SigV4 key-derivation term).
  Stays a review call.
- Use factory functions (`foo(): FooType`) returning plain objects, not classes.
  **Partially gated**: `no-restricted-syntax` in `eslint.config.js` bans a class
  `implements`-ing a port (the actual OO-adapter pattern this rule targets);
  `class X extends Error` stays legal — subclassing a built-in for a real
  `instanceof`/stack trace isn't the pattern being banned.
- Name branded types after what the value **is**: `RoomId` not `id`,
  `CursorColor` not `color`, `FileExtension` not `ext`.
- Brand names must be unambiguous under `grep` across the whole codebase.

## Discriminated unions

- Model mutually exclusive states with discriminated unions, not optional fields.
  Example: `StorageAvailability = { ok: true } | { ok: false; reason: string }`.
- Add a discriminant field (`active`, `ok`, `format`, `type`) that TypeScript can
  narrow on. Callers must handle all arms.

## Comments

- Default to **zero** in-code comments. Naming, types and structure carry the
  meaning; a comment that restates the code is noise, and it rots.
- A comment is tolerated only when the *reason* for the code cannot be read from
  the code at all, and it must be ultra-concise — one line wherever possible:
  - an external system's non-obvious behaviour (pCloud returns API errors inside
    an HTTP 200);
  - a constraint the compiler cannot express and a future reader would undo.
- Never comment what a function does, what a type means, what a well-named
  variable holds, or why a change was made — that is what names and git are for.
- Prefer fixing the code over explaining it: a comment that feels necessary
  usually marks a bad name or a missing type.
- When you touch a file, bring its existing comments down to this bar.

## Checklist before every commit

Gated (`npm run lint` / `npm run check` fail the build on these — still worth
a self-check, but a violation cannot silently merge):

- [ ] `npm run lint` passes with zero errors (no `any`; no class implementing a
      port; no `localStorage` outside `src/persistence/local.ts`; no adapter
      import inside `Editor.svelte` or `src/format/**`).
- [ ] `npm run check` passes with zero errors.

Not mechanically checkable — review judgment only:

- [ ] No unguarded `as unknown`, no widening casts outside parsers.
- [ ] Every new domain value (URL, id, name, key) has a branded type.
- [ ] New IO boundaries call a parse/resolve function; raw data does not escape.
- [ ] New function signatures use named types, not bare primitives.
- [ ] New Svelte props use named types in `$props()`.
- [ ] No OO-suffixed name unless it's genuinely not the pattern being banned
      (see Naming conventions).
- [ ] No new comment that the code already says; comments in touched files slimmed.
