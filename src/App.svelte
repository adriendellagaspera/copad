<script lang="ts">
  import { tick as nextTick } from 'svelte';
  import { backends, DEFAULT_BACKEND } from './storage/index.js';
  import type { StorageBackend } from './storage/index.js';
  import { webrtcCollab } from './collaboration/webrtc.js';
  import { websocketCollab } from './collaboration/websocket.js';
  import {
    resolveSignaling,
    resolveIceServers,
    resolveIceServersUrl,
    resolveWebsocket,
    resolveTransport,
    resolveRoomStrategy,
    resolveDefaultRoom,
    type PageProtocol,
    type PageHostname,
  } from './collaboration/config.js';
  import { fetchIceServers } from './collaboration/iceServers.js';
  import { parseRoomId, parseRoomName } from './collaboration/parse.js';
  import { roomName, renameRoom } from './collaboration/roomName.svelte.js';
  import { recordRoomVisit, updateRecentRoomName } from './collaboration/recentRooms.js';
  import { sessionState } from './collaboration/sessionState.svelte.js';
  import RoomSwitcher from './ui/RoomSwitcher.svelte';
  import IdentityMenu from './ui/IdentityMenu.svelte';
  import StatusPill from './ui/StatusPill.svelte';
  import PresenceBar from './ui/PresenceBar.svelte';
  import ConnectionDialog from './ui/ConnectionDialog.svelte';
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
  import type { DisplayName, CursorColor, RoomId, CollabConnect, IceServer } from './collaboration/types.js';
  import { SessionRole } from './collaboration/types.js';
  import Editor from './Editor.svelte';
  import Settings from './Settings.svelte';
  import ThemeToggle from './ui/ThemeToggle.svelte';
  import ShareDialog from './ui/ShareDialog.svelte';
  import Toast from './ui/Toast.svelte';
  import InfoBanner from './ui/InfoBanner.svelte';
  import { createTheme } from './ui/theme.svelte.js';
  import { createToasts } from './ui/toasts.svelte.js';
  import { createLanguage } from './ui/language.svelte.js';

  const theme = createTheme();
  const toasts = createToasts();
  const language = createLanguage();
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

  // ICE servers fetched at startup from VITE_ICE_SERVERS_URL (a credentials
  // endpoint that mints short-lived TURN creds server-side). Empty until the
  // fetch resolves; `buildIce()` prefers these over static env TURN when present.
  // Only the WebRTC transport uses ICE, so skip the whole dance on WebSocket.
  let fetchedIce = $state<IceServer[]>([]);
  const usesIce = resolveTransport(import.meta.env.VITE_COLLAB_TRANSPORT) !== 'websocket';
  const iceServersUrl = usesIce ? resolveIceServersUrl(import.meta.env.VITE_ICE_SERVERS_URL) : undefined;
  // Gate the first Editor mount on the ICE fetch when an endpoint is configured,
  // so the initial connection already carries the fetched TURN relay. We resolve
  // ICE *before* the first build rather than reconnecting after: a post-mount
  // rebuild would remount the Editor via {#key}, and a same-room remount races
  // y-webrtc's global room registry (openRoom throws "already exists" if the old
  // provider's async teardown hasn't deregistered the room yet, leaving the new
  // provider unsubscribed). fetchIceServers self-bounds via ICE_FETCH_TIMEOUT_MS,
  // so this gate always opens — with creds if they arrived, with env/default if not.
  let iceReady = $state(!iceServersUrl);
  if (iceServersUrl) {
    void fetchIceServers(iceServersUrl).then((servers) => {
      if (servers.length > 0) fetchedIce = servers;
      iceReady = true;
    });
  }

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
    const buildIce = (): IceServer[] => {
      const turn = getTurnPrefs();
      const hasRuntimeTurn = turn.urls.length > 0;
      // Precedence: runtime TURN (user's own, from Settings) → fetched ICE
      // (short-lived creds from VITE_ICE_SERVERS_URL) → static env / public
      // default. Runtime always wins; a configured endpoint beats static env.
      if (!hasRuntimeTurn && fetchedIce.length > 0) return fetchedIce;
      return resolveIceServers(
        {
          VITE_STUN_URL: import.meta.env.VITE_STUN_URL,
          VITE_TURN_URL: hasRuntimeTurn ? turn.urls.join(',') : import.meta.env.VITE_TURN_URL,
          VITE_TURN_USERNAME: hasRuntimeTurn ? turn.username : import.meta.env.VITE_TURN_USERNAME,
          VITE_TURN_PASSWORD: hasRuntimeTurn ? turn.credential : import.meta.env.VITE_TURN_PASSWORD,
        },
        { fallback: turn.fallback },
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

  // Bumped when a TURN/security settings change needs a fresh factory. Read in
  // `connect` so the derived rebuilds with the new ICE/cipher; the actual remount
  // is driven by `rebuildCollab()` (a same-room {#key} swap would race y-webrtc).
  let collabEpoch = $state(0);
  const connect = $derived.by(() => {
    void collabEpoch;
    return collabPlan.build(localCache);
  });

  // The Editor is unmounted only while `editorMounted` is false; the `{#key room}`
  // block below still handles room switches (different y-webrtc room → no clash).
  let editorMounted = $state(true);
  let rebuilding = false;
  /**
   * Reconnect for a *same-room* config change (TURN/cache/security). Cycle the
   * Editor off, wait for the old provider to fully tear down — including
   * y-webrtc's async room deregistration — then remount. A direct {#key} swap can
   * construct the new provider before the old one deregisters, and y-webrtc's
   * `openRoom()` throws "already exists" for the same room name, leaving the new
   * provider unsubscribed (silently no peers). The two-phase mount avoids that.
   */
  async function rebuildCollab(): Promise<void> {
    if (rebuilding) return;
    rebuilding = true;
    editorMounted = false;
    await nextTick(); // apply the unmount → Editor.onDestroy → collab.destroy()
    // Drain microtasks so the provider's async room deregistration completes
    // before the replacement mounts (setTimeout yields past the microtask queue).
    await new Promise((resolve) => setTimeout(resolve, 0));
    editorMounted = true;
    rebuilding = false;
  }

  function setLocalCache(on: boolean): void {
    setLocalCacheEnabled(on);
    localCache = localCacheEnabled();
    void rebuildCollab(); // rebuild `connect` (reads localCache) + safely remount
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
    collabEpoch += 1;      // rebuild the factory with fresh ICE…
    void rebuildCollab();  // …and safely remount so it takes effect
    toasts.info('Connection settings applied');
  }

  // Security change from the Share dialog (secure link / room password): rebuild
  // the factory with the new cipher and safely remount.
  function onSecurityChange(): void {
    collabEpoch += 1;
    void rebuildCollab();
  }

  const COLORS: CursorColor[] = ['#e11d48', '#7c3aed', '#0891b2', '#16a34a', '#d97706', '#db2777'] as CursorColor[];
  // Editable from the identity menu (avatar) in the header; seeds to a rotating
  // default. Passed to the Editor, which broadcasts it in awareness to peers.
  let color = $state<CursorColor>(COLORS[Math.floor((Date.now() / 1000) % COLORS.length)]);

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

  // ── Session presence / connection (header) ──────────────────────────────────
  // The Editor pushes these into the sessionState bridge; the header renders them.
  // Self is shown by the identity menu, so the presence bar lists only others.
  let diagOpen = $state(false);
  const otherPeers = $derived(sessionState.users.filter((u) => !u.self));

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
    return new URLSearchParams(location.search).get('role') === SessionRole.Reader
      ? SessionRole.Reader
      : SessionRole.Writer;
  }

  let room = $state<RoomId>(roomFromUrl());
  const sessionRole: SessionRole = roleFromUrl();

  // Accept a bare id, a "?room=x" fragment, or a full shared URL — so pasting a
  // collaborator's link into the switcher's "open a room" field just works.
  function roomIdFrom(input: string): string {
    const t = input.trim();
    if (!t) return t;
    try {
      const fromUrl = new URL(t).searchParams.get('room');
      if (fromUrl) return fromUrl;
    } catch {
      /* not a full URL — fall through */
    }
    const m = t.match(/[?&]room=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : t;
  }

  function goToRoom(idOrUrl: string) {
    const r = parseRoomId(roomIdFrom(idOrUrl)) ?? DEFAULT_ROOM;
    if (r === room) return;
    const qs = r === DEFAULT_ROOM ? '' : `?room=${encodeURIComponent(r)}`;
    history.pushState({}, '', location.pathname + qs);
    room = r;
  }

  function newRoom() {
    goToRoom(Math.random().toString(36).slice(2, 10));
  }

  // Rename the current room — edits the shared name (synced to every peer via
  // the Y.Doc); the immutable room id is never touched, so a room can't be lost.
  function renameCurrentRoom(raw: string): void {
    renameRoom(parseRoomName(raw));
  }

  // Remember every room we open so the switcher can always offer it again.
  $effect(() => {
    recordRoomVisit(room, null);
  });
  // Keep the remembered name in step with the shared name as it loads / changes.
  $effect(() => {
    updateRecentRoomName(room, roomName.value);
  });
</script>

<div class="app">
  <header>
    <div class="brand">
      <img src="{import.meta.env.BASE_URL}favicon.svg" alt="" width="26" height="26" />
      <h1>Copad</h1>
    </div>
    <div class="controls">
      <RoomSwitcher {room} name={roomName.value} onRename={renameCurrentRoom} onOpen={goToRoom} />
      <button class="btn-new" onclick={newRoom} title="New document">New</button>

      <div class="session">
        <StatusPill
          conn={sessionState.conn}
          saveStatus={sessionState.saveStatus}
          hasStorage={connected}
          storageLabel={storage?.storage.label}
          transport={sessionState.diagnostics.transport}
          onclick={connected ? undefined : () => openSettings()}
        />
        {#if otherPeers.length > 0}
          <PresenceBar users={otherPeers} />
        {/if}
        <button
          class="diag-btn"
          onclick={() => (diagOpen = true)}
          title="Connection details"
          aria-label="Connection details"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4v16" />
          </svg>
        </button>
      </div>

      <IdentityMenu
        {name}
        {color}
        colors={COLORS}
        onName={(v) => { name = v as DisplayName; }}
        onColor={(c) => { color = c; }}
      />
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

  {#if !iceReady}
    <div class="ice-gate" role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <span>Setting up a secure connection…</span>
    </div>
  {:else if editorMounted}
    {#key room}
      <Editor
        {name}
        {color}
        {room}
        role={sessionRole}
        {connect}
        {toasts}
        storage={connected ? storage!.storage : null}
        lang={language.resolved}
        spellcheck={language.spellcheck}
      />
    {/key}
  {/if}
</div>

<ConnectionDialog
  open={diagOpen}
  onclose={() => (diagOpen = false)}
  transport={sessionState.diagnostics.transport}
  getDiagnostics={sessionState.diagnostics.getDiagnostics}
  reconnect={sessionState.diagnostics.reconnect}
/>

<Settings
  backends={storageBackends}
  bind:open={settingsOpen}
  focusId={settingsFocus}
  {localCache}
  onCacheChange={setLocalCache}
  onCacheClear={clearLocalCopies}
  {turnPrefs}
  onTurnChange={saveTurnPrefs}
  languageChoice={language.choice}
  spellcheck={language.spellcheck}
  onLanguageChange={language.setChoice}
  onSpellcheckChange={language.setSpellcheck}
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
  {onSecurityChange}
/>
<Toast {toasts} />

<style>
  /* Shown only while the startup ICE-credentials fetch is in flight (deployments
     with VITE_ICE_SERVERS_URL). Bounded by ICE_FETCH_TIMEOUT_MS. */
  .ice-gate {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    min-height: 40vh;
    color: var(--text-muted);
    font-size: var(--fs-400);
  }
  .ice-gate .spinner {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-top-color: transparent;
    animation: ice-gate-spin 0.7s linear infinite;
  }
  @keyframes ice-gate-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
