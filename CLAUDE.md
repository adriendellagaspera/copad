# Copad — project guide for Claude

## Architecture

Copad follows **hexagonal architecture** (ports & adapters) with a **functional style**.

### Ports (interfaces)

| Port | File | Description |
|------|------|-------------|
| `Storage` | `src/storage/types.ts` | Persist and restore document bytes for a backend's target file (bytes-only, no auth) |
| `StorageAuth` | `src/storage/auth.ts` | Authenticate to a cloud storage backend; owns login/logout/config |
| `Collab` | `src/collaboration/types.ts` | Provide a shared Y.Doc and awareness channel |
| `CollabConnect` | `src/collaboration/types.ts` | Factory type: `(room: string) => Collab` |
| `RoomAccess` | `src/collaboration/roomAccess.ts` | Who may join a room (`mode` + `credential(room)`) |
| `RoomCipher` | `src/collaboration/roomCipher.ts` | How a room is encrypted (`password(room): string \| null`) |
| `Codec` | `src/format/types.ts` | Convert file bytes ⟷ the shared Y.Doc, selected by filename extension |

### Adapters (implementations)

Storage adapters return `{ auth: StorageAuth; storage: Storage }` — auth and bytes live in a shared closure but are exposed through separate ports. The `StorageBackend` type alias (in `src/storage/index.ts`) names the pair.

| Adapter | File | Notes |
|---------|------|-------|
| `dropboxStorage()` | `src/storage/dropbox.ts` | OAuth2 PKCE, no proxy needed |
| `pcloudStorage()` | `src/storage/pcloud.ts` | OAuth popup |
| `webdavStorage()` | `src/storage/webdav.ts` | Requires `VITE_PROXY_URL` (CORS) |
| `githubStorage()` | `src/storage/github.ts` | Commits to a GitHub repo via PAT; `contentFormat` is `'text'` for human-readable files, `'binary'` for `.yjs`. |
| `localFsStorage()` | `src/storage/local.ts` | File System Access API, Chrome/Edge only |
| `webrtcCollab()` | `src/collaboration/webrtc.ts` | y-webrtc peer-to-peer transport (**default**). Needs STUN, plus TURN on mobile/symmetric NAT. |
| `websocketCollab()` | `src/collaboration/websocket.ts` | y-websocket hub transport (opt-in via `VITE_COLLAB_TRANSPORT=websocket`). Central relay, **no WebRTC → no STUN/TURN**; server is in the data path (no E2E). |

Both collab adapters are `CollabConnect` factories behind the same `Collab` port, so they're interchangeable. `resolveCollab()` in `App.svelte` picks one via `resolveTransport(VITE_COLLAB_TRANSPORT)` — WebRTC by default, WebSocket only when explicitly set to `websocket`.

Room access adapters (all in `src/collaboration/roomAccess.ts` / `roomCipher.ts` / `secretLink.ts`):

| Adapter | Port(s) | Notes |
|---------|---------|-------|
| `publicAccess()` | `RoomAccess` | No credential — anyone may join (default) |
| `sitePassword(pw)` | `RoomAccess` | Single shared password from env (`VITE_ROOM_PASSWORD`) |
| `roomPassword()` | `RoomAccess` | Per-room password stored in `localStorage` |
| `secretLink()` | `RoomAccess` + `RoomCipher` | URL-fragment key (`#k=…`); dual-port — the key is simultaneously the access gate and the AES encryption key |
| `plaintext()` | `RoomCipher` | No encryption (`password()` returns `null`) |

`resolveRoomStrategy(VITE_ROOM_AUTH)` parses the env var once and returns a `RoomStrategy` — the `{ access, cipher }` pair built **together** so each strategy keeps its concrete type end-to-end. In particular the `secret-link` dual-port object is assigned directly to both fields (no widen-to-`RoomAccess`-then-cast-back-to-`RoomCipher`). Lives in `src/collaboration/config.ts`.

### Wiring

