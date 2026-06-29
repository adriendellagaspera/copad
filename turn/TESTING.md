# Testing the TURN relay

The relay is infra, not app code, so there's nothing in `npm test` for it.
Validation is manual and splits into three tiers by how much you stand up. Tiers
0–1 need only Docker; full NAT traversal and TLS (Tier 2) need a public-IP VPS.

The Tier 0 checks (compose validity, the `.gitignore` guard, and the presence of
the hardening directives) also run automatically in CI — see the `turn` job in
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

## Tier 0 — no server (~2 min)

Catches the mechanical guarantees: a pinned image, and that the live config can't
be committed.

```bash
# Compose is valid and the image is pinned (not :latest)
docker compose -f turn/docker-compose.yml config | grep image

# The live config (with real secrets) is git-ignored
cp turn/turnserver.conf.example turn/turnserver.conf
printf '\nuser=copad:my-real-secret\n' >> turn/turnserver.conf
git check-ignore turn/turnserver.conf    # prints the path → it's ignored
git status --porcelain turn/             # turnserver.conf must NOT be listed
rm -f turn/turnserver.conf
```

## Tier 1 — local Docker smoke test (~10 min, no VPS)

Confirms coturn starts cleanly, parses every directive, and issues a working
allocation. Validates the widened relay range and the quotas at the "coturn
accepted them" level.

```bash
cp turn/turnserver.conf.example turn/turnserver.conf
# In turn/turnserver.conf set:
#   external-ip=<your-LAN-IP>     e.g. 192.168.1.20  (the relay's own address,
#                                  NOT a peer — unaffected by the deny list)
#   realm=test.local
#   user=copad:testsecret
docker compose -f turn/docker-compose.yml up      # foreground, watch the logs
```

In the logs, confirm the hardening parsed (the real check that the directives are
valid syntax for your coturn version):

- `relay <ip> ... range [49152, 65535]` — the widened port range
- the `denied-peer-ip` ranges echoed, including `127.0.0.0`, `169.254.0.0`,
  `100.64.0.0`, and the IPv6 lines
- `total-quota` / bandwidth (`max-bps`) accepted
- **no** `Cannot parse` / `Unknown option` warnings

Then prove auth + allocation with the
[Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)
page:

- Server `turn:<your-LAN-IP>:3478`, username `copad`, credential `testsecret` →
  **Gather candidates** → you should see a candidate of type **relay**.

> "Gather candidates" only needs the allocation to succeed, so it works even
> though the deny ranges now block actual relayed traffic to private/loopback
> peers — which is the intended behaviour.

## Tier 2 — real VPS (the only place TLS and NAT traversal are real)

NAT traversal and `turns://` TLS can't be exercised locally.

```bash
# After deploying turn/ with a real turnserver.conf + Let's Encrypt certs
# (uncomment cert/pkey), confirm the TLS listener is actually up:
openssl s_client -connect your-domain:5349 </dev/null 2>/dev/null \
  | openssl x509 -noout -dates
```

- Trickle ICE against **`turns:your-domain:5349`** (the production scheme, not
  just `turn:3478`) → expect a **relay** candidate. None here = certs not loaded.
- End-to-end in Copad: set `VITE_TURN_URL=turns:your-domain:5349` (+ user/cred)
  or enter them in **Settings → Connection**, open the doc on desktop + a phone on
  cellular, and confirm the status-bar connection panel reports
  **Relayed via TURN**.

## Rigorously verifying the SSRF deny ranges

The deny list is declarative, so the Tier 1 log check is the practical
confirmation. For a true functional proof that a denied peer is refused, coturn
ships `turnutils_uclient` / `turnutils_peer` in the same image:

```bash
# Point a relay attempt at a DENIED address (e.g. 127.0.0.1) and expect failure;
# repeat against an allowed public IP and expect success.
docker exec -it <coturn> \
  turnutils_uclient -u copad -w testsecret -e 127.0.0.1 -y <coturn-host>
# coturn logs "...peer 127.0.0.1 ... denied" and the relay fails.
```
