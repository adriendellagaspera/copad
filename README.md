# Copad

[![CI](https://github.com/adriendellagaspera/copad/actions/workflows/ci.yml/badge.svg)](https://github.com/adriendellagaspera/copad/actions/workflows/ci.yml)
[![Deploy](https://github.com/adriendellagaspera/copad/actions/workflows/deploy.yml/badge.svg)](https://github.com/adriendellagaspera/copad/actions/workflows/deploy.yml)

Collaborate on a document stored as a file in your chosen backend.

Copad keeps the editor read-only when you are alone in a peer-to-peer room without durable storage. You can
explicitly choose **Write alone anyway**; edits then stay on this device until a peer joins. Read the
[durability and collaboration contract](docs/contract.md) before relying on Copad for work you cannot afford to
lose.

The editor uses ProseMirror and Yjs. Live collaboration runs through WebRTC by default or an optional WebSocket
hub; file storage uses separate adapters. The [architecture](docs/architecture.md) defines their behavior,
supported backends and environment variables.

## Run locally

```sh
npm install
cp .env.example .env
npm run signaling
npm run dev
```

Open two tabs at `http://localhost:5173`, then connect a storage backend to save and restore files. For local
OAuth, register `http://localhost:5173/redirect.html` with the provider.

## Deploy

Build the static frontend with `npm run build` and serve `dist/`. Collaboration also requires a signaling server
(`y-webrtc`) or WebSocket server (`@y/websocket-server`), configured with the relevant `VITE_*` URL. See the
[deployment and environment reference](docs/architecture.md#environment-variables) and the
[TURN notes](deploy/turn/README.md).

## Develop

Install the repository hooks with `ln -s ../../pre-commit .git/hooks/pre-commit` and
`ln -s ../../pre-push .git/hooks/pre-push`. [AGENTS.md](AGENTS.md) lists the checks and repository rules.

MIT licensed.