`App.svelte` owns all construction and configuration:
- calls `backends()` to get the available `StorageBackend` pairs (`{ auth, storage }`)
- resolves `{ access: roomAccess, cipher: roomCipher } = resolveRoomStrategy(VITE_ROOM_AUTH)` at startup
- calls `resolveCollab()` — returns `webrtcCollab({ signaling, cipher, iceServers })` by default, or `websocketCollab({ url })` when `VITE_COLLAB_TRANSPORT=websocket` — to get a `CollabConnect` function (and any config warning to surface)
- passes both down to `Editor.svelte` as props; Editor receives only the bytes-only `Storage` half (never `StorageAuth`)
- renders the storage **pills** + connect *action zone*, and the `Settings.svelte` drawer

`Editor.svelte` knows only the ports — it never imports y-webrtc, y-websocket, or any storage backend directly. `Settings.svelte` receives `StorageBackend[]` and accesses auth via `b.auth.*`, metadata via `b.storage.*`.

### File formats (the `Codec` port)

A backend moves *bytes*; a **codec** (`src/format/`) turns those bytes into the shared `Y.Doc` and back. The codec is chosen from the target **filename's extension** (`codecForFilename()`), so format support is entirely backend-agnostic.

| Codec | Extensions | Notes |
|-------|-----------|-------|
| `yjsCodec` | `.yjs` | **Native default.** Full CRDT state (history + content) — the only format that round-trips collaborative merge. Fallback for unknown extensions. |
| `textCodec` | `.txt` | Plain text; one paragraph per line. Formatting flattened. |
| `markdownCodec` | `.md`, `.markdown` | CommonMark + GFM strikethrough (`~~`). |
| `htmlCodec` | `.html`, `.htm` | ProseMirror DOM parser/serializer; **needs a DOM** (browser only). |
| `jsonCodec` | `.json` | ProseMirror document JSON; lossless for our schema. |

- Content codecs reconcile into the shared doc via y-prosemirror's `prosemirrorToYXmlFragment` (the same diff reconciler as `ySyncPlugin`), so importing replaces content cleanly — no duplicated leading paragraph. Shared PM↔Y helpers live in `src/format/pm.ts`.
- Each backend reports its target filename via `Storage.filename()`. **Local** takes it from the picked file; **cloud** backends expose `setFilename()` (a "File name" input in Settings, persisted by `filenameStore()` in `src/storage/filename.ts`). The extension picks the format; it takes effect on connect.
- Adding a format = add one codec file + register it in `src/format/index.ts`. The Local file picker (`knownExtensions()`) and Settings copy update automatically.

### Config vs. credentials

The `StorageAuth` port separates two concerns:
- **`configFields`** — one-time, app-level setup (OAuth app keys / client ids). Edited in the `Settings.svelte` (⚙) drawer, persisted in `localStorage` via the `configStore()` helper (`src/storage/config.ts`). Resolution per field is env var → saved value; an env var (`VITE_*`) *locks* the field as deployment-managed. `configured()` reports whether a backend has everything it needs to attempt a connect.
- **`credentialFields`** — per-session login collected on the front-page connect form (e.g. WebDAV username/password). Not stored as config.

Backends that need neither (Local) omit both. Each backend's front-page **pill** reflects `statusOf()`: `unavailable` → `setup` (missing config) → `ready` → `connected`.

### Constants & deployment config

No magic literal lives buried in business logic. Deployment-relevant constants — endpoints, defaults, timeouts, folder paths, and the localStorage keys each vertical owns — are centralized in a **config/constants module per vertical**, and read a `VITE_*` env override where deployments legitimately vary:
- `src/config.ts` — app-global: the storage **namespace** (`APP_NAMESPACE` / `nsKey()`, default `copad`). Overridable via `VITE_APP_NAMESPACE` so two deployments on one origin can isolate their `copad:`-namespaced state. The no-flash script in `index.html` can't read env at runtime, so it's kept in sync at *build* time by the `inject-app-namespace` plugin in `vite.config.ts` (same default).
- `src/collaboration/constants.ts` — signaling/STUN/room defaults, local-dev hostnames, cache + room-password keys.
- `src/storage/constants.ts` — backend endpoint URLs/hosts/paths, the shared cloud folder, GitHub API base, OAuth popup tuning + redirect, base64 chunk size, default filenames, and backend identity. `STORAGE_ID` (built by the `storageIds()` brander) is the single source of truth for backend ids — adapters and keys derive from it, so each `as StorageId` cast lives in exactly one place. Every persisted key is built by `backendKey(id, purpose)` as a uniform `storage.<id>.<purpose>` (config field names, `filename`, `token`, `session`, `conf`, `validated`). Each endpoint/host/path/tunable reads a `VITE_*` override (via the `envStr` / `envInt` helpers) so a deployment can react to a provider rotating a domain or a regional split (pCloud US/EU) without a rebuild.

