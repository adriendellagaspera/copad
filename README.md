# Copad

[![CI](https://github.com/adriendellagaspera/copad/actions/workflows/ci.yml/badge.svg)](https://github.com/adriendellagaspera/copad/actions/workflows/ci.yml)
[![Deploy](https://github.com/adriendellagaspera/copad/actions/workflows/deploy.yml/badge.svg)](https://github.com/adriendellagaspera/copad/actions/workflows/deploy.yml)

> **⚠️ Work in progress.** Not ready for production use.

I wanted to collaborate on a file in my pCloud. I found nothing off the shelf so I built this.

**Real-time collaborative rich-text editing on your own file storage** — pCloud,
Dropbox, WebDAV/Nextcloud, and more. Backend-agnostic, peer-to-peer, ~$0/month to run.

## Why not Dropbox Paper / Notion / Google Docs?

Those are great products. Copad is for a different situation:

| | Copad | Dropbox Paper / Notion / Google Docs |
|---|---|---|
| **Where the file lives** | A real file in your own storage folder | Provider's servers, proprietary format |
| **Storage backend** | Dropbox, Nextcloud, pCloud, any WebDAV | Locked to one provider |
| **Works on self-hosted storage** | ✅ (Nextcloud, ownCloud, any WebDAV) | ❌ |
| **Open the doc without the app** | ✅ (it's a file in your folder) | ❌ |
| **Open source / self-hostable** | ✅ | ❌ |
| **Cost** | ~$0 (your existing storage) | Subscription |

The core difference: **the document is a file you own**, sitting in a folder you already pay for, on a service you already chose. No new subscription, no lock-in, no data leaving your storage provider.

Copad won't match Paper or Notion on polish (no comments, version history, or templates — yet). The trade-off is full ownership and portability.

## How it works

File storage services (Dropbox, Nextcloud, pCloud…) are great at durability but have
no concept of real-time collaboration. Copad separates the two concerns:

- **Real-time collaboration** → [Yjs](https://github.com/yjs/yjs) (CRDT) over a swappable transport: edits merge without conflicts. Two transports ship behind the same `Collab` port:
  - **[y-webrtc](https://github.com/yjs/y-webrtc) (default)** — **peer-to-peer**, no server in the data path. Needs STUN, and a TURN relay on mobile/symmetric NAT. Each room can be **end-to-end encrypted** from the Share dialog — a "secure link" (key in the URL `#hash`, never sent to the server) or a password you share separately.
  - **[y-websocket](https://github.com/yjs/y-websocket) hub (opt-in)** — every client connects to one central relay. No WebRTC, so **no STUN/TURN and no NAT traversal** — the reliable choice for mobile / restrictive networks. Set `VITE_COLLAB_TRANSPORT=websocket` (+ a hub URL) to switch (the server is then in the data path, so end-to-end encryption no longer applies).
- **Persistence** → a swappable `StorageAdapter`: loads the document on startup, autosaves on changes. The storage layer only ever sees an **opaque binary blob** (the Yjs snapshot) — it knows nothing about CRDTs.

The editor is built on [ProseMirror](https://prosemirror.net) (schema, keymap, input rules — bold, italic, strike, headings, lists, quotes, inline code) and wrapped in a [Svelte 5](https://svelte.dev) UI.

```
ProseMirror editor (Svelte 5)
   │
   ▼
  Yjs  ──── y-webrtc (P2P) ────►  other browsers  (live merge + cursors)
   │
   ▼  (load on startup / debounced autosave by the elected "leader" peer)
StorageAdapter ── Dropbox | WebDAV/Nextcloud | pCloud | …
```

## Multi-backend architecture

Everything goes through one interface — [`src/storage/types.ts`](src/storage/types.ts):

```ts
interface Storage {
  id: string; label: string;
  unavailableReason?: string;             // set when the browser can't support this backend
  isAuthenticated(): boolean;
  credentialFields?: CredentialField[];   // form fields (WebDAV); absent for OAuth
  connect(creds?): Promise<void>;         // OAuth popup or applies credentials
  disconnect(): void;
  load(): Promise<Uint8Array | null>;     // read the Yjs snapshot
  save(bytes: Uint8Array): Promise<void>; // write the Yjs snapshot
}
```

Adapters in [`src/storage/`](src/storage/):

| Backend | Auth | Direct browser access? | Proxy needed? |
|---|---|---|---|
| **Dropbox** | OAuth2 **PKCE** (popup) | ✅ CORS OK (token + content) | No |
| **pCloud** | OAuth token (popup) | ⚠️ upload OK, read CORS-iffy | For reads only |
| **WebDAV / Nextcloud** | Basic (app password) | ❌ no CORS by default | Yes (unless server is CORS-enabled) |
| **Local file** | None (File System Access API) | ✅ Chrome/Edge only | No |

**Adding a backend** (Google Drive, S3/R2, OneDrive…) = write a factory function returning
a `Storage` and register it in [`src/storage/index.ts`](src/storage/index.ts).

## The optional shared proxy

For backends without CORS support, [`src/network/cloudflare-proxy/`](src/network/cloudflare-proxy/) is a
**generic forward proxy**: the app sends its request to `<proxy>/__proxy` with the
real target URL in the `x-target-url` header, and the worker forwards it with CORS
headers added. Enable it via `VITE_PROXY_URL`. Runs on Cloudflare's free tier (100k req/day).

> ⚠️ Restrict the proxy with `ALLOWED_HOSTS` in [`src/network/cloudflare-proxy/wrangler.toml`](src/network/cloudflare-proxy/wrangler.toml)
> so it can't be used as an open relay. Credentials that transit it stay on **your** worker.

## Quick start (local)

```bash
npm install
cp .env.example .env        # configure at least one backend (Dropbox is the easiest)

# Terminal 1 — WebRTC signaling server
npm run signaling           # ws://localhost:4444

# Terminal 2 — the app
npm run dev                 # http://localhost:5173
```

Open two tabs: type in one, it appears in the other with live cursors.
Pick a **Storage** backend from the pills under the header and connect it to
enable save/restore. App keys (Dropbox, pCloud) can be set either via `.env`
(below) or at runtime in the in-app **Settings** (⚙) panel — runtime values are
saved in the browser, and an `.env` value locks the field as deployment-managed.

### Set up Dropbox (recommended)

1. Create an app at https://www.dropbox.com/developers/apps → Scoped access, permissions `files.content.read` + `files.content.write`.
2. Under *Settings*, copy the **App key** — either into `.env` (`VITE_DROPBOX_APP_KEY`) or into the app's Settings (⚙) panel.
3. Under *OAuth 2 → Redirect URIs*, add your redirect URL(s) — see table below.

### Set up WebDAV / Nextcloud

1. Deploy the proxy ([`src/network/cloudflare-proxy/`](src/network/cloudflare-proxy/)) and set `VITE_PROXY_URL` (add your domain to `ALLOWED_HOSTS`).
2. In the app, choose **WebDAV / Nextcloud**, enter the folder URL (`https://…/remote.php/dav/files/USER/Collab`), your username, and a **Nextcloud app password**.

### Set up pCloud

Create an app at https://docs.pcloud.com → *My applications*, copy the **Client ID** into `VITE_PCLOUD_CLIENT_ID` (or into the app's Settings ⚙ panel), and add your redirect URL. The US/EU region is detected automatically from the OAuth response.

### OAuth redirect URIs

Add these in each provider's developer console:

| Environment | URI |
|---|---|
| Local dev | `http://localhost:5173/redirect.html` |
| GitHub Pages | `https://adriendellagaspera.github.io/copad/redirect.html` |

## How persistence works

- The document is stored as a **binary Yjs state** (a CRDT update, not HTML) — this enables clean merging across sessions.
- **Load**: on mount / after connecting, the adapter reads the file and applies it to the `Y.Doc`.
- **Save**: debounced autosave (3 s of inactivity) + `beforeunload`. To avoid race conditions, **only the peer with the lowest `clientID` writes** (leader election via Yjs awareness).
- **Local cache** (on by default): the doc is mirrored into the browser's IndexedDB (via [y-indexeddb](https://github.com/yjs/y-indexeddb)), so a **reload keeps your work even with no storage backend connected**. It's stored **unencrypted** in the browser regardless of any room password (that only encrypts the connection), so Settings ⚙ has a toggle to turn it off and a "Clear local copies" button for shared/untrusted devices.

## Cost breakdown

| Component | Hosting | Cost |
|---|---|---|
| Static frontend | Cloudflare Pages / Netlify / GitHub Pages | Free |
| Edit traffic (WebRTC P2P) | Peer-to-peer | $0 — no server involved |
| WebRTC signaling | Small WebSocket process (free tier) | Free |
| Document storage | User's own Dropbox / Nextcloud / pCloud | Already paid |
| (Optional) CORS proxy | Cloudflare Worker | Free |

**Bring-your-own-cloud model**: each user stores documents in their own account —
you only host a static frontend and a tiny signaling server.

## Deployment (production, free)

1. **Frontend**: `npm run build` → deploy `dist/`. GitHub Actions workflow included — see [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).
2. **A collaboration server** (required for real-time collab) — none ships in this repo; deploy the upstream server for your transport (see [Deploying a collaboration server](#deploying-a-collaboration-server)):
   - **WebRTC** (`VITE_COLLAB_TRANSPORT=webrtc`, the default): a y-webrtc signaling server; set `VITE_SIGNALING_URL` to its `wss://` URL. Peers connect P2P; on mobile/restrictive networks you'll also want a TURN relay (`VITE_TURN_URL`…).
   - **WebSocket hub** (`VITE_COLLAB_TRANSPORT=websocket`): a y-websocket hub; set `VITE_WEBSOCKET_URL` to its `wss://` URL. No WebRTC, so **no STUN/TURN** — works on any network.

   The URL **must** be `wss://` — browsers block insecure `ws://` from an `https://` page (mixed content). If the selected transport's server is unset, the app shows a warning banner and real-time collaboration stays disabled.
3. **(Optional) Proxy**: `cd src/network/cloudflare-proxy && npx wrangler deploy`, then set `VITE_PROXY_URL`.
4. Set `VITE_ROOM_PASSWORD` to end-to-end encrypt the P2P channel (WebRTC transport only — the WebSocket hub sees plaintext updates).

### Deploying a collaboration server

No server code lives in this repo — both transports run an **upstream package's bundled
server**, so deploying is just `npm install` + run its bin on any Node host (Render, Fly.io,
a VPS):

| Transport | Package | Bin | Reads |
|---|---|---|---|
| WebRTC (signaling) | [`y-webrtc`](https://github.com/yjs/y-webrtc) | `y-webrtc-signaling` | `PORT` |
| WebSocket (hub) | [`@y/websocket-server`](https://github.com/yjs/y-websocket-server) | `y-websocket-server` | `HOST`, `PORT` |

Create a folder with a 3-line `package.json` and deploy it (Render → New Web Service;
Fly.io → `fly launch`; or any VPS):

```json
{
  "dependencies": { "@y/websocket-server": "^0.1.5" },
  "scripts": { "start": "y-websocket-server" }
}
```

Swap in `"y-webrtc": "^10"` / `"start": "y-webrtc-signaling"` for the signaling server. The
host runs `npm install` (so `node_modules` lives there, not in this repo) then `npm start`;
set `HOST=0.0.0.0` if the platform needs it. The hub answers `okay` to an HTTP healthcheck.
Copy the resulting `wss://` URL into `VITE_WEBSOCKET_URL` (or `VITE_SIGNALING_URL`).

**Locally**, no setup needed — `npm run signaling` and `npm run collab` run the same bins
(`ws://localhost:4444` and `ws://localhost:1234`).

## Known limitations / future directions

- **WebRTC behind strict NAT**: public STUN is enough for most home/office networks. Mobile carriers use CGNAT / symmetric NAT, where STUN fails and a TURN relay is needed. Copad ships with a free **public default relay** so desktop↔mobile works out of the box (best-effort/rate-limited), and lets you bring your own — via `VITE_TURN_URL` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL`, **at runtime** in Settings → Connection, or self-hosted [coturn](https://github.com/coturn/coturn) (see [`turn/`](turn/)). The status bar's connection panel (📊 icon) shows whether each peer is **Direct** or **Relayed via TURN**, with a Reconnect button. Or sidestep WebRTC entirely with the WebSocket hub (`VITE_COLLAB_TRANSPORT=websocket`) — no STUN/TURN required.
- **OAuth token in the browser**: acceptable for a small app; the proxy can keep secrets server-side for a harder security posture.
- **Single authority**: if you want zero CORS/leader issues, replace y-webrtc with a small Yjs server ([Hocuspocus](https://tiptap.dev/docs/hocuspocus/introduction) / Cloudflare Durable Object) that persists via the same `StorageAdapter`.

## Project structure

```
src/
  storage/
    types.ts     # Storage interface (the port)
    oauth.ts     # PKCE helpers + OAuth popup
    pcloud.ts    # pCloud adapter
    dropbox.ts   # Dropbox adapter (PKCE)
    webdav.ts    # WebDAV / Nextcloud adapter
    local.ts     # Local file adapter (File System Access API, Chrome/Edge)
    index.ts     # registry of configured backends
  network/
    types.ts                # Fetch type alias
    direct.ts               # pass-through fetch
    cloudflare-proxy/       # generic CORS proxy (optional, Cloudflare Worker)
  collaboration/
    types.ts     # Collab + CollabConnect interfaces (the ports)
    webrtc.ts    # y-webrtc peer-to-peer adapter (default transport)
    websocket.ts # y-websocket hub adapter (opt-in via VITE_COLLAB_TRANSPORT=websocket)
    config.ts    # transport / signaling / ICE resolution from env
  editor/
    schema.ts    # ProseMirror schema (basic + lists + strike mark)
    plugins.ts   # keymap + input rules
    commands.ts  # toolbar commands + isMarkActive / isNodeActive helpers
    schema.test.ts
  Editor.svelte  # ProseMirror + Yjs binding + autosave / leader election
  Toolbar.svelte # rich-text toolbar (Svelte 5 $derived active states)
  App.svelte     # room management, storage picker, connect UI, collab transport wiring
  redirect.ts    # OAuth popup landing page (pCloud + Dropbox)
```

The collaboration servers are not vendored here — they're upstream packages run via their
bins (`y-webrtc-signaling`, `y-websocket-server`). See "Deploying a collaboration server".

## License

MIT
