<script lang="ts">
  import { backends, DEFAULT_BACKEND } from './storage/index.js';
  import type { StorageBackend } from './storage/index.js';
  import { webrtcCollab } from './collaboration/webrtc.js';
  import { websocketCollab } from './collaboration/websocket.js';
  import {
    resolveSignaling,
    resolveIceServers,
    resolveWebsocket,
    resolveTransport,
    resolveRoomStrategy,
    resolveDefaultRoom,
    type PageProtocol,
    type PageHostname,
  } from './collaboration/config.js';
  import { parseRoomId } from './collaboration/parse.js';
  import {
    localCacheEnabled,
    setLocalCacheEnabled,
    clearLocalCache,
    type LocalCacheEnabled,
  } from './collaboration/cache.js';
  import { roomPassword } from './collaboration/roomAccess.js';
  import { currentSecretKey } from './collaboration/secretLink.js';
  import type { RoomCipher } from './collaboration/roomCipher.js';
  import { getTurnPrefs, setTurnPrefs, type TurnPrefs } from './collaboration/turn.js';
  import type { SessionRole, DisplayName, CursorColor, RoomId, CollabConnect } from './collaboration/types.js';
  import Editor from './Editor.svelte';
  import Settings from './Settings.svelte';
  import ThemeToggle from './ui/ThemeToggle.svelte';
  import ShareDialog from './ui/ShareDialog.svelte';
  import Toast from './ui/Toast.svelte';
  import InfoBanner from './ui/InfoBanner.svelte';
  import { createTheme } from './ui/theme.svelte.js';
  import { createToasts } from './ui/toasts.svelte.js';

  const theme = createTheme();
  const toasts = createToasts();
  let shareOpen = $state(false);

  // Effective per-room cipher (WebRTC end-to-end encryption). Resolved fresh on
  // each connect, in precedence order: secure-link key (#k= in the URL) → per-room
  // password (set in the Share dialog) → the deployment's configured VITE_ROOM_AUTH
  // strategy. The Editor remounts on a security change (collabEpoch), so a link or
  // password set in Share takes effect on the next connection.
  const { cipher: envCipher } = resolveRoomStrategy(import.meta.env.VITE_ROOM_AUTH);
  const perRoomPassword = roomPassword();
  const roomCipher: RoomCipher = {
    password: (r) => currentSecretKey() ?? perRoomPassword.credential(r) ?? envCipher.password(r),
  };
  // Cast browser Location to typed PageLocation — single IO-boundary parse site.
  const loc = {
    protocol: location.protocol as PageProtocol,
    hostname: location.hostname as PageHostname,
  };

  // Pick the collaboration transport — chosen explicitly via VITE_COLLAB_TRANSPORT
  // (default 'webrtc'). 'websocket' routes edits through a central hub server (no
  // WebRTC, so no STUN/TURN — works on mobile carrier NATs where P2P can't connect).
  // Transport + its config are decided once; the cache flag is applied per build
  // so toggling the local cache can rebuild `connect` (and remount the Editor).
  function planCollab(): {
    build: (cache: LocalCacheEnabled) => CollabConnect;
    warning?: string;
    technicalWarning?: string;
  } {
    if (resolveTransport(import.meta.env.VITE_COLLAB_TRANSPORT) === 'websocket') {
      const ws = resolveWebsocket(import.meta.env.VITE_WEBSOCKET_URL, loc);
      if (ws.url) {
        // Pin the narrowed (non-empty) WebsocketUrl in a const so it stays branded
        // inside the build closure — TS won't carry property narrowing into it.
        const url = ws.url;
        return { build: (cache) => websocketCollab({ url, cache }), warning: ws.warning };
      }
      // Misconfigured: transport selected but no URL — warn and fall back to WebRTC.
      console.warn('Copad: VITE_COLLAB_TRANSPORT=websocket but VITE_WEBSOCKET_URL is unset — using WebRTC.');
    }
    const signaling = resolveSignaling(import.meta.env.VITE_SIGNALING_URL, loc);
    // ICE is resolved per build (not once) so runtime TURN changes from Settings
    // apply on the next reconnect. Precedence: runtime TURN → env TURN → public default.
    const buildIce = (): RTCIceServer[] => {
      const turn = getTurnPrefs();
      return resolveIceServers(
        {
          VITE_STUN_URL: import.meta.env.VITE_STUN_URL,
          VITE_TURN_URL: turn.url || import.meta.env.VITE_TURN_URL,
          VITE_TURN_USERNAME: turn.url ? turn.username : import.meta.env.VITE_TURN_USERNAME,
          VITE_TURN_CREDENTIAL: turn.url ? turn.credential : import.meta.env.VITE_TURN_CREDENTIAL,
        },
        { defaultTurn: turn.useDefault },
      );
    };
    const cipher = roomCipher;
    return {
      build: (cache) =>
        webrtcCollab({
          signaling: signaling.servers,
          cipher,
          iceServers: buildIce(),
          cache,
        }),
      warning: signaling.warning,
      technicalWarning: signaling.technicalWarning,
    };
  }

  const collabPlan = planCollab();
  if (collabPlan.technicalWarning ?? collabPlan.warning) {
    console.warn(`Copad: ${collabPlan.technicalWarning ?? collabPlan.warning}`);
  }
  const collabWarning = collabPlan.warning;

  // Local document cache (IndexedDB). On by default; the Settings toggle flips it.
  // `connect` is derived so flipping it rebuilds the factory, and the keyed block
  // below remounts the Editor so the change takes effect immediately.
  let localCache = $state(localCacheEnabled());

  // Bumped when a TURN settings change needs the Editor to reconnect. Read in
  // `connect` so the factory rebuilds with fresh ICE, and in the keyed block
  // below to remount.
  let collabEpoch = $state(0);
  const connect = $derived.by(() => {
    void collabEpoch;
    return collabPlan.build(localCache);
  });

  function setLocalCache(on: boolean): void {
    setLocalCacheEnabled(on);
    localCache = localCacheEnabled();
    if (!on) void clearLocalCache().then(() => toasts.info('Local copies cleared'));
  }

  async function clearLocalCopies(): Promise<void> {
    await clearLocalCache();
    toasts.success('Cleared local copies of your documents');
  }

  // Runtime TURN config (Settings) — persisted; applied on the next reconnect.
  let turnPrefs = $state<TurnPrefs>(getTurnPrefs());
  function saveTurnPrefs(p: TurnPrefs): void {
    turnPrefs = p;
    setTurnPrefs(p);
    collabEpoch += 1; // rebuild ICE + remount so the change takes effect
    toasts.info('Connection settings applied');
  }

  const COLORS: CursorColor[] = ['#e11d48', '#7c3aed', '#0891b2', '#16a34a', '#d97706', '#db2777'] as CursorColor[];
  const color: CursorColor = COLORS[Math.floor((Date.now() / 1000) % COLORS.length)];

  const storageBackends = backends();

  // Start with whichever backend is already authenticated (returning user),
  // falling back to the env-var default or the first available.
  function initialStorage(): StorageBackend | null {
    const authed = storageBackends.find(b => b.auth.isAuthenticated());
    if (authed) return authed;
    const byDefault = storageBackends.find(
      b => b.storage.availability.ok && b.storage.id === DEFAULT_BACKEND
    );
    return byDefault ?? storageBackends.find(b => b.storage.availability.ok) ?? null;
  }

  let storage = $state<StorageBackend | null>(initialStorage());
  // Cast at the IO boundary: user-typed strings enter the domain as DisplayName here.
  let name = $state<DisplayName>('Anonymous' as DisplayName);

  // Bumped when localStorage state changes (config saved, auth token stored).
  let tick = $state(0);
  const bump = () => { tick += 1; };

  // Derived so bump() after connect/disconnect recomputes automatically.
  let connected = $derived(tick >= 0 && !!storage && storage.auth.isAuthenticated());

  // ── Settings ───────────────────────────────────────────────────────────────

  let settingsOpen = $state(false);
  let settingsFocus = $state('');

  function openSettings(id = '') {
    settingsFocus = id;
    settingsOpen = true;
  }

  function afterConnect(b: StorageBackend) {
    storage = b;
    bump();
  }

  function afterDisconnect(_b: StorageBackend) {
    bump();
  }

  // ── Document / room ────────────────────────────────────────────────────────

  const DEFAULT_ROOM = resolveDefaultRoom(import.meta.env.VITE_DEFAULT_ROOM);

  function roomFromUrl(): RoomId {
    return parseRoomId(new URLSearchParams(location.search).get('room')) ?? DEFAULT_ROOM;
  }

  // Role is fixed for the session — it comes from the URL so the host can share
  // a read-only link (?role=reader). Cooperative only: a modified client could
  // ignore it, but it's appropriate for trusted collaborators.
  function roleFromUrl(): SessionRole {
    return new URLSearchParams(location.search).get('role') === 'reader' ? 'reader' : 'writer';
  }

  let room = $state<RoomId>(roomFromUrl());
  const sessionRole: SessionRole = roleFromUrl();

  function goToRoom(id: string) {
    const r = parseRoomId(id) ?? DEFAULT_ROOM;
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
    <div class="brand">
      <img src="{import.meta.env.BASE_URL}favicon.svg" alt="" width="26" height="26" />
      <h1>Copad</h1>
    </div>
    <div class="controls">
      <label>
        Name
        <input value={name} oninput={e => { name = e.currentTarget.value as DisplayName; }} />
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
      <button class="share-btn" onclick={() => (shareOpen = true)} title="Share / invite collaborators">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
          <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
        </svg>
        Share
      </button>
      <button class="icon-btn" onclick={() => openSettings()} title="Settings" aria-label="Settings">⚙</button>
      <ThemeToggle {theme} />
    </div>
  </header>



  {#if collabWarning}
    <InfoBanner>
      Collaboration between devices is unavailable on this site. {collabWarning}
    </InfoBanner>
  {:else if !connected}
    <InfoBanner autoDismissMs={7000}>
      Set up a storage backend in <button class="link" onclick={() => openSettings()}>Settings ⚙</button>
      to <strong>save &amp; restore</strong> your document across sessions.
    </InfoBanner>
  {/if}

  {#key `${room}|${localCache}|${collabEpoch}`}
    <Editor
      {name}
      {color}
      {room}
      role={sessionRole}
      {connect}
      {toasts}
      storage={connected ? storage!.storage : null}
      onstoragestatus={() => openSettings()}
    />
  {/key}
</div>

<Settings
  backends={storageBackends}
  bind:open={settingsOpen}
  focusId={settingsFocus}
  {localCache}
  onCacheChange={setLocalCache}
  onCacheClear={clearLocalCopies}
  {turnPrefs}
  onTurnChange={saveTurnPrefs}
  onchange={bump}
  onconnect={afterConnect}
  ondisconnect={afterDisconnect}
/>

<ShareDialog
  open={shareOpen}
  onclose={() => (shareOpen = false)}
  {room}
  {toasts}
  envPassword={import.meta.env.VITE_ROOM_PASSWORD}
  onSecurityChange={() => (collabEpoch += 1)}
/>
<Toast {toasts} />
