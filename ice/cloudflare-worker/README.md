# ICE-credentials Worker (Cloudflare TURN) for Copad

Cloudflare's TURN service doesn't give you a static username/password — you mint
**short-lived** credentials from a **secret API token** via an authenticated API
call. That token must never reach the browser, so a tiny server-side endpoint has
to sit in between. This is that endpoint: a Cloudflare Worker that holds the API
token as a secret, mints fresh credentials on each request, and returns them to
the Copad frontend.

```
browser ──GET──▶ Worker ──POST(+secret token)──▶ Cloudflare TURN API
        ◀──{ iceServers }──┘ (ephemeral creds only; token stays server-side)
```

Copad fetches this endpoint when **`VITE_ICE_SERVERS_URL`** is set, using the
returned servers in place of the static `VITE_TURN_*` config. Because the creds
are minted per request, they auto-rotate — no expiry to babysit (a page reload
gets fresh ones).

## Prerequisites

- A **Cloudflare TURN** app (Dashboard → Realtime → TURN). Note its **Token ID**
  and generate an **API token**.
- [`wrangler`](https://developers.cloudflare.com/workers/wrangler/) installed and
  logged in (`npx wrangler login`).

## Deploy

From this directory:

1. Edit [`wrangler.toml`](wrangler.toml): set `TURN_KEY_ID` to your TURN Token ID,
   and set `ALLOWED_ORIGIN` to your Copad origin (e.g.
   `https://adriendellagaspera.github.io`) so only your site can spend your quota.

2. Store the API token as a **secret** (this is the value that must stay private —
   it is NOT put in `wrangler.toml`):
   ```bash
   wrangler secret put TURN_API_TOKEN
   # paste your Cloudflare TURN API token when prompted
   ```

3. Deploy:
   ```bash
   wrangler deploy
   ```
   Wrangler prints the Worker URL, e.g. `https://turn.<your-subdomain>.workers.dev`.

4. Verify it returns credentials:
   ```bash
   curl https://turn.<your-subdomain>.workers.dev
   # → {"iceServers":[{"urls":[...],"username":"...","credential":"..."}]}
   ```

## Point Copad at it

Set the build-time env var (see [`../../.env.example`](../../.env.example)):

```
VITE_ICE_SERVERS_URL=https://turn.<your-subdomain>.workers.dev
```

On startup Copad fetches this URL, then reconnects with the returned TURN relay —
no rebuild needed to rotate credentials, and the API token never ships in the
client bundle. In the status-bar connection panel you'll then see peers reported
as **Relayed via TURN** when a direct path isn't available.

> **Note:** this replaces the static `VITE_TURN_*` path. A user's own TURN entered
> at runtime in **Settings → Connection** still takes precedence; the fetched
> endpoint beats the static env/public-default relay.
