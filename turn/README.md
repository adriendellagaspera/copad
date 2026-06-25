# Self-hosted TURN relay (coturn) for Copad

A TURN relay lets WebRTC peers connect when a direct path is blocked — notably
**desktop ↔ mobile** on carrier networks (CGNAT / symmetric NAT), where STUN
alone fails. Copad uses a free public relay by default, but it's best-effort and
rate-limited; for reliability, run your own.

> **Why a VPS, not Render/Fly?** TURN needs a **range of UDP ports** for relayed
> media. Most managed PaaS platforms can't expose that range, so a small VM with
> a public IP (any cheap VPS) is the right home. coturn ships as a Docker image.

## Deploy

1. Copy this folder to your server and edit [`turnserver.conf`](turnserver.conf):
   - `realm` / `server-name` → your domain.
   - `external-ip` → the server's public IP (`PUBLIC/PRIVATE` if behind 1:1 NAT).
   - `user=copad:…` → a strong shared secret.
   - (Recommended) uncomment `cert` / `pkey` and mount TLS certs for `turns://`.

2. Open the firewall / security-group ports:
   - `3478/udp`, `3478/tcp`, `5349/tcp` (STUN/TURN + TLS)
   - `49160-49200/udp` (the relay range from `turnserver.conf`)

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
panel (no rebuild). A configured TURN overrides the public default.

## Verify

Use the WebRTC [Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)
test page: add `turn:your-domain:3478` with your username/credential and click
*Gather candidates*. You should see a candidate of type **relay** — that confirms
the relay works. In Copad, the status-bar connection panel will then report
peers as **Relayed via TURN** when a direct path isn't available.
