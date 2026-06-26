# Copad — rules for AI agents

## Type system rules

- Use the branded-string pattern for every domain concept that is a primitive at
  runtime: `type RoomId = string & { readonly _brand: 'RoomId' }`.
- Never pass a bare `string`, `number`, or `boolean` at an internal function
  boundary. Internal code uses named types everywhere: parameters, return types,
  object fields, Svelte `$props()`.
- `string`, `number`, `boolean`, `Record`, `object`, and `{}` are only allowed
  at IO boundaries — not inside core logic.
- Do not add `any`. Do not widen to `unknown` unless you are writing a parser
  that immediately narrows.

## IO boundary rules (parse, don't validate)

- Parse data exactly once, at the IO boundary, into the right branded/named type.
  After that, trust the type — never re-check at call sites.
- A function that returns `boolean` to signal validity is a validator: wrong.
  A function that returns the domain type (or throws) is a parser: right.
- IO boundaries and how to handle each:
  - Env vars → call the existing `resolve*()` config functions; they return
    branded types (`SignalingUrl`, `WebsocketUrl`, …).
  - `localStorage` reads → cast to the branded type inside the reading function
    (see `localCacheEnabled()` in `src/collaboration/cache.ts`).
  - URL params → cast in `App.svelte`, the single entry point.
  - Network peer data → use `parsePeerAwarenessState(raw: unknown)` in
    `src/collaboration/types.ts`; do not read awareness state elsewhere.
  - External API JSON → type the interface, cast at `response.json()`.
  - Filename from browser API → cast to `Filename` inside the storage adapter.

## Hexagonal architecture rules

- Ports live in `types.ts` / `auth.ts` files; adapters implement them elsewhere.
- The domain (Editor, format codecs, collab core) never imports from an adapter
  directly. `Editor.svelte` receives only the `Storage` port, never a concrete
  adapter or `StorageAuth`.
- `CollabConnect` is typed `(room: RoomId) => Collab`. Callers cannot reach
  through it into y-webrtc or y-websocket internals.
- Add new storage or collab support by implementing the port interface and wiring
  it in `App.svelte`. Never add adapter-specific code inside `Editor.svelte`.

## Naming conventions

- No OO suffixes: not `XxxAdapter`, `XxxProvider`, `XxxFactory`, `XxxManager`,
  `XxxService`, `XxxHandler`.
- Use factory functions (`foo(): FooType`) returning plain objects, not classes.
- Name branded types after what the value **is**: `RoomId` not `id`,
  `CursorColor` not `color`, `FileExtension` not `ext`.
- Brand names must be unambiguous under `grep` across the whole codebase.

## Discriminated unions

- Model mutually exclusive states with discriminated unions, not optional fields.
  Example: `StorageAvailability = { ok: true } | { ok: false; reason: string }`.
- Add a discriminant field (`active`, `ok`, `format`, `type`) that TypeScript can
  narrow on. Callers must handle all arms.

## Checklist before every commit

- [ ] No new `any`, no unguarded `as unknown`, no widening casts outside parsers.
- [ ] Every new domain value (URL, id, name, key) has a branded type.
- [ ] New IO boundaries call a parse/resolve function; raw data does not escape.
- [ ] New function signatures use named types, not bare primitives.
- [ ] New Svelte props use named types in `$props()`.
- [ ] `npm run check` passes with zero errors.
- [ ] No adapter import added inside `Editor.svelte` or format codecs.
