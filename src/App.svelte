<script lang="ts">
  import { backends, DEFAULT_BACKEND } from './storage/index.js';
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

  // Start with whichever backend is already authenticated (returning user),
  // falling back to the env-var default or the first available.
  function initialStorage(): Storage | null {
    const authed = storageBackends.find(s => s.isAuthenticated());
    if (authed) return authed;
    const byDefault = storageBackends.find(s => !s.unavailableReason && s.id === DEFAULT_BACKEND);
    return byDefault ?? storageBackends.find(s => !s.unavailableReason) ?? null;
  }

  let storage = $state<Storage | null>(initialStorage());
  let name = $state('Anonymous');

  // Bumped when localStorage state changes (config saved, auth token stored).
  let tick = $state(0);
  const bump = () => { tick += 1; };

  // Derived so bump() after connect/disconnect recomputes automatically.
  let connected = $derived(tick >= 0 && !!storage && storage.isAuthenticated());

  // ── Settings ───────────────────────────────────────────────────────────────

  let settingsOpen = $state(false);
  let settingsFocus = $state('');

  function openSettings(id = '') {
    settingsFocus = id;
    settingsOpen = true;
  }

  function afterConnect(s: Storage) {
    storage = s;
    bump();
  }

  function afterDisconnect(_s: Storage) {
    bump();
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



  {#if !connected}
    <p class="hint">
      You can collaborate <strong>right now</strong> — P2P, no server.
      Set up a storage backend in <button class="link" onclick={() => openSettings()}>Settings ⚙</button>
      to <strong>save &amp; restore</strong> the document across sessions.
    </p>
  {/if}

  {#key room}
    <Editor
      {name}
      {color}
      {room}
      {connect}
      storage={connected ? storage : null}
      onstoragestatus={() => openSettings()}
    />
  {/key}
</div>

<Settings
  backends={storageBackends}
  bind:open={settingsOpen}
  focusId={settingsFocus}
  onchange={bump}
  onconnect={afterConnect}
  ondisconnect={afterDisconnect}
/>
