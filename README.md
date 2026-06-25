# Copad

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

- **Real-time collaboration** → [Yjs](https://github.com/yjs/yjs) (CRDT) + [y-webrtc](https://github.com/yjs/y-webrtc): edits merge without conflicts and travel **peer-to-peer** — no server in the data path.
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
2. **Signaling** (required for real-time collab): deploy the `signaling/` subfolder (standalone Node.js app — only depends on `ws`). See [Deploying the signaling server](#deploying-the-signaling-server) below. Once deployed, set the GitHub secret `VITE_SIGNALING_URL` to its `wss://` URL. It **must** be `wss://` — browsers block insecure `ws://` from an `https://` page (mixed content). If left unset, the app shows a warning banner and real-time collaboration stays disabled.
3. **(Optional) Proxy**: `cd src/network/cloudflare-proxy && npx wrangler deploy`, then set `VITE_PROXY_URL`.
4. Set `VITE_ROOM_PASSWORD` to end-to-end encrypt the P2P channel.

### Deploying the signaling server

The `signaling/` directory is a self-contained Node.js app (only depends on `ws`) that can be deployed independently — no link to the frontend project's `node_modules`.

**Option A — Render (free tier, simplest)**

1. Go to [render.com](https://render.com) → New → Web Service → connect your repo.
2. Set **Root Directory** to `signaling`.
3. Build command: `npm install` — Start command: `npm start`.
4. Copy the generated URL → set it as `VITE_SIGNALING_URL=wss://your-app.onrender.com` in GitHub Secrets.

Or use the included `signaling/render.yaml` for the Render Blueprint flow.

**Option B — Fly.io (always-on)**

```bash
cd signaling
fly launch          # first time: creates the app, edit fly.toml app name
fly deploy          # subsequent deploys
```

Then set `VITE_SIGNALING_URL=wss://your-app-name.fly.dev` in GitHub Secrets.

**Verify**

```bash
curl https://your-signaling-server.example   # should print "okay"
```

Once the secret is set and the frontend redeployed, the app's status pill changes from "Connecting…" to "No peers yet" when the signaling server is reachable.

## Known limitations / future directions

- **WebRTC behind strict NAT**: public STUN is enough for most home/office networks. Mobile carriers use CGNAT / symmetric NAT, where STUN fails — configure a TURN relay via `VITE_TURN_URL` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` (see `.env.example`). Run e.g. [coturn](https://github.com/coturn/coturn) or use a hosted provider.
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
    webrtc.ts    # y-webrtc peer-to-peer adapter
  editor/
    schema.ts    # ProseMirror schema (basic + lists + strike mark)
    plugins.ts   # keymap + input rules
    commands.ts  # toolbar commands + isMarkActive / isNodeActive helpers
    schema.test.ts
  Editor.svelte  # ProseMirror + Yjs binding + autosave / leader election
  Toolbar.svelte # rich-text toolbar (Svelte 5 $derived active states)
  App.svelte     # room management, storage picker, connect UI, webrtc wiring
  redirect.ts    # OAuth popup landing page (pCloud + Dropbox)
```

## License

MIT
