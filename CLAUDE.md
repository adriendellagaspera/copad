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

`resolveRoomAccess(VITE_ROOM_AUTH)` parses the env var and returns the right `RoomAccess`. `resolveRoomCipher(access)` derives the matching `RoomCipher`. Both live in `src/collaboration/config.ts`.

Both adapters share `createCollabCore()` (`src/collaboration/core.ts`) — the transport-agnostic half of a `Collab`: status/synced subscriber fan-out, the `connecting → waiting → connected` machine, online/offline reactivity, the local-cache lifecycle, and teardown. Each adapter supplies only provider wiring + two hooks (`isAttached()`, `peerCount()`); the duplicated boilerplate lives in one place.

### Wiring

`App.svelte` owns all construction and configuration:
- calls `backends()` to get the available `StorageBackend` pairs (`{ auth, storage }`)
- resolves `roomAccess = resolveRoomAccess(VITE_ROOM_AUTH)` and `roomCipher = resolveRoomCipher(roomAccess)` at startup
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
| `VITE_COLLAB_TRANSPORT` | no | Collaboration transport: `webrtc` (default) or `websocket`. **Chosen explicitly** (not inferred from any URL) — `resolveTransport()` in `src/collaboration/config.ts`. |
| `VITE_SIGNALING_URL` | no | WebRTC signaling server(s), comma-separated. `ws://localhost:4444` default applies **only on a local host**; on a deployed origin it's empty (warning banner shown) — must be `wss://` (browsers block `ws://` from https as mixed content). Resolved by `resolveSignaling()` in `src/collaboration/config.ts`. Used only on the WebRTC transport. |
| `VITE_WEBSOCKET_URL` | no | y-websocket hub URL, used when `VITE_COLLAB_TRANSPORT=websocket` (central relay, no STUN/TURN — works on mobile NAT; server sees plaintext, so no E2E). Setting it alone does NOT switch transports. Must be `wss://` on a deployed origin. Resolved by `resolveWebsocket()` in `src/collaboration/config.ts`. |
| `VITE_ROOM_AUTH` | no | Room access + encryption strategy: `public` (default, no password), `site-password`, `room-password`, or `secret-link`. Parsed by `resolveRoomAccess()` in `src/collaboration/config.ts`. |
| `VITE_ROOM_PASSWORD` | no | Site-wide password used when `VITE_ROOM_AUTH=site-password`. Feeds y-webrtc AES encryption (WebRTC transport only; WebSocket hub is plaintext by design). |
| `VITE_DEFAULT_ROOM` | no | Default landing room name when the URL has no `?room=` (default: `copad-demo`) |
| `VITE_DROPBOX_APP_KEY` | no | Locks the Dropbox app key; otherwise set it at runtime in Settings |
| `VITE_PCLOUD_CLIENT_ID` | no | Locks the pCloud client id; otherwise set it at runtime in Settings |
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
