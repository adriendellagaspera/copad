<script lang="ts">
  import { untrack } from 'svelte';
  import { backends, DEFAULT_BACKEND } from './storage/index.js';
  import { isConfigured } from './storage/types.js';
  import type { Storage } from './storage/types.js';
  import { webrtcCollab } from './collaboration/webrtc.js';
  import Editor from './Editor.svelte';
  import Settings from './Settings.svelte';

  const connect = webrtcCollab({
    signaling: (import.meta.env.VITE_SIGNALING_URL ?? 'ws://localhost:4444')
      .split(',')
      .map((s: string) => s.trim()),
    password: import.meta.env.VITE_ROOM_PASSWORD,
  });

  const COLORS = ['#e11d48', '#7c3aed', '#0891b2', '#16a34a', '#d97706', '#db2777'];
  const color = COLORS[Math.floor((Date.now() / 1000) % COLORS.length)];

  const storageBackends = backends();
  const availableBackends = storageBackends.filter(s => !s.unavailableReason);
  let storage = $state<Storage | null>(
    availableBackends.find(s => s.id === DEFAULT_BACKEND) ?? availableBackends[0] ?? null
  );
  let name = $state('Anonymous');
  let connected = $state(untrack(() => storage?.isAuthenticated() ?? false));
  let creds = $state<Record<string, string>>({});
  let busy = $state(false);
  let error = $state('');

  // Bumped when config/auth state changes outside Svelte's reactivity (localStorage).
  let tick = $state(0);
  const bump = () => { tick += 1; };

  let backendConfigured = $derived(tick >= 0 && !!storage && isConfigured(storage));

  // ── Settings ───────────────────────────────────────────────────────────────

  let settingsOpen = $state(false);
  let settingsFocus = $state('');

  function openSettings(id = '') {
    settingsFocus = id;
    settingsOpen = true;
  }

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

  type Status = 'unavailable' | 'setup' | 'ready' | 'connected';

  function statusOf(s: Storage): Status {
    void tick; // reactive dependency
    if (s.unavailableReason) return 'unavailable';
    if (!isConfigured(s)) return 'setup';
    if (s.isAuthenticated()) return 'connected';
    return 'ready';
  }

  function pick(id: string) {
    const s = storageBackends.find(s => s.id === id);
    if (!s || s.unavailableReason) return;
    storage = s;
    connected = s.isAuthenticated();
    creds = {};
    error = '';
  }

  function onPill(s: Storage) {
    if (s.unavailableReason) return;
    pick(s.id);
    if (statusOf(s) === 'setup') openSettings(s.id);
  }

  async function authenticate() {
    if (!storage) return;
    busy = true;
    error = '';
    try {
      await storage.connect(storage.credentialFields ? creds : undefined);
      connected = true;
      bump();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  function deauthenticate() {
    storage?.disconnect();
    connected = false;
    bump();
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
      <button class="icon-btn" onclick={() => openSettings()} title="Settings" aria-label="Settings">⚙</button>
    </div>
  </header>

  {#if storageBackends.length > 0}
    <div class="pills" role="group" aria-label="Storage backend">
      {#each storageBackends as s (s.id)}
        {@const st = statusOf(s)}
        <button
          class="pill {st}"
          class:selected={storage?.id === s.id}
          disabled={st === 'unavailable'}
          title={s.unavailableReason ?? s.blurb ?? s.label}
          onclick={() => onPill(s)}
        >
          <span class="pill-dot" aria-hidden="true"></span>
          {s.label}
          {#if st === 'connected'}<span class="pill-tag">✓</span>
          {:else if st === 'setup'}<span class="pill-tag">setup</span>
          {:else if st === 'unavailable'}<span class="pill-tag">n/a</span>{/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if storage}
    <section class="connect">
      {#if connected}
        <div class="connected">
          <span>✓ Connected to {storage.label}</span>
          <button onclick={deauthenticate}>Disconnect</button>
        </div>
      {:else if storage.unavailableReason}
        <p class="hint">{storage.unavailableReason}</p>
      {:else if !backendConfigured}
        <div class="needs-setup">
          <span>{storage.label} needs an app key.</span>
          <button class="primary" onclick={() => openSettings(storage!.id)}>Open Settings</button>
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

<Settings
  backends={storageBackends}
  bind:open={settingsOpen}
  focusId={settingsFocus}
  onchange={bump}
/>
