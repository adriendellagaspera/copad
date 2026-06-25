#!/usr/bin/env node
// y-webrtc signaling server — standalone, only depends on `ws`.
// Source: y-webrtc/bin/server.js (MIT) with lib0/map inlined.

import { WebSocketServer } from 'ws';
import http from 'http';

const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;

const pingTimeout = 30000;
const port = process.env.PORT || 4444;

const wss = new WebSocketServer({ noServer: true });

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('okay');
});

/** @type {Map<string, Set<any>>} */
const topics = new Map();

const setIfUndefined = (map, key, init) => {
  let v = map.get(key);
  if (v === undefined) { v = init(); map.set(key, v); }
  return v;
};

const send = (conn, message) => {
  if (conn.readyState !== wsReadyStateConnecting && conn.readyState !== wsReadyStateOpen) {
    conn.close();
    return;
  }
  try {
    conn.send(JSON.stringify(message));
  } catch {
    conn.close();
  }
};

wss.on('connection', conn => {
  const subscribedTopics = new Set();
  let closed = false;
  let pongReceived = true;

  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      conn.close();
      clearInterval(pingInterval);
    } else {
      pongReceived = false;
      try { conn.ping(); } catch { conn.close(); }
    }
  }, pingTimeout);

  conn.on('pong', () => { pongReceived = true; });

  conn.on('close', () => {
    subscribedTopics.forEach(topicName => {
      const subs = topics.get(topicName) || new Set();
      subs.delete(conn);
      if (subs.size === 0) topics.delete(topicName);
    });
    subscribedTopics.clear();
    closed = true;
    clearInterval(pingInterval);
  });

  conn.on('message', raw => {
    let message;
    try {
      message = JSON.parse(raw);
    } catch { return; }
    if (!message?.type || closed) return;

    switch (message.type) {
      case 'subscribe':
        (message.topics || []).forEach(topicName => {
          if (typeof topicName !== 'string') return;
          setIfUndefined(topics, topicName, () => new Set()).add(conn);
          subscribedTopics.add(topicName);
        });
        break;
      case 'unsubscribe':
        (message.topics || []).forEach(topicName => {
          topics.get(topicName)?.delete(conn);
        });
        break;
      case 'publish':
        if (message.topic) {
          const receivers = topics.get(message.topic);
          if (receivers) {
            message.clients = receivers.size;
            receivers.forEach(r => send(r, message));
          }
        }
        break;
      case 'ping':
        send(conn, { type: 'pong' });
    }
  });
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, ws => {
    wss.emit('connection', ws, request);
  });
});

server.listen(port, () => {
  console.log(`Signaling server listening on port ${port}`);
});
