<script lang="ts">
  import { tick as nextTick, untrack } from 'svelte';
  import { backends, DEFAULT_BACKEND } from './storage/index.js';
  import type { StorageBackend } from './storage/index.js';
  import { savedRoomsStore } from './storage/savedRooms.js';
  import { setActiveRoom, filenameForRoom, firstFileCollision } from './storage/filename.js';
  import type { Filename } from './storage/types.js';
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
  import { parseRoomId, parseRoomName, parseRoomCredential } from './collaboration/parse.js';
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
  import {
    roomPassword,
    setRoomPassword,
    RoomAccessMode,
    roomOpenedWithoutPassword,
    setRoomOpenedWithoutPassword,
  } from './collaboration/roomAccess.js';
  import { currentSecretKey } from './collaboration/secretLink.js';
  import type { RoomCipher } from './collaboration/roomCipher.js';
  import {
    roomLockState,
    roomEncryptionFingerprint,
    rememberRoomEncryption,
    type RoomLockState,
  } from './collaboration/roomLock.js';
  import { keyFingerprint } from './collaboration/roomCrypto.js';
  import RoomLock from './ui/RoomLock.svelte';
  import { getTurnPrefs, setTurnPrefs, type TurnPrefs } from './collaboration/turn.js';
  import type { DisplayName, CursorColor, RoomId, CollabConnect, IceServer } from './collaboration/types.js';
  import { SessionRole, ConnStatus, Transport } from './collaboration/types.js';
  import Editor from './Editor.svelte';
  import Settings from './Settings.svelte';
  import ThemeToggle from './ui/ThemeToggle.svelte';
  import ShareDialog from './ui/ShareDialog.svelte';
  import SyncBanner from './ui/SyncBanner.svelte';
  import Toast from './ui/Toast.svelte';
  import { createTheme } from './ui/theme.svelte.js';
  import { createToasts } from './ui/toasts.svelte.js';
  import { createLanguage } from './ui/language.svelte.js';

  const theme = createTheme();
  const toasts = createToasts();
  const language = createLanguage();
  let shareOpen = $state(false);
  // Copad's peer-to-peer (no async sync) default used to be explained up front by
  // a one-time intro modal. That taught the same "solo writing is ephemeral" lesson
  // as the write-gate below — a wall of text shown before you'd done anything, and
  // dismissed once. We removed it: the write-gate now carries that lesson just-in-
  // time, at the moment writing-into-the-void actually becomes true, with the
  // actions that resolve it (Invite / Connect storage) right there.

  // Effective per-room cipher (WebRTC end-to-end encryption). Resolved fresh on
  // each connect, in precedence order: secure-link key (#k= in the URL) → per-room
  // password (set in the Share dialog) → the deployment's configured VITE_ROOM_AUTH
  // strategy. The Editor remounts on a security change (collabEpoch), so a link or
  // password set in Share takes effect on the next connection.
  const { access: envAccess, cipher: envCipher } = resolveRoomStrategy(import.meta.env.VITE_ROOM_AUTH);
  const perRoomPassword = roomPassword();
  // In `room-password` mode the deployment mandates a per-room password for every
  // room, so a first-time visitor with none stored should be prompted for it —
  // deterministically, without needing a prior keyed visit's fingerprint. The
  // other modes don't need this: `public` isn't gated, `site-password` supplies
  // the key from env, and `secret-link` mints a fresh key when the URL has none.
  const passwordRequiredMode = envAccess.mode === RoomAccessMode.RoomPassword;
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
  // Real-time collaboration is compromised on this deployment (no signaling server,
  // or mixed-content ws:// on an https:// page — peers can't connect). It's static
  // per session: deployment config doesn't change at runtime. When true, "invite
  // someone to write together" is a dead end, so it flips the whole presence layer
  // from "you're alone (invite someone)" to "this site can't sync (keep your own
  // copy)" — see the write-gate and the banner block below.
  const collabUnavailable = collabWarning !== undefined;

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
    // Connecting a backend saves the room you're in to it: add it to this backend's
    // saved set (each saved room keeps its own file). Every room it doesn't save
    // stays live-only for you.
    savedRoomsStore(b.storage.id).add(room);
    bump();
  }

  function afterDisconnect(_b: StorageBackend) {
    // Keep the saved-room set: logging out already makes every room live-only
    // (savedHere checks isAuthenticated), and retaining it means re-logging in
    // restores your saved rooms instead of silently orphaning them.
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

  // Fixed for the lifetime of this tab: opening another room always opens a new
  // tab (see `openRoom` below), so there's no in-tab switch left to react to.
  const room: RoomId = roomFromUrl();
  const sessionRole: SessionRole = roleFromUrl();

  // Tell the storage layer which room every backend targets. Every room derives
  // its own file from the room id, so rooms never share one document.
  setActiveRoom(room);

  // Returning-user default: if a backend is already authenticated but saves no room
  // yet (authed before this feature existed, or a fresh session), treat the room you
  // land in as one it saves — but only when you arrived at your own default room,
  // never via a shared `?room=` link (which means you're just a visitor). This keeps
  // an existing user's document attached to their home room instead of silently
  // demoting it to live-only, without ever claiming someone else's room.
  if (!new URLSearchParams(location.search).has('room')) {
    // untrack: a one-time read at init (not a reactive dependency).
    const s = untrack(() => storage);
    if (s && s.auth.isAuthenticated() && savedRoomsStore(s.storage.id).all().length === 0) {
      savedRoomsStore(s.storage.id).add(room);
    }
  }

  // Whether the current room is saved to *your own* storage: a connected backend of
  // yours saves it. Otherwise the room is live-only for you — the Editor gets no
  // Storage (below), so it keeps its own document rather than inheriting this
  // backend's file. This is a per-user persistence fact, not a room-level role: with
  // per-target autosave, several people can each save their own copy. `tick` re-reads
  // the (non-reactive) set after connect/disconnect; `room` re-reads it on switch.
  const savedHere = $derived.by(() => {
    void tick;
    void room;
    const s = storage;
    return !!s && s.auth.isAuthenticated() && savedRoomsStore(s.storage.id).saves(room);
  });

  // Another room this backend saves that resolves to the *same* file as the current
  // one — they'd silently overwrite each other. Detectable only within this browser
  // (a same-account collision on another machine can't be seen without a coordination
  // point the serverless model deliberately lacks). null when clear.
  const fileConflict = $derived.by((): RoomId | null => {
    void tick;
    void room;
    const s = storage;
    if (!s || !savedHere) return null;
    const id = s.storage.id;
    const fallback = s.storage.defaultFilename?.();
    const files = new Map<RoomId, Filename>();
    for (const r of savedRoomsStore(id).all()) files.set(r, filenameForRoom(id, r, fallback));
    return firstFileCollision(room, files);
  });
  const conflictWarning = $derived.by((): string | undefined => {
    const other = fileConflict;
    const s = storage;
    if (!other || !s) return undefined;
    const file = filenameForRoom(s.storage.id, room, s.storage.defaultFilename?.());
    return `Room “${other}” also saves to ${file} on your ${s.storage.label} — they’ll overwrite each other. Rename this room’s file in Settings.`;
  });

  // ── Write-gate: don't let people write into the void ────────────────────────
  // In a peer-to-peer, live-only room where you're the only one present, nothing
  // you write leaves this device until someone joins — writing solo is talking to
  // an empty room, which isn't what Copad is for. So we hold the editor read-only
  // and surface it as the strongest tier of the top SyncBanner strip (Invite /
  // Connect storage). It's not a wall: the writing gesture itself opts you into
  // writing solo — Editor's yield-on-write lifts the gate under your cursor on the
  // first click/keystroke (remembered per room) — and it also lifts on its own the
  // instant a peer joins or the room becomes Saved. There's no separate overlay and
  // no scrim over the text, in keeping with "the interface recedes in front of it".
  //
  // What "into the void" really means: no peer is *receiving* my edits AND nothing
  // durable is keeping them. That's P2P transport (a hub relays to later joiners,
  // so solo isn't pointless there), live-only for you (a Saved room keeps your
  // copy), and **not Connected** — no peer present. Crucially we key on "no peer",
  // NOT on ConnStatus.Waiting: whether we've attached to the signaling socket yet
  // is an implementation detail the writer doesn't care about. Connecting, Waiting
  // and Offline are identical to them — in all three, zero peers have their bytes.
  // Keying on Waiting alone made the gate invisible exactly when signaling is
  // absent or cold (a fresh serverless deploy), i.e. when protection matters most.
  //
  // The flicker risk that narrow gating avoided (a brief Connecting on every load,
  // before a peer is found) is handled by a **grace delay** instead of exclusion:
  // we only arm the gate once the room has stayed peerless for GATE_GRACE_MS. If a
  // peer joins (or the room becomes Saved) within that window, the gate never
  // shows; it also lifts immediately the moment eligibility drops. A read-only
  // session (shared view link) is never gated.
  //
  // The "write on your own" escape is **session-scoped, in memory only** — not
  // persisted. So any full reload re-asserts the gate (Copad re-nudges you to
  // invite someone on each fresh visit); we don't try to single out a hard refresh
  // (indistinguishable from a soft one in the browser). Kept per room so opting
  // into one room doesn't unlock another during the same session.
  const GATE_GRACE_MS = 2_000;
  let soloRooms = $state<RoomId[]>([]);

  // Everything except the grace timing: are we, right now, a writer alone in a
  // P2P live-only room who hasn't opted to write solo? (No peer ⟺ not Connected —
  // Connecting, Waiting and Offline all qualify.)
  //
  // `!collabUnavailable` is the crucial guard: the gate exists to stop you writing
  // into the void *while someone could still join*. If this deployment can't sync
  // across devices at all, no one can ever join — holding writing back and telling
  // you to "invite someone" would be a misleading dead end. So we don't gate; solo
  // writing is simply the only mode, and durability is the storage story (below).
  const gateEligible = $derived(
    sessionRole === SessionRole.Writer &&
      sessionState.diagnostics.transport === Transport.P2P &&
      !savedHere &&
      sessionState.conn !== ConnStatus.Connected &&
      !soloRooms.includes(room) &&
      !collabUnavailable,
  );

  // Rising-edge debounce: arm the gate only after eligibility has held for the
  // grace window. `gateEligible` recomputes to the same `true` across a
  // Connecting→Waiting transition, so (by Svelte's === check on deriveds) this
  // effect doesn't re-run and the timer survives; it's torn down the instant a
  // peer joins / the room becomes Saved / the user opts solo.
  let gateArmed = $state(false);
  $effect(() => {
    if (!gateEligible) {
      gateArmed = false;
      return;
    }
    const t = setTimeout(() => (gateArmed = true), GATE_GRACE_MS);
    return () => clearTimeout(t);
  });

  const writeLocked = $derived(gateEligible && gateArmed);

  function allowWriteSolo(): void {
    if (!soloRooms.includes(room)) soloRooms = [...soloRooms, room];
  }

  // ── Encrypted-room access gate ───────────────────────────────────────────────
  // A room is gated when it's known-encrypted (a key fingerprint was remembered
  // on a prior visit) but the current key is missing or wrong. Encryption is
  // WebRTC-only, so the gate only applies there. Until the async check resolves
  // we hold the editor back (lockChecked) so encrypted content never flashes
  // before the gate — and, crucially, so a locked room never mounts the Editor
  // (which would connect + write a plaintext cache without the key).
  const encryptedTransport = usesIce; // WebRTC — the only transport that encrypts
  // Whether *this* room is end-to-end encrypted right now: a per-room key is in
  // effect (secure link / room password / mandated strategy) on an encrypting
  // transport. Drives the status chip's shield segment. Re-evaluated on a security
  // change (Share dialog / unlock bumps collabEpoch).
  const roomEncrypted = $derived.by((): boolean => {
    void collabEpoch;
    return encryptedTransport && roomCipher.password(room) !== null;
  });
  let lock = $state<RoomLockState>({ locked: false });
  let lockChecked = $state(!encryptedTransport);
  // Whether the current lock offers a "continue without a password" escape. Only
  // the deterministic first-visit `room-password` gate does — never a room known
  // to be encrypted (skipping that would just show an empty, unsynced room).
  let lockAllowSkip = $state(false);

  $effect(() => {
    const r = room;
    void collabEpoch; // re-check after a security change (Share dialog / unlock)
    if (!encryptedTransport) {
      lock = { locked: false };
      lockChecked = true;
      return;
    }
    const cred = roomCipher.password(r);
    const stored = roomEncryptionFingerprint(r);
    if (!stored) {
      lockAllowSkip = false;
      if (cred) {
        // First time we see this room *with* a key: remember it's encrypted so a
        // later keyless visit is gated. Fire-and-forget; we're not locked.
        void rememberRoomEncryption(r, cred);
        lock = { locked: false };
      } else if (passwordRequiredMode && !roomOpenedWithoutPassword(r)) {
        // No key, none remembered, but the deployment requires one → prompt for it
        // on this first visit (deterministic, not based on a stored fingerprint).
        // Offer an escape: the user may deliberately open the room unencrypted.
        lock = { locked: true, reason: 'missing' };
        lockAllowSkip = true;
      } else {
        // Not known to be encrypted and none required (or the user opted out) → open.
        lock = { locked: false };
      }
      lockChecked = true;
      return;
    }
    // Known-encrypted → verify the current key against the remembered fingerprint.
    // Never overwrite the stored fingerprint here — that's what lets a wrong key be
    // detected (locked) instead of silently adopted. No skip offered here.
    lockAllowSkip = false;
    lockChecked = false;
    let cancelled = false;
    void (async () => {
      const state = await roomLockState(r, cred);
      if (!cancelled) {
        lock = state;
        lockChecked = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  // "Continue without a password" from the first-visit gate: remember the choice
  // for this room and re-run the gate (which now opens it, unencrypted).
  function continueWithoutPassword(): void {
    setRoomOpenedWithoutPassword(room);
    collabEpoch += 1;
  }

  // Unlock the gate by supplying the room key. It's verified against the
  // remembered fingerprint before we persist anything (a wrong key is rejected,
  // never stored), then kept as this room's password so the effective cipher
  // decrypts on reconnect and the encrypted cache can be read back.
  async function tryUnlock(raw: string): Promise<boolean> {
    const cred = parseRoomCredential(raw);
    if (!cred) return false;
    const stored = roomEncryptionFingerprint(room);
    if (stored && (await keyFingerprint(cred)) !== stored) return false;
    setRoomPassword(room, cred);
    onSecurityChange();
    return true;
  }

  // Accept a bare id, a "?room=x" fragment, or a full shared URL — so pasting a
  // collaborator's link into the switcher's "open a room" field just works.
  function roomIdFrom(input: string): string {
    const t = input.trim();
    if (!t) return t;
    try {
      // A full URL always resolves through its `room` param — including its
      // absence, which means "the default room". Never fall back to treating
      // the whole URL as a room id (a default-room secret link has no
      // `?room=`, only `#k=`, and would otherwise mint a garbage room named
      // after the entire pasted URL).
      return new URL(t).searchParams.get('room') ?? '';
    } catch {
      /* not a full URL — fall through */
    }
    const m = t.match(/[?&]room=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : t;
  }

  // Extract a secret-link key (`#k=…`) from a pasted invite URL/fragment, if
  // present — so it can be preserved across the switch even though the new
  // URL is rewritten to a plain `?room=` with no hash.
  function keyFromInput(input: string): string | null {
    const t = input.trim();
    try {
      return new URLSearchParams(new URL(t).hash.slice(1)).get('k');
    } catch {
      /* not a full URL — fall through */
    }
    const m = t.match(/[#&]k=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  // Opening another room always opens a fresh browser tab rather than switching
  // this one in place. Why: `storage/filename.ts`'s `activeRoom` is a single
  // pointer shared by *every* backend in this tab (not one per backend) — if two
  // rooms' persist loops were ever alive in the same tab at once, both would
  // resolve their target filename against whichever room is "active", silently
  // overwriting one room's saved file with the other's content. A real tab
  // sidesteps this for free: each tab gets its own JS module state, and the
  // per-room-per-backend filename already lives correctly namespaced in
  // localStorage. Until the Storage port is made room-explicit, "another room"
  // means "another tab" — never a second room alongside this one.
  function roomHref(r: RoomId): string {
    const qs = r === DEFAULT_ROOM ? '' : `?room=${encodeURIComponent(r)}`;
    return location.pathname + qs;
  }

  function openRoom(idOrUrl: string): void {
    const r = parseRoomId(roomIdFrom(idOrUrl)) ?? DEFAULT_ROOM;
    // A pasted encrypted invite carries its key in the URL fragment, which the
    // opened URL below doesn't repeat — so persist it as this room's per-room
    // password first. The new tab's lock effect then remembers its fingerprint
    // on this first keyed visit, same as any other keyed room.
    const key = keyFromInput(idOrUrl);
    if (key) setRoomPassword(r, key);
    window.open(roomHref(r), '_blank', 'noopener');
  }

  function newRoom(): void {
    openRoom(Math.random().toString(36).slice(2, 10));
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
      <!-- Not a heading: an <h1> here would compete with the document's own
           level-1 heading, giving screen-reader heading nav two page titles. -->
      <div class="wordmark">Copad</div>
    </div>
    <div class="controls">
      <RoomSwitcher {room} name={roomName.value} onRename={renameCurrentRoom} onOpen={openRoom} />
      <button
        class="btn-new icon-btn"
        onclick={newRoom}
        title="New document (opens in a new tab)"
        aria-label="New document (opens in a new tab)"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <div class="session">
        <!-- One status chip: connection (Direct/Alone/…) + durability (Saved/Not saved).
             Tap opens the detail sheet (connection + where it's kept + connect action). -->
        <StatusPill
          conn={sessionState.conn}
          saveStatus={sessionState.saveStatus}
          hasStorage={savedHere}
          storageLabel={savedHere ? storage?.storage.label : undefined}
          warning={conflictWarning}
          transport={sessionState.diagnostics.transport}
          encrypted={roomEncrypted}
          onclick={() => (diagOpen = true)}
        />
        {#if otherPeers.length > 0}
          <PresenceBar users={otherPeers} />
        {/if}
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



  <!-- Presence / durability layer — one strip, one surface, never contradictory.
       Decision 2: the old always-on "Set up a storage backend…" InfoBanner is gone.
       It duplicated the persistent, clickable status chip ("Not saved" → opens the
       sheet with the connect action, #105/#124) and stacked on top of SyncBanner's
       own solo tiers, which already nudge storage. The chip is the single durability
       actuator; the banners stay contextual and non-duplicative.
       Decision 3 (revised): collaboration-unavailable is folded into SyncBanner as
       its own tier instead of a separate InfoBanner. Reasoning: it must NOT block
       (unlike the write-gate) because it's a *permanent environment fact* the user
       can't act on right now — you block only for a *transient, user-resolvable*
       state (someone might still join). But "which component renders it" is a
       presentation choice, independent of blocking — and two components for one
       presence/durability concern was the real inconsistency. So it's one strip
       with an escalation ladder: gated (blocks, transient) → collab-unavailable
       (never blocks, permanent, its own tier) → solo reminder (never blocks,
       transient). See SyncBanner's `collabUnavailable` tier for the copy. -->
  <SyncBanner
    conn={sessionState.conn}
    transport={sessionState.diagnostics.transport}
    storageLabel={savedHere && storage ? storage.storage.label : null}
    gated={writeLocked}
    {gateEligible}
    {collabUnavailable}
    onShare={() => (shareOpen = true)}
    onConnectStorage={() => openSettings()}
  />

  {#if !iceReady}
    <div class="ice-gate" role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <span>Setting up a secure connection…</span>
    </div>
  {:else if !lockChecked}
    <div class="ice-gate" role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <span>Checking room access…</span>
    </div>
  {:else if lock.locked}
    <RoomLock
      {room}
      reason={lock.reason}
      onUnlock={tryUnlock}
      allowSkip={lockAllowSkip}
      onSkip={continueWithoutPassword}
    />
  {:else if editorMounted}
    {#key room}
      <Editor
        {name}
        {color}
        {room}
        role={sessionRole}
        {connect}
        {toasts}
        storage={savedHere ? storage!.storage : null}
        lang={language.resolved}
        spellcheck={language.spellcheck}
        {writeLocked}
        writeGateEligible={gateEligible}
        onWriteSolo={allowWriteSolo}
      />
    {/key}
  {/if}
</div>

<ConnectionDialog
  open={diagOpen}
  onclose={() => (diagOpen = false)}
  transport={sessionState.diagnostics.transport}
  conn={sessionState.conn}
  saved={savedHere}
  saveStatus={sessionState.saveStatus}
  storageLabel={savedHere ? storage?.storage.label : undefined}
  warning={conflictWarning}
  encrypted={roomEncrypted}
  peers={sessionState.users}
  getDiagnostics={sessionState.diagnostics.getDiagnostics}
  reconnect={sessionState.diagnostics.reconnect}
  onConnectStorage={() => openSettings()}
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
  saved={savedHere}
  storageLabel={savedHere ? storage?.storage.label : undefined}
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
