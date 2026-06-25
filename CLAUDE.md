# Copad — project guide for Claude

## Architecture

Copad follows **hexagonal architecture** (ports & adapters) with a **functional style**.

### Ports (interfaces)

| Port | File | Description |
|------|------|-------------|
| `Storage` | `src/storage/types.ts` | Persist and restore document bytes for a backend's target file |
| `Collab` | `src/collaboration/types.ts` | Provide a shared Y.Doc and awareness channel |
| `CollabConnect` | `src/collaboration/types.ts` | Factory type: `(room: string) => Collab` |
| `Codec` | `src/format/types.ts` | Convert file bytes ⟷ the shared Y.Doc, selected by filename extension |

### Adapters (implementations)

| Adapter | File | Notes |
|---------|------|-------|
| `dropboxStorage()` | `src/storage/dropbox.ts` | OAuth2 PKCE, no proxy needed |
| `pcloudStorage()` | `src/storage/pcloud.ts` | OAuth popup |
| `webdavStorage()` | `src/storage/webdav.ts` | Requires `VITE_PROXY_URL` (CORS) |
| `localFsStorage()` | `src/storage/local.ts` | File System Access API, Chrome/Edge only |
| `webrtcCollab()` | `src/collaboration/webrtc.ts` | y-webrtc peer-to-peer transport |

### Wiring

`App.svelte` owns all construction and configuration:
- calls `backends()` to get the available `Storage` implementations
- calls `webrtcCollab({ signaling, password })` to get a `CollabConnect` function
- passes both down to `Editor.svelte` as props
- renders the storage **pills** + connect *action zone*, and the `Settings.svelte` drawer

`Editor.svelte` knows only the ports — it never imports y-webrtc or any storage backend directly.

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

The `Storage` port separates two concerns:
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
- **WebDAV** — hidden from the UI unless `VITE_PROXY_URL` is set; most WebDAV servers don't send CORS headers.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SIGNALING_URL` | no | WebRTC signaling server(s), comma-separated. `ws://localhost:4444` default applies **only on a local host**; on a deployed origin it's empty (warning banner shown) — must be `wss://` (browsers block `ws://` from https as mixed content). Resolved by `resolveSignaling()` in `src/collaboration/config.ts`. |
| `VITE_ROOM_PASSWORD` | no | Shared password for y-webrtc encryption |
| `VITE_ROOM` | no | Default room name (default: `copad-demo`) |
| `VITE_DROPBOX_APP_KEY` | no | Locks the Dropbox app key; otherwise set it at runtime in Settings |
| `VITE_PCLOUD_CLIENT_ID` | no | Locks the pCloud client id; otherwise set it at runtime in Settings |
| `VITE_PROXY_URL` | for WebDAV | CORS proxy URL |
| `VITE_WEBDAV_URL` | no | Pre-fill the WebDAV URL input |
| `VITE_STORAGE_BACKEND` | no | Default storage backend id |

## Signaling server

`signaling/` is a standalone Node.js app (only dep: `ws`) deployable independently. `npm run signaling` runs `signaling/server.js` directly. Deploy to Render or Fly.io — see README "Deploying the signaling server".