The only constants with **no** env override are the per-backend localStorage **key strings** (`storage.<id>.*`, `collab.room-password.*` — pure identity; changing them just orphans saved state with no deployment benefit) and the GitHub default branch (already deployment-settable via the `branch` config field's `VITE_GITHUB_BRANCH` lock). Changing `VITE_APP_NAMESPACE` on a *live* deployment likewise orphans `copad:`-namespaced state — it's a set-once-at-deploy knob.

## Type system principles

Four interlocking principles keep the type system honest end-to-end.

### 1. Screaming names

Every domain concept gets a named type whose name makes its meaning obvious under `grep`. Never let a bare `string` or `number` represent a domain value inside core logic.

```typescript
// src/collaboration/types.ts
export type RoomId       = string & { readonly _brand: 'RoomId' };
export type DisplayName  = string & { readonly _brand: 'DisplayName' };
export type CursorColor  = string & { readonly _brand: 'CursorColor' };
export type SignalingUrl = string & { readonly _brand: 'SignalingUrl' };
```

The intersection `string & { readonly _brand: '…' }` is the brand pattern — it carries no runtime cost and blocks accidental assignments. All brands follow this exact shape. Other examples: `StorageId`, `Filename`, `FileExtension` (`src/format/types.ts`), `CacheDbName`, `LocalCacheEnabled` (`src/collaboration/cache.ts`).

IO-boundary casts (`'value' as BrandType`) are the **only** permitted entry points into a branded type.

### 2. Domain-Driven Design with hexagonal architecture

Ports are TypeScript interfaces that define what the domain needs; adapters implement them without the domain knowing. See the Architecture section above for the full port/adapter table.

The type system enforces the boundary: `Editor.svelte` receives only the `Storage` port — never a concrete adapter, never `StorageAuth`. `CollabConnect` is typed as `(room: RoomId) => Collab`; Editor cannot reach through it to y-webrtc or y-websocket internals.

Discriminated unions model domain states: `StorageAvailability` (`src/storage/types.ts`) uses `{ ok: true } | { ok: false; reason: string }` so callers must handle both arms. `SlashState` (`src/editor/ui/slashMenu.ts`) uses `SlashClosed | SlashOpen` — narrowing on `active` gives exclusive access to the fields that only make sense when the menu is open.

### 3. Parse, don't validate

Data is parsed **once** at the IO boundary into a rich type. Internal code trusts the type and never re-validates. A function that returns `boolean` is a validator; a function that returns the domain type (or throws) is a parser.

```typescript
// src/collaboration/parse.ts — single cast site for network peer data
export function parsePeerAwarenessState(raw: unknown): PeerAwarenessState {
  // all field access guarded here; safe fallbacks for malformed data
  const name: DisplayName = (typeof nameRaw === 'string' && nameRaw.trim())
    ? nameRaw.trim() as DisplayName
    : FALLBACK_NAME;
  // …
}
```

Each vertical keeps its IO-boundary parsers in a dedicated `parse.ts` file:
- `src/collaboration/parse.ts` — network peer state (`parsePeerAwarenessState`), localStorage room ids/credentials/cache flag (`parseRoomId`, `parseRoomCredential`, `parseRoomList`, `parseLocalCacheEnabled`)
- `src/storage/parse.ts` — stored sessions + API JSON + postMessage (`parseWebDavConf`, `parsePCloudSession`, `parseGitHubLoadResponse`, `parseOAuthCode`, `parseRepo`, `parseBranch`, …)
- `src/editor/parse.ts` — ProseMirror node/mark attrs (`headingLevel`, `linkHref`)
- `src/editor/ui/slashMenu.ts` — slash plugin transaction meta (`getSlashMeta`, co-located with `slashKey` to avoid a circular dep)

Operator-injectable peer defaults (`FALLBACK_NAME`, `FALLBACK_COLOR`) live in `src/collaboration/peerDefaults.ts` — they read `VITE_FALLBACK_NAME` / `VITE_FALLBACK_COLOR` and validate before branding, so they are the only env-var cast site for those two values.

**`localStorage` is abstracted entirely behind the persistence primitive** in `src/persistence/local.ts`: `localStore<T>(key, parse, serialize)` is the *single* module that touches `localStorage`. A store binds a `StorageKey` to a parser and serializer, so domain code only calls `.read()` / `.write()` / `.clear()` — it never sees `localStorage` *or* a parse function. The cache prefs (`cache.ts`), per-room password (`roomAccess.ts`), backend config/filename (`storage/config.ts`, `storage/filename.ts`), OAuth tokens/sessions/validation (`dropbox.ts`, `pcloud.ts`, `webdav.ts`, `github.ts`), and theme (`ui/theme.svelte.ts`) all go through it. (The one exception is the no-flash theme script inlined in `index.html`, which can't import modules.)

IO boundaries in this codebase and how each is handled:

| Boundary | How parsed |
|----------|-----------|
| Env vars (`import.meta.env.*`) | `resolveSignaling()`, `resolveTransport()`, etc. in `src/collaboration/config.ts`; per-vertical constants in `src/collaboration/constants.ts` / `src/storage/constants.ts`; peer defaults in `src/collaboration/peerDefaults.ts` — all return branded/typed values |
| `localStorage` reads/writes | the `localStore<T>` primitive in `src/persistence/local.ts` — binds a key to a parser + serializer; the only module touching `localStorage` |
| URL params | cast in `App.svelte` at the single entry point (e.g. `?room=` → `RoomId`) |
| Network peer awareness | `parsePeerAwarenessState(raw: unknown)` in `src/collaboration/parse.ts` |
| ProseMirror node/mark attrs (`any`) | typed accessors in `src/editor/parse.ts` and `getSlashMeta` in `src/editor/ui/slashMenu.ts` |
| User form input | stays `string` until accepted into the domain by a login/connect function |
| External API JSON | parse function in the vertical's `parse.ts` (e.g. `parseGitHubLoadResponse`), narrowing `await res.json()` typed as `unknown` |
| postMessage (OAuth popup) | `parseOAuthCode(data: unknown)` in `src/storage/parse.ts` |
| Filename from browser API | `handle?.name as Filename` inside `localFsStorage()` in `src/storage/local.ts` |

### 4. Strong typing end-to-end — no primitives at internal boundaries

`string`, `number`, `boolean`, `Record`, `object`, and `{}` are only permitted at IO boundaries. Every internal function signature uses named types:

```typescript
// src/format/types.ts — extensionOf is a parser, not a validator
export function extensionOf(filename: string): FileExtension {
  const dot = filename.lastIndexOf('.');
  return (dot === -1 ? '' : filename.slice(dot).toLowerCase()) as FileExtension;
}

// src/collaboration/cache.ts — cacheDbName produces a branded DB name (cast at the namespacing boundary)
export function cacheDbName(room: RoomId): CacheDbName {
  return `${CACHE_DB_PREFIX}${room}` as CacheDbName;
}
```

This applies to function parameters, return types, object fields, and Svelte component `$props()`. The compiler then catches misuse — passing a raw `string` where a `RoomId` is expected is a type error, not a runtime surprise.

## Naming conventions

This codebase uses **functional naming** — no OO suffixes.

| Avoid | Use instead |
|-------|-------------|
| `XxxAdapter`, `XxxProvider`, `XxxFactory` | name after what the thing **is** or **does** |
| `class Foo implements Bar` | factory function `foo(): Bar` returning a plain object |
| `new Foo()` | `foo()` |
| `FooManager`, `FooService`, `FooHandler` | plain function or module |

## Key technical notes

- **Svelte 5 runes** — use `$state.raw()` for ProseMirror objects (avoid deep Proxy wrapping).
- **`{#key room}`** — forces a full `Editor` remount when the room changes, giving a clean Y.Doc and WebrtcProvider without manual teardown logic in Editor.
- **`untrack()`** — used when a prop is intentionally read once at component init (not reactive).
- **Leader election** — only the peer with the lowest `clientID` writes to storage, preventing concurrent-write races.
- **Local cache** — `src/collaboration/cache.ts` owns local caching end to end (prefs + DB naming + clear + `attachLocalCache(room, doc): LocalCache`, the single place importing `y-indexeddb`). Both adapters just call `attachLocalCache` when their `cache` opt is true (DB name `copad:<room>`), so a reload survives without a backend. On by default; the Settings toggle flips a localStorage pref that `App.svelte` reads, rebuilds `connect`, and remounts the Editor via `{#key room|localCache}`. Stores **plaintext** at rest (independent of the room password) — the toggle + "Clear local copies" are the privacy control. `clearLocalCache()` uses a remembered-rooms index (not `indexedDB.databases()`, which Firefox lacks).
- **WebDAV** — hidden from the UI unless `VITE_PROXY_URL` is set; most WebDAV servers don't send CORS headers.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_APP_NAMESPACE` | no | Prefix for the app's `copad:`-namespaced browser state — theme + local cache (default: `copad`). Set once per deploy to isolate two deployments on one origin; the no-flash `index.html` script is synced at build time by the `inject-app-namespace` Vite plugin. |
| `VITE_COLLAB_TRANSPORT` | no | Collaboration transport: `webrtc` (default) or `websocket`. **Chosen explicitly** (not inferred from any URL) — `resolveTransport()` in `src/collaboration/config.ts`. |
| `VITE_SIGNALING_URL` | no | WebRTC signaling server(s), comma-separated. `ws://localhost:4444` default applies **only on a local host**; on a deployed origin it's empty (warning banner shown) — must be `wss://` (browsers block `ws://` from https as mixed content). Resolved by `resolveSignaling()` in `src/collaboration/config.ts`. Used only on the WebRTC transport. |
| `VITE_WEBSOCKET_URL` | no | y-websocket hub URL, used when `VITE_COLLAB_TRANSPORT=websocket` (central relay, no STUN/TURN — works on mobile NAT; server sees plaintext, so no E2E). Setting it alone does NOT switch transports. Must be `wss://` on a deployed origin. Resolved by `resolveWebsocket()` in `src/collaboration/config.ts`. |
| `VITE_ROOM_AUTH` | no | Room access + encryption strategy: `public` (default, no password), `site-password`, `room-password`, or `secret-link`. Parsed by `resolveRoomStrategy()` in `src/collaboration/config.ts`. |
| `VITE_ROOM_PASSWORD` | no | Site-wide password used when `VITE_ROOM_AUTH=site-password`. Feeds y-webrtc AES encryption (WebRTC transport only; WebSocket hub is plaintext by design). |
| `VITE_DEFAULT_ROOM` | no | Default landing room name when the URL has no `?room=` (default: `copad-demo`) |
| `VITE_FALLBACK_NAME` | no | Display name shown for peers whose awareness state has no name (default: `Anonymous`). Parsed in `src/collaboration/peerDefaults.ts`. |
| `VITE_FALLBACK_COLOR` | no | Cursor colour for peers with no colour set — must be a 6-digit hex (`#rrggbb`); invalid values fall back to `#888888`. Parsed in `src/collaboration/peerDefaults.ts`. |
| `VITE_DROPBOX_APP_KEY` | no | Locks the Dropbox app key; otherwise set it at runtime in Settings |
| `VITE_PCLOUD_CLIENT_ID` | no | Locks the pCloud client id; otherwise set it at runtime in Settings |
| `VITE_GITHUB_REPO` | no | Locks the GitHub repository (`owner/repo`); otherwise set at runtime in Settings |
| `VITE_GITHUB_BRANCH` | no | Locks the GitHub branch (default: `main`); otherwise set at runtime in Settings |
| `VITE_GITHUB_TOKEN` | no | Locks the GitHub PAT; bypasses the Connect validation step (deployment-managed) |
| `VITE_GITHUB_API_URL` | no | GitHub REST API base (default: `https://api.github.com`); set for a GitHub Enterprise host. In `src/storage/constants.ts`. |
| `VITE_CLOUD_FOLDER` | no | Folder the cloud backends (Dropbox, pCloud) read/write within (default: `/copad`). In `src/storage/constants.ts`. |
| `VITE_DEFAULT_FILENAME` | no | Initial target filename for cloud backends (default: `document.yjs`); the extension selects the codec. |
| `VITE_GITHUB_DEFAULT_FILENAME` | no | Initial GitHub target file (default: `notes.md`). |
| `VITE_REDIRECT_URI` | no | OAuth redirect URI (default: `<origin>/redirect.html`). In `src/storage/constants.ts`. |
| `VITE_DROPBOX_AUTH_URL` / `VITE_DROPBOX_TOKEN_URL` / `VITE_DROPBOX_UPLOAD_URL` / `VITE_DROPBOX_DOWNLOAD_URL` | no | Dropbox OAuth/content endpoint overrides (defaults are the public dropbox.com / dropboxapi.com URLs). For when Dropbox rotates a domain. |
| `VITE_PCLOUD_API_HOST` / `VITE_PCLOUD_EU_API_HOST` | no | pCloud API hosts (defaults: `api.pcloud.com` / `eapi.pcloud.com`). Override for a region change. |
| `VITE_PCLOUD_GETFILELINK_PATH` / `VITE_PCLOUD_UPLOAD_PATH` | no | pCloud API paths (defaults: `/getfilelink` / `/uploadfile`). |
| `VITE_OAUTH_TIMEOUT_MS` | no | How long to wait for the OAuth popup before giving up (default: `300000`). |
| `VITE_OAUTH_POPUP_FEATURES` | no | OAuth popup window features (default: `width=520,height=640`). |
| `VITE_BASE64_CHUNK` | no | Chunk size for base64-encoding large GitHub uploads (default: `32768`). |
| `VITE_PROXY_URL` | for WebDAV | CORS proxy URL |
| `VITE_WEBDAV_URL` | no | Pre-fill the WebDAV URL input |
| `VITE_STORAGE_BACKEND` | no | Default storage backend id |
| `VITE_STUN_URL` | no | STUN server(s), comma-separated (default: `stun:stun.l.google.com:19302`; set empty to disable). Via `resolveIceServers()`. |
| `VITE_TURN_URL` | no | TURN relay url(s), comma-separated. Needed for restrictive/mobile NATs (CGNAT / symmetric NAT). |
| `VITE_TURN_USERNAME` | no | TURN long-term credential username. |
| `VITE_TURN_CREDENTIAL` | no | TURN long-term credential secret. |

## Collaboration servers

Real-time collab needs a server, but **none lives in this repo** — both transports run an
upstream package's bundled server (don't reinvent the wheel):

- **WebRTC** → a y-webrtc signaling server: the `y-webrtc-signaling` bin (from the `y-webrtc`
  dep; reads `PORT`, default 4444). `npm run signaling` runs it locally.
- **WebSocket** → a y-websocket hub: the `y-websocket-server` bin (from the `@y/websocket-server`
  devDep; reads `HOST`/`PORT`, serves `okay`). `npm run collab` runs it locally.

To deploy either, point a host (Render/Fly/any VPS) at a 3-line `package.json` that depends on
the upstream package with `"start"` calling its bin — `npm install` puts it in `node_modules`
on the host. See README "Deploying a collaboration server".
