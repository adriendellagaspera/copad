# Copad

> **⚠️ Work in progress.** The architecture is solid but the stack is being reconsidered (see [issues](https://github.com/adriendellagaspera/copad/issues)). Not ready for production use.

I wanted to collaborate on a file in my pCloud. Nothing let me. So I built this.

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

- **Real-time collaboration** → [Yjs](https://github.com/yjs/yjs) (CRDT) + [y-webrtc](https://github.com/yjs/y-webrtc): edits merge without conflicts and travel **peer-to-peer** — no server in the data path.
- **Persistence** → a swappable `StorageAdapter`: loads the document on startup, autosaves on changes. The storage layer only ever sees an **opaque binary blob** (the Yjs snapshot) — it knows nothing about CRDTs.

The editor is [TipTap v3](https://tiptap.dev) (bold, headings, lists, quotes, code…).

```
TipTap editor
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
interface StorageAdapter {
  id: string; label: string;
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

**Adding a backend** (Google Drive, S3/R2, OneDrive…) = write a class that implements
`StorageAdapter` and register it in [`src/storage/index.ts`](src/storage/index.ts).

## The optional shared proxy

For backends without CORS support, [`cloudflare-worker/`](cloudflare-worker/) is a
**generic forward proxy**: the app sends its request to `<proxy>/__proxy` with the
real target URL in the `x-target-url` header, and the worker forwards it with CORS
headers added. Enable it via `VITE_PROXY_URL`. Runs on Cloudflare's free tier (100k req/day).

> ⚠️ Restrict the proxy with `ALLOWED_HOSTS` in [`wrangler.toml`](cloudflare-worker/wrangler.toml)
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
Pick a **Storage** backend in the header and connect it to enable save/restore.

### Set up Dropbox (recommended)

1. Create an app at https://www.dropbox.com/developers/apps → Scoped access, permissions `files.content.read` + `files.content.write`.
2. Under *Settings*, copy the **App key** into `.env` (`VITE_DROPBOX_APP_KEY`).
3. Under *OAuth 2 → Redirect URIs*, add your redirect URL(s) — see table below.

### Set up WebDAV / Nextcloud

1. Deploy the proxy ([`cloudflare-worker/`](cloudflare-worker/)) and set `VITE_PROXY_URL` (add your domain to `ALLOWED_HOSTS`).
2. In the app, choose **WebDAV / Nextcloud**, enter the folder URL (`https://…/remote.php/dav/files/USER/Collab`), your username, and a **Nextcloud app password**.

### Set up pCloud

Create an app at https://docs.pcloud.com → *My applications*, copy the **Client ID** into `VITE_PCLOUD_CLIENT_ID`, and add your redirect URL. The US/EU region is detected automatically from the OAuth response.

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
2. **Signaling**: deploy `node_modules/y-webrtc/bin/server.js` (Fly.io, Render…) over `wss://` and set `VITE_SIGNALING_URL`.
3. **(Optional) Proxy**: `cd cloudflare-worker && npx wrangler deploy`, then set `VITE_PROXY_URL`.
4. Set `VITE_ROOM_PASSWORD` to end-to-end encrypt the P2P channel.

## Known limitations / future directions

- **WebRTC behind strict NAT**: public STUN is usually enough; a TURN server (small cost) is only needed for very restrictive networks.
- **OAuth token in the browser**: acceptable for a small app; the proxy can keep secrets server-side for a harder security posture.
- **Single authority**: if you want zero CORS/leader issues, replace y-webrtc with a small Yjs server ([Hocuspocus](https://tiptap.dev/docs/hocuspocus/introduction) / Cloudflare Durable Object) that persists via the same `StorageAdapter`.

## Project structure

```
src/
  storage/
    types.ts     # StorageAdapter interface
    net.ts       # fetch with optional proxy
    oauth.ts     # PKCE helpers + OAuth popup
    pcloud.ts    # pCloud adapter
    dropbox.ts   # Dropbox adapter (PKCE)
    webdav.ts    # WebDAV / Nextcloud adapter
    index.ts     # registry of configured backends
  Editor.tsx     # Yjs + y-webrtc + TipTap + autosave / leader election
  Toolbar.tsx    # rich-text toolbar
  App.tsx        # backend picker + connect UI
  redirect.ts    # OAuth popup landing page (pCloud + Dropbox)
cloudflare-worker/ # generic CORS proxy (optional, free)
```

## License

MIT
