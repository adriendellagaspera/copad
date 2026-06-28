# Self-hosted TURN relay (coturn) for Copad

A TURN relay lets WebRTC peers connect when a direct path is blocked — notably
**desktop ↔ mobile** on carrier networks (CGNAT / symmetric NAT), where STUN
alone fails. Copad uses a free public relay by default, but it's best-effort and
rate-limited; for reliability, run your own.

> **Why a VPS, not Render/Fly?** TURN needs a **range of UDP ports** for relayed
> media. Most managed PaaS platforms can't expose that range, so a small VM with
> a public IP (any cheap VPS) is the right home. coturn ships as a Docker image.

> ⚠ **The TURN credential is public.** However you configure it (a `VITE_*` build
> var is inlined into the client bundle; the in-app Settings panel stores it in
> the browser), anyone who loads Copad can read it and relay traffic through your
> server. Treat it as a **shared, rotatable key, not a secret** — the quotas in
> [`turnserver.conf.example`](turnserver.conf.example) cap abuse, and you can
> rotate the secret anytime. For a hardened setup, use time-limited HMAC
> credentials (`use-auth-secret`, noted in the config) behind a small token
> endpoint so the static secret never reaches the browser.

## Deploy

1. Copy the template to your live config (the live `turnserver.conf` is
   git-ignored so your secret and IP never get committed), then edit it:
   ```bash
   cp turnserver.conf.example turnserver.conf
   ```
   - `realm` / `server-name` → your domain.
   - `external-ip` → the server's public IP (`PUBLIC/PRIVATE` if behind 1:1 NAT).
   - `user=copad:…` → a strong shared secret.
   - (Recommended) uncomment `cert` / `pkey` and mount TLS certs for `turns://`.

2. Open the firewall / security-group ports:
   - `3478/udp`, `3478/tcp`, `5349/tcp` (STUN/TURN + TLS)
   - `49152-65535/udp` (the relay range from `turnserver.conf`)

3. Start it:
   ```bash
   docker compose up -d
   docker compose logs -f      # check it started cleanly
   ```

## Point Copad at it

Either set build-time env vars (see [`.env.example`](../.env.example)):

```
VITE_TURN_URL=turns:your-domain:5349
VITE_TURN_USERNAME=copad
VITE_TURN_CREDENTIAL=CHANGE_ME_STRONG_SECRET
```

…or enter the same values at runtime in the app's **Settings → Connection**
panel (no rebuild). A configured TURN overrides the public default. Both expose
the credential to anyone using the app (see the warning above) — the difference
is only build-time vs. runtime, not secret vs. public.

## Verify

Use the WebRTC [Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)
test page. **Test the same `turns:` (TLS) URL you put in `VITE_TURN_URL`**, not
just plain `turn:` — plain `turn:` on port 3478 succeeds even when TLS is
misconfigured (missing/expired cert), so it gives false confidence in the path
production traffic actually uses:

- Add `turns:your-domain:5349` with your username/credential and click
  *Gather candidates*. A candidate of type **relay** confirms the TLS relay works.
- If you see no `relay` candidate on `turns:5349`, your certs aren't loaded
  (the `cert`/`pkey` lines are commented out by default) — fix that before
  relying on it. As a sanity check that auth + the UDP range are right, plain
  `turn:your-domain:3478` should also yield a `relay` candidate.

In Copad, the status-bar connection panel will then report peers as
**Relayed via TURN** when a direct path isn't available.
