# Copad

[![CI](https://github.com/adriendellagaspera/copad/actions/workflows/ci.yml/badge.svg)](https://github.com/adriendellagaspera/copad/actions/workflows/ci.yml)
[![Deploy](https://github.com/adriendellagaspera/copad/actions/workflows/deploy.yml/badge.svg)](https://github.com/adriendellagaspera/copad/actions/workflows/deploy.yml)

Copad is a browser-based editor for collaborating on a document and saving it as a file in a
storage backend you choose. Share a room link to edit together; connect storage when the document
must remain available after everyone leaves.

A room has no server-side document history. When you are alone without durable storage, the editor
is read-only by default. You can choose **Write alone anyway**, but those edits remain on this
device until a peer joins. See the [durability and collaboration contract](docs/contract.md) for
the full behavior before relying on Copad for important work.

## Try it locally

Install dependencies and copy the example configuration:

```sh
npm ci
cp .env.example .env
```

Run signaling and the app in separate terminals:

```sh
npm run signaling
```

```sh
npm run dev
```

Open `http://localhost:5173` in one browser tab and use **Share** to open the same room link in
a second tab. With both peers present, edits appear in the shared document. Close one tab to see
the solo write gate. To save a document beyond the room, connect a supported storage backend in
the app; some backends require OAuth configuration in `.env` and a registered local redirect URI.

The default collaboration transport is peer-to-peer WebRTC with a signaling server. A WebSocket
hub is available as an alternative. Storage is a separate concern; the
[architecture reference](docs/architecture.md) lists backends and configuration.

## Deploy or contribute

Build the static frontend with `npm run build` and serve `dist/`. Collaboration needs a
signaling server or WebSocket hub configured for the deployed origin. See the
[deployment settings](docs/architecture.md#environment-variables) and
[TURN notes](deploy/turn/README.md).

For development, install the repository hooks with
`ln -s ../../pre-commit .git/hooks/pre-commit` and
`ln -s ../../pre-push .git/hooks/pre-push`. [AGENTS.md](AGENTS.md) lists the checks and
repository rules. MIT licensed.
