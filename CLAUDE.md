# Copad — project guide for Claude

## Architecture

Copad follows **hexagonal architecture** (ports & adapters) with a **functional style**.

### Ports (interfaces)

| Port | File | Description |
|------|------|-------------|
| `Storage` | `src/storage/types.ts` | Persist and restore the Y.Doc binary snapshot |
| `Collab` | `src/collaboration/types.ts` | Provide a shared Y.Doc and awareness channel |
| `CollabConnect` | `src/collaboration/types.ts` | Factory type: `(room: string) => Collab` |

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

`Editor.svelte` knows only the ports — it never imports y-webrtc or any storage backend directly.

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
| `VITE_SIGNALING_URL` | no | WebRTC signaling server(s), comma-separated (default: `ws://localhost:4444`) |
| `VITE_ROOM_PASSWORD` | no | Shared password for y-webrtc encryption |
| `VITE_ROOM` | no | Default room name (default: `copad-demo`) |
| `VITE_DROPBOX_APP_KEY` | for Dropbox | |
| `VITE_PCLOUD_CLIENT_ID` | for pCloud | |
| `VITE_PROXY_URL` | for WebDAV | CORS proxy URL |
| `VITE_WEBDAV_URL` | no | Pre-fill the WebDAV URL input |
| `VITE_STORAGE_BACKEND` | no | Default storage backend id |
