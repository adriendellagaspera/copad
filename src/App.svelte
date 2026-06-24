<script lang="ts">
  import { untrack } from 'svelte';
  import { availableAdapters, DEFAULT_BACKEND } from './storage/index.js';
  import type { StorageAdapter } from './storage/types.js';
  import Editor from './Editor.svelte';

  const COLORS = ['#e11d48', '#7c3aed', '#0891b2', '#16a34a', '#d97706', '#db2777'];
  const color = COLORS[Math.floor((Date.now() / 1000) % COLORS.length)];

  const adapters = availableAdapters();
  let adapter = $state<StorageAdapter | null>(
    adapters.find(a => a.id === DEFAULT_BACKEND) ?? adapters[0] ?? null
  );
  let name = $state('Anonymous');
  let connected = $state(untrack(() => adapter?.isAuthenticated() ?? false));
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
    adapter = adapters.find(a => a.id === id) ?? null;
    connected = adapter?.isAuthenticated() ?? false;
    creds = {};
    error = '';
  }

  async function connect() {
    if (!adapter) return;
    busy = true;
    error = '';
    try {
      await adapter.connect(adapter.credentialFields ? creds : undefined);
      connected = true;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  function disconnect() {
    adapter?.disconnect();
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
      {#if adapters.length > 0}
        <label>
          Storage
          <select
            value={adapter?.id ?? ''}
            onchange={e => pick(e.currentTarget.value)}
            disabled={connected}
          >
            {#each adapters as a (a.id)}
              <option value={a.id}>{a.label}</option>
            {/each}
          </select>
        </label>
      {/if}
    </div>
  </header>

  {#if adapter}
    <section class="connect">
      {#if connected}
        <div class="connected">
          <span>✓ Connected to {adapter.label}</span>
          <button onclick={disconnect}>Disconnect</button>
        </div>
      {:else if adapter.credentialFields}
        <form class="creds" onsubmit={e => { e.preventDefault(); connect(); }}>
          {#each adapter.credentialFields as f (f.name)}
            <input
              type={f.type ?? 'text'}
              placeholder={f.placeholder ?? f.label}
              value={creds[f.name] ?? ''}
              oninput={e => { creds = { ...creds, [f.name]: e.currentTarget.value }; }}
            />
          {/each}
          <button class="primary" type="submit" disabled={busy}>
            {busy ? 'Connecting…' : `Connect ${adapter.label}`}
          </button>
        </form>
      {:else}
        <button class="primary" onclick={connect} disabled={busy}>
          {busy ? 'Connecting…' : `Connect ${adapter.label}`}
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
    <Editor {name} {color} {room} adapter={connected ? adapter : null} />
  {/key}
</div>
