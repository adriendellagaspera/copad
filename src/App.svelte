<script lang="ts">
  import { untrack } from 'svelte';
  import { backends, DEFAULT_BACKEND } from './storage/index.js';
  import type { Storage } from './storage/types.js';
  import { webrtcCollab } from './collaboration/webrtc.js';
  import Editor from './Editor.svelte';

  const connect = webrtcCollab({
    signaling: (import.meta.env.VITE_SIGNALING_URL ?? 'ws://localhost:4444')
      .split(',')
      .map((s: string) => s.trim()),
    password: import.meta.env.VITE_ROOM_PASSWORD,
  });

  const COLORS = ['#e11d48', '#7c3aed', '#0891b2', '#16a34a', '#d97706', '#db2777'];
  const color = COLORS[Math.floor((Date.now() / 1000) % COLORS.length)];

  const storageBackends = backends();
  let storage = $state<Storage | null>(
    storageBackends.find(s => s.id === DEFAULT_BACKEND) ?? storageBackends[0] ?? null
  );
  let name = $state('Anonymous');
  let connected = $state(untrack(() => storage?.isAuthenticated() ?? false));
  let creds = $state<Record<string, string>>({});
  let busy = $state(false);
  let error = $state('');

  // ── Document / room ────────────────────────────────────────────────────────

  const DEFAULT_ROOM = import.meta.env.VITE_ROOM ?? 'copad-demo';

  function roomFromUrl(): string {
    return new URLSearchParams(location.search).get('room') || DEFAULT_ROOM;
  }

  let room = $state(roomFromUrl());

  function goToRoom(id: string) {
    const r = id.trim() || DEFAULT_ROOM;
    const qs = r === DEFAULT_ROOM ? '' : `?room=${encodeURIComponent(r)}`;
    history.pushState({}, '', location.pathname + qs);
    room = r;
  }

  function newRoom() {
    goToRoom(Math.random().toString(36).slice(2, 10));
  }

  // ── Storage ────────────────────────────────────────────────────────────────

  function pick(id: string) {
    storage = storageBackends.find(s => s.id === id) ?? null;
    connected = storage?.isAuthenticated() ?? false;
    creds = {};
    error = '';
  }

  async function authenticate() {
    if (!storage) return;
    busy = true;
    error = '';
    try {
      await storage.connect(storage.credentialFields ? creds : undefined);
      connected = true;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  function deauthenticate() {
    storage?.disconnect();
    connected = false;
  }
</script>

<div class="app">
  <header>
    <h1>Copad</h1>
    <div class="controls">
      <label>
        Name
        <input bind:value={name} />
      </label>
      <label class="room-label">
        Doc
        <input
          value={room}
          onchange={e => goToRoom(e.currentTarget.value)}
          onkeydown={e => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </label>
      <button class="btn-new" onclick={newRoom} title="New document">New</button>
      {#if storageBackends.length > 0}
        <label>
          Storage
          <select
            value={storage?.id ?? ''}
            onchange={e => pick(e.currentTarget.value)}
            disabled={connected}
          >
            {#each storageBackends as s (s.id)}
              <option value={s.id}>{s.label}</option>
            {/each}
          </select>
        </label>
      {/if}
    </div>
  </header>

  {#if storage}
    <section class="connect">
      {#if connected}
        <div class="connected">
          <span>✓ Connected to {storage.label}</span>
          <button onclick={deauthenticate}>Disconnect</button>
        </div>
      {:else if storage.credentialFields}
        <form class="creds" onsubmit={e => { e.preventDefault(); authenticate(); }}>
          {#each storage.credentialFields as f (f.name)}
            <input
              type={f.type ?? 'text'}
              placeholder={f.placeholder ?? f.label}
              value={creds[f.name] ?? ''}
              oninput={e => { creds = { ...creds, [f.name]: e.currentTarget.value }; }}
            />
          {/each}
          <button class="primary" type="submit" disabled={busy}>
            {busy ? 'Connecting…' : `Connect ${storage.label}`}
          </button>
        </form>
      {:else}
        <button class="primary" onclick={authenticate} disabled={busy}>
          {busy ? 'Connecting…' : `Connect ${storage.label}`}
        </button>
      {/if}
      {#if error}<p class="error">{error}</p>{/if}
    </section>
  {/if}

  {#if !connected}
    <p class="hint">
      You can collaborate <strong>right now</strong> — P2P, no server.
      Connect a storage backend to <strong>save &amp; restore</strong> the document across sessions.
    </p>
  {/if}

  {#key room}
    <Editor {name} {color} {room} {connect} storage={connected ? storage : null} />
  {/key}
</div>
