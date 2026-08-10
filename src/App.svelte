<script lang="ts">
  import { tick as nextTick, untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import { backends, DEFAULT_BACKEND } from './storage/index.js';
  import { pickFile } from './format/filePicker.js';
  import type { StorageBackend } from './storage/index.js';
  import { savedRoomsStore } from './storage/savedRooms.js';
  import { filenameForRoom, firstFileCollision } from './storage/filename.js';
  import type { Filename, StorageId } from './storage/types.js';
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
  import { parseRoomId, parseRoomCredential, parseSelfProbeMarker } from './collaboration/parse.js';
  import type { SelfProbeMarker } from './collaboration/selfProbeMarker.js';
  import { sessionState } from './collaboration/sessionState.svelte.js';
  import { keyboardInset } from './ui/keyboardInset.svelte.js';
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
  import { currentSecretKey, mintSecretKey } from './collaboration/secretLink.js';
  import { newRoomId } from './collaboration/roomId.js';
  import type { RoomCipher } from './collaboration/roomCipher.js';
  import {
    roomLockState,
    roomEncryptionFingerprint,
    rememberRoomEncryption,
    type RoomLockState,
  } from './collaboration/roomLock.js';
  import { keyFingerprint } from './collaboration/roomCrypto.js';
  import RoomLock from './ui/RoomLock.svelte';
  import CollabUnavailableIntro from './ui/CollabUnavailableIntro.svelte';
  import { KEY_COLLAB_UNAVAILABLE_SEEN } from './collaboration/constants.js';
  import { localStore } from './persistence/local.js';
  import { getTurnPrefs, setTurnPrefs, type TurnPrefs } from './collaboration/turn.js';
  import type { DisplayName, CursorColor, RoomId, CollabConnect, IceServer, WebsocketUrl } from './collaboration/types.js';
  import { SessionRole, PresenceKind, Transport } from './collaboration/types.js';
  import { writeGateFor, gateSettleMs, gateLingerMs, type SoloOptIn } from './collaboration/writeGate.js';
  import { departureLingerDeadline } from './collaboration/departureHysteresis.js';
  import { now, type EpochMs } from './time.js';
  import { copyText } from './ui/clipboard.js';
  import { durabilityHolds as computeDurabilityHolds } from './collaboration/persistHealth.js';
  import type { ConflictWarning, PeerUser, RoomEncrypted, StorageAttached } from './ui/types.js';
  import type {
    CollabUnavailable,
    DepartureLingering,
    WriteGateArmable,
    WriteGateHeld,
  } from './ui/syncBannerTier.js';
  import Editor from './Editor.svelte';
  import Settings from './Settings.svelte';
  import ThemeToggle from './ui/ThemeToggle.svelte';
  import ShareDialog from './ui/ShareDialog.svelte';
  import MeetingJoinDialog from './ui/MeetingJoinDialog.svelte';
  import ExportDialog from './ui/ExportDialog.svelte';
  import RecentDocs from './ui/RecentDocs.svelte';
  import { roomName } from './collaboration/roomName.svelte.js';
  import SyncBanner from './ui/SyncBanner.svelte';
  import Toast from './ui/Toast.svelte';
  import { createTheme } from './ui/theme.svelte.js';
  import { createToasts } from './ui/toasts.svelte.js';
  import { createLanguage } from './ui/language.svelte.js';
  import { initInputModality } from './ui/inputModality.js';

  const theme = createTheme();
  const toasts = createToasts();
  const language = createLanguage();
  const reducedMotion =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  $effect(() => initInputModality());
  let shareOpen = $state(false);
  let joinOpen = $state(false);
  let exportOpen = $state(false);

  const { access: envAccess, cipher: envCipher } = resolveRoomStrategy(import.meta.env.VITE_ROOM_AUTH);
  const perRoomPassword = roomPassword();
  const passwordRequiredMode = envAccess.mode === RoomAccessMode.RoomPassword;
  const roomCipher: RoomCipher = {
    password: (r) => currentSecretKey() ?? perRoomPassword.credential(r) ?? envCipher.password(r),
  };
  const loc = {
    protocol: location.protocol as PageProtocol,
    hostname: location.hostname as PageHostname,
  };

  let fetchedIce = $state<IceServer[]>([]);
  const usesIce = resolveTransport(import.meta.env.VITE_COLLAB_TRANSPORT) !== 'websocket';
  const iceServersUrl = usesIce ? resolveIceServersUrl(import.meta.env.VITE_ICE_SERVERS_URL) : undefined;
  // Resolved before the first mount, not after: a post-mount rebuild races
  // y-webrtc's async room deregistration (`openRoom()` throws "already exists").
  let iceReady = $state(!iceServersUrl);
  if (iceServersUrl) {
    void fetchIceServers(iceServersUrl).then((servers) => {
      if (servers.length > 0) fetchedIce = servers;
      iceReady = true;
    });
  }

  function planCollab(): {
    build: (cache: LocalCacheEnabled) => CollabConnect;
    warning?: string;
    technicalWarning?: string;
    // Set only on the hub transport: presenceProbe.ts has no P2P path.
    hallUrl?: WebsocketUrl;
  } {
    if (resolveTransport(import.meta.env.VITE_COLLAB_TRANSPORT) === 'websocket') {
      const ws = resolveWebsocket(import.meta.env.VITE_WEBSOCKET_URL, loc);
      if (ws.url) {
        // TS doesn't carry the narrowing of `ws.url` into the closure below.
        const url = ws.url;
        return { build: (cache) => websocketCollab({ url, cache }), warning: ws.warning, hallUrl: url };
      }
      console.warn('Copad: VITE_COLLAB_TRANSPORT=websocket but VITE_WEBSOCKET_URL is unset, using WebRTC.');
    }
    const signaling = resolveSignaling(import.meta.env.VITE_SIGNALING_URL, loc);
    // Resolved per build (not once) so runtime TURN changes apply on next reconnect.
    const buildIce = (): IceServer[] => {
      const turn = getTurnPrefs();
      const hasRuntimeTurn = turn.urls.length > 0;
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
  const collabUnavailable = (collabWarning !== undefined) as CollabUnavailable;

  let localCache = $state(localCacheEnabled());

  let collabEpoch = $state(0);
  const connect = $derived.by(() => {
    void collabEpoch;
    return collabPlan.build(localCache);
  });

  let editorMounted = $state(true);
  let rebuilding = false;
  /**
   * Reconnect for a same-room config change (TURN/cache/security), remounting
   * the Editor rather than swapping providers directly: a direct swap can
   * construct the new provider before y-webrtc's async room deregistration
   * completes, and `openRoom()` throws "already exists" for the same room name.
   */
  async function rebuildCollab(): Promise<void> {
    if (rebuilding) return;
    rebuilding = true;
    editorMounted = false;
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    editorMounted = true;
    rebuilding = false;
  }

  function setLocalCache(on: boolean): void {
    setLocalCacheEnabled(on);
    localCache = localCacheEnabled();
    void rebuildCollab();
    if (!on) void clearLocalCache().then(() => toasts.info('Local copies cleared'));
  }

  async function clearLocalCopies(): Promise<void> {
    await clearLocalCache();
    toasts.success('Cleared local copies of your documents');
  }

  let turnPrefs = $state<TurnPrefs>(getTurnPrefs());
  function saveTurnPrefs(p: TurnPrefs): void {
    turnPrefs = p;
    setTurnPrefs(p);
    collabEpoch += 1;
    void rebuildCollab();
    toasts.info('Connection settings applied');
  }

  function onSecurityChange(): void {
    collabEpoch += 1;
    void rebuildCollab();
  }

  const COLORS: CursorColor[] = ['#e11d48', '#7c3aed', '#0891b2', '#16a34a', '#d97706', '#db2777'] as CursorColor[];
  let color = $state<CursorColor>(COLORS[Math.floor((now() / 1000) % COLORS.length)]);

  // ── Document / room ────────────────────────────────────────────────────────

  const DEFAULT_ROOM = resolveDefaultRoom(import.meta.env.VITE_DEFAULT_ROOM);

  function roomFromUrl(): RoomId {
    return parseRoomId(new URLSearchParams(location.search).get('room')) ?? DEFAULT_ROOM;
  }

  // Cooperative only: a modified client could ignore ?role=reader.
  function roleFromUrl(): SessionRole {
    return new URLSearchParams(location.search).get('role') === SessionRole.Reader
      ? SessionRole.Reader
      : SessionRole.Writer;
  }

  // Present only on a tab MeetingJoinDialog just opened (`?selfProbe=`).
  function selfProbeMarkerFromUrl(): SelfProbeMarker | null {
    return parseSelfProbeMarker(new URLSearchParams(location.search).get('selfProbe'));
  }

  // Fixed for the lifetime of this tab: a new document always opens a new tab
  // (see `newRoom` below), so `room` never changes in place — there's no
  // in-tab room switch to react to.
  const room: RoomId = roomFromUrl();
  const sessionRole: SessionRole = roleFromUrl();
  const selfProbeMarker: SelfProbeMarker | null = selfProbeMarkerFromUrl();

  // One-shot marker set by `newRoom()` below on the tab it opens; consumed and
  // stripped here so a later reload of this same tab doesn't re-trigger it.
  function autofocusTitleFromUrl(): boolean {
    const params = new URLSearchParams(location.search);
    if (!params.has('new')) return false;
    params.delete('new');
    const query = params.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
    return true;
  }

  const autofocusTitle: boolean = autofocusTitleFromUrl();

  const storageBackends = backends(room);

  function initialStorage(): StorageBackend | null {
    const authed = storageBackends.find(b => b.auth.isAuthenticated());
    if (authed) return authed;
    const byDefault = storageBackends.find(
      b => b.storage.availability.ok && b.storage.id === DEFAULT_BACKEND
    );
    return byDefault ?? storageBackends.find(b => b.storage.availability.ok) ?? null;
  }

  let storage = $state<StorageBackend | null>(initialStorage());
  let name = $state<DisplayName>('Anonymous' as DisplayName);

  // Hand-off to Editor, which owns `collab.doc` and decodes into it.
  let pendingImport = $state<{ bytes: Uint8Array; filename: Filename } | null>(null);

  let tick = $state(0);
  const bump = () => { tick += 1; };

  // ── Session presence / connection (header) ──────────────────────────────────
  let diagOpen = $state(false);
  const otherPeers = $derived(sessionState.users.filter((u) => !u.self));

  // ── Settings ───────────────────────────────────────────────────────────────

  let settingsOpen = $state(false);
  let settingsFocus = $state<StorageId | undefined>(undefined);

  function openSettings(id?: StorageId) {
    settingsFocus = id;
    settingsOpen = true;
  }

  function afterConnect(b: StorageBackend) {
    storage = b;
    savedRoomsStore(b.storage.id).add(room);
    bump();
  }

  function afterDisconnect(_b: StorageBackend) {
    // Don't clear the saved-room set: re-logging in should restore it, not orphan it.
    bump();
  }

  // Backend already authenticated but saves no room yet (pre-dates this feature, or
  // fresh session): adopt the landing room as saved, but only at the default room,
  // never via a shared `?room=` link, which just means a visitor.
  if (!new URLSearchParams(location.search).has('room')) {
    const s = untrack(() => storage);
    if (s && s.auth.isAuthenticated() && savedRoomsStore(s.storage.id).all().length === 0) {
      savedRoomsStore(s.storage.id).add(room);
    }
  }

  // Per-user fact, not a room-level role: several people can each save their own
  // copy under per-target autosave.
  const savedHere = $derived.by((): StorageAttached => {
    void tick;
    void room;
    const s = storage;
    return (!!s &&
      s.auth.isAuthenticated() &&
      savedRoomsStore(s.storage.id).saves(room)) as StorageAttached;
  });

  // Another saved room resolving to the same file, detectable only within this
  // browser, without a server-side coordination point.
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
  const conflictWarning = $derived.by((): ConflictWarning | undefined => {
    const other = fileConflict;
    const s = storage;
    if (!other || !s) return undefined;
    const file = filenameForRoom(s.storage.id, room, s.storage.defaultFilename?.());
    return `Room “${other}” also saves to ${file} on your ${s.storage.label}. They’ll overwrite each other. Rename this room’s file in Settings.` as ConflictWarning;
  });

  // ── Write gate (docs/contract.md §1-§4) ──────────────────────────────────────
  // writeGateFor() is pure; this section supplies its inputs and owns its two
  // clocks (settle + departure-linger). Uncertain presence OPENS the gate: a
  // false lockout is the costly failure (contract §2.2).
  //
  // durabilityHolds feeds branch (b), not the bare `savedHere` fact. Don't swap
  // it in below, or a Broken room loses the flush() calls that could heal it
  // (contract §3.2/§3.3).
  const durabilityHolds = $derived(
    computeDurabilityHolds(savedHere, sessionState.persistHealth, sessionState.regime),
  );
  let soloRooms = $state<RoomId[]>([]);
  const soloOptIn = $derived((sessionState.diagnostics.transport === Transport.P2P &&
    soloRooms.includes(room)) as SoloOptIn);

  // Set only by the explicit click, never when writeLocked flips false on its own.
  // Editor's focus-on-unlock effect keys off this so it never steals focus (§4.1).
  let writeSoloAt = $state<EpochMs | null>(null);

  function allowWriteSolo(): void {
    if (!soloRooms.includes(room)) soloRooms = [...soloRooms, room];
    writeSoloAt = now();
  }

  const inviteUrl = $derived.by((): string => {
    const key = currentSecretKey();
    const base = `${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`;
    return key ? `${base}#k=${encodeURIComponent(key)}` : base;
  });
  const COPY_INVITE_TOAST_GROUP = 'copy-invite-link';
  async function copyInviteLink(): Promise<void> {
    if (await copyText(inviteUrl)) {
      toasts.success('Invite link copied to clipboard', undefined, COPY_INVITE_TOAST_GROUP);
    } else {
      toasts.info('Open Share to copy the invite link', undefined, COPY_INVITE_TOAST_GROUP);
    }
  }

  let aloneSettled = $state(false);
  // Fixed clock time (contract §4.2), not a ticking duration: no interval needed.
  let waitingSince = $state<EpochMs | null>(null);
  $effect(() => {
    if (sessionState.presence.kind !== PresenceKind.Alone) {
      aloneSettled = false;
      waitingSince = null;
      return;
    }
    waitingSince = now();
    const t = setTimeout(() => (aloneSettled = true), gateSettleMs(sessionState.diagnostics.transport));
    return () => clearTimeout(t);
  });

  // Tab title reflects waiting (contract §4.2). Captured once as a plain `let`,
  // not `$state`, since the browser tab never reloads even though this module re-runs.
  const baseTitle = document.title;
  $effect(() => {
    document.title = sessionState.presence.kind === PresenceKind.Alone ? `Waiting… · ${baseTitle}` : baseTitle;
  });

  // The last non-empty peer list: names who just left (contract §4, "Ada left").
  let lastPeers: PeerUser[] = [];
  $effect(() => {
    if (sessionState.users.length > 0) lastPeers = sessionState.users;
  });

  // Hysteresis so a peer who just left doesn't instantly lock a mid-sentence writer.
  const LINGERING = true as DepartureLingering;
  const NOT_LINGERING = false as DepartureLingering;
  let withinDepartureLinger = $state(NOT_LINGERING);
  let departedAt = $state<EpochMs | null>(null);
  let departedPeerName = $state<DisplayName | null>(null);
  let wasAccompanied = false;
  $effect(() => {
    const kind = sessionState.presence.kind;
    if (kind === PresenceKind.Accompanied) {
      wasAccompanied = true;
      withinDepartureLinger = NOT_LINGERING;
      departedAt = null;
      departedPeerName = null;
      return;
    }
    if (!wasAccompanied) return;
    wasAccompanied = false;
    departedAt = now();
    departedPeerName = lastPeers[0]?.name ?? null;
  });

  // Re-arms on every keystroke instead of a flat timer, so it never cuts a
  // mid-sentence writer off; capped in departureHysteresis.ts.
  $effect(() => {
    if (departedAt === null) return;
    const deadline = departureLingerDeadline(
      departedAt,
      sessionState.lastLocalEditAt,
      gateLingerMs(sessionState.diagnostics.transport),
    );
    const remaining = deadline - now();
    if (remaining <= 0) {
      withinDepartureLinger = NOT_LINGERING;
      return;
    }
    withinDepartureLinger = LINGERING;
    const t = setTimeout(() => (withinDepartureLinger = NOT_LINGERING), remaining);
    return () => clearTimeout(t);
  });

  // Fires once per arrival (contract §4.1): a separate flag from the departure
  // effect's `wasAccompanied` so the two don't fight over one boolean. Never
  // calls `.focus()`; never steal focus.
  let wasUnlockedAccompanied = false;
  let justJoinedIds = $state<number[]>([]);
  let unlockLine = $state<string | null>(null);
  let unlockLineTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    if (sessionState.presence.kind !== PresenceKind.Accompanied) {
      wasUnlockedAccompanied = false;
      return;
    }
    if (wasUnlockedAccompanied) return;
    wasUnlockedAccompanied = true;
    const arrived = sessionState.users.filter((u) => !u.self);
    justJoinedIds = arrived.map((u) => u.id);
    clearTimeout(unlockLineTimer);
    unlockLine = `${arrived[0]?.name ?? 'Someone'} is here. The document is open.`;
    unlockLineTimer = setTimeout(() => (unlockLine = null), 3_000);
  });

  const gate = $derived(
    writeGateFor({
      role: sessionRole,
      presence: sessionState.presence,
      collabUnavailable,
      soloOptIn,
      savedHere: durabilityHolds,
      aloneSettled,
      withinDepartureLinger,
    }),
  );
  const writeLocked = $derived((gate.status === 'held') as WriteGateHeld);

  // Import bypasses ProseMirror's `editable` check (writes straight into `collab.doc`),
  // so this button re-derives the gate independently; Editor re-checks it again on
  // the `pendingImport` hand-off.
  const canImportHere = $derived(sessionRole === SessionRole.Writer && !writeLocked);

  async function importLocalFile(): Promise<void> {
    if (!canImportHere) return;
    let file: File;
    try {
      file = await pickFile();
    } catch {
      return; // cancelled
    }
    pendingImport = { bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name as Filename };
  }

  // Superset of `writeLocked`: drives SyncBanner's tiering during the pre-lock
  // grace window before the clocks let writeGateFor return `held`.
  const gateEligible = $derived(
    (sessionRole === SessionRole.Writer &&
      !collabUnavailable &&
      !soloOptIn &&
      !durabilityHolds &&
      sessionState.presence.kind !== PresenceKind.Accompanied) as WriteGateArmable,
  );

  // ── Collab-unavailable intro: a structurally local-only deployment ─────────
  // One-time acknowledgment on first load of a permanently local-only deployment.
  // Never blocks writing: purely informational, dismissible like any dialog.
  const collabUnavailableSeenStore = localStore<boolean>(
    KEY_COLLAB_UNAVAILABLE_SEEN,
    (raw) => raw === 'true',
    String,
  );
  let collabUnavailableSeen = $state(collabUnavailableSeenStore.read());
  function markCollabUnavailableSeen(): void {
    if (collabUnavailableSeen) return;
    collabUnavailableSeen = true;
    collabUnavailableSeenStore.write(true);
  }
  const showCollabUnavailableIntro = $derived(
    collabUnavailable && !collabUnavailableSeen && !shareOpen && !settingsOpen && !exportOpen,
  );

  function connectStorageFromCollabIntro(): void {
    markCollabUnavailableSeen();
    openSettings();
  }

  // ── Encrypted-room access gate ───────────────────────────────────────────────
  // Until the async check resolves, `lockChecked` holds the Editor back so a
  // locked room never mounts it and writes a plaintext cache without the key.
  const encryptedTransport = usesIce;
  const roomEncrypted = $derived.by((): RoomEncrypted => {
    void collabEpoch;
    return (encryptedTransport && roomCipher.password(room) !== null) as RoomEncrypted;
  });
  let lock = $state<RoomLockState>({ locked: false });
  let lockChecked = $state(!encryptedTransport);
  let lockAllowSkip = $state(false);

  $effect(() => {
    const r = room;
    void collabEpoch;
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
        void rememberRoomEncryption(r, cred);
        lock = { locked: false };
      } else if (passwordRequiredMode && !roomOpenedWithoutPassword(r)) {
        lock = { locked: true, reason: 'missing' };
        lockAllowSkip = true;
      } else {
        lock = { locked: false };
      }
      lockChecked = true;
      return;
    }
    // Never overwrite the stored fingerprint here: that's what lets a wrong key
    // be detected instead of silently adopted.
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

  function continueWithoutPassword(): void {
    setRoomOpenedWithoutPassword(room);
    collabEpoch += 1;
  }

  async function tryUnlock(raw: string): Promise<boolean> {
    const cred = parseRoomCredential(raw);
    if (!cred) return false;
    const stored = roomEncryptionFingerprint(room);
    if (stored && (await keyFingerprint(cred)) !== stored) return false;
    setRoomPassword(room, cred);
    onSecurityChange();
    return true;
  }

  // A new tab, never an in-place room switch: `backends(room)` captures `room`
  // once by closure (storage/filename.ts), so there's no live pointer to retarget.
  // CSPRNG room id (contract §5); the secret-link key encrypts the room by default.
  function newRoom(): void {
    const r = newRoomId();
    const key = mintSecretKey();
    window.open(
      `${location.pathname}?room=${encodeURIComponent(r)}&new=1#k=${encodeURIComponent(key)}`,
      '_blank',
      'noopener',
    );
  }

  // Guards against a stray Enter/Space firing this while tabbing through the page.
  function confirmReload(): void {
    if (confirm('Reload Copad? Any unsaved local state will be lost.')) {
      location.reload();
    }
  }
</script>

<div class="app">
  <!-- Not a heading: an <h1> here would give screen readers two level-1 titles
       alongside the document's own (Editor.svelte's DocTitle). Hidden on mobile;
       actions move to the bottom dock below. -->
  <header class="capsule">
    <button class="cap-mark" onclick={confirmReload} title="Reload Copad" aria-label="Reload Copad">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 19.5V6a2 2 0 0 1 2-2h8l6 6v9.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" /><path d="M14 4v6h6" />
      </svg>
    </button>

    <button
      class="cap-btn"
      onclick={newRoom}
      title="New document (opens in a new tab)"
      aria-label="New document (opens in a new tab)"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>

    <button
      class="cap-btn"
      onclick={importLocalFile}
      disabled={!canImportHere}
      title="Import a file into this document"
      aria-label="Import a file into this document"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3v12m0 0l-4-4m4 4l4-4" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
      </svg>
    </button>
    <button class="cap-btn" onclick={() => (joinOpen = true)} title="Join a meeting link" aria-label="Join a meeting link">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    </button>
    <button class="cap-btn" onclick={() => (exportOpen = true)} title="Export a copy of this document" aria-label="Export a copy of this document">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 15V3m0 0l-4 4m4-4l4 4" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
      </svg>
    </button>
    <RecentDocs current={room} />

    <div class="cap-fill"></div>

    <div class="session">
      <!-- Tap opens the connection/storage detail sheet. -->
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
        <PresenceBar users={otherPeers} size={24} onSelect={sessionState.jumpToPeer} {justJoinedIds} />
        {#if sessionState.soloBrowser}
          <!-- Names a second tab of your own browser so it doesn't read as a stranger (contract §7). -->
          <span class="solo-browser-note">Another tab of yours</span>
        {/if}
      {/if}
    </div>

    <div class="cap-divider"></div>

    <div class="cap-identity">
      <IdentityMenu
        {name}
        {color}
        colors={COLORS}
        size={32}
        onName={(v) => { name = v as DisplayName; }}
        onColor={(c) => { color = c; }}
      />
    </div>
    <button class="cap-share share-btn" onclick={() => (shareOpen = true)} title="Share / invite collaborators">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
        <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
      </svg>
      Share
    </button>
    <button class="cap-btn" onclick={() => openSettings()} title="Settings" aria-label="Settings">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
      </svg>
    </button>
    <div class="cap-theme"><ThemeToggle {theme} /></div>
  </header>

  <!-- Mobile-only; hidden the instant the document has focus, when editor.css's
       .fixed-toolbar takes the same slot. -->
  <div
    class="mobile-dock"
    class:dock-hidden={sessionState.editing}
    style="--kb-inset: {keyboardInset.px}px"
  >
    <IdentityMenu
      {name}
      {color}
      colors={COLORS}
      onName={(v) => { name = v as DisplayName; }}
      onColor={(c) => { color = c; }}
    />
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
    <div class="dock-fill"></div>
    <button class="dock-btn" onclick={newRoom} title="New document (opens in a new tab)" aria-label="New document (opens in a new tab)">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
    <button class="dock-btn" onclick={importLocalFile} disabled={!canImportHere} title="Import a file into this document" aria-label="Import a file into this document">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3v12m0 0l-4-4m4 4l4-4" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
      </svg>
    </button>
    <button class="dock-btn" onclick={() => (joinOpen = true)} title="Join a meeting link" aria-label="Join a meeting link">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    </button>
    <RecentDocs current={room} buttonClass="dock-btn" />
    <button class="dock-btn" onclick={() => (exportOpen = true)} title="Export a copy of this document" aria-label="Export a copy of this document">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 15V3m0 0l-4 4m4-4l4 4" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
      </svg>
    </button>
    <button class="dock-share" onclick={() => (shareOpen = true)} title="Share / invite collaborators" aria-label="Share / invite collaborators">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
        <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
      </svg>
      Share
    </button>
    <button class="dock-btn" onclick={() => openSettings()} title="Settings" aria-label="Settings">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
      </svg>
    </button>
  </div>

  <!-- One strip, escalation ladder: gated (blocks, transient) → collab-unavailable
       (never blocks, permanent) → solo reminder (never blocks, transient). -->
  <SyncBanner
    conn={sessionState.conn}
    presenceKind={sessionState.presence.kind}
    transport={sessionState.diagnostics.transport}
    storageLabel={savedHere && storage ? storage.storage.label : null}
    gated={writeLocked}
    {gateEligible}
    {collabUnavailable}
    {waitingSince}
    {departedPeerName}
    {withinDepartureLinger}
    onShare={() => (shareOpen = true)}
    onConnectStorage={() => openSettings()}
    onExport={() => (exportOpen = true)}
    onWriteSolo={allowWriteSolo}
    onCopyInviteLink={copyInviteLink}
    onRetry={sessionState.diagnostics.reconnect}
    onConnectionDetails={() => (diagOpen = true)}
  />

  <!-- The unlock moment's one self-dismissing line (contract §4.1); never steals focus. -->
  {#if unlockLine}
    <div class="unlock-line" role="status" aria-live="polite" transition:fade={{ duration: reducedMotion ? 0 : 200 }}>
      {unlockLine}
    </div>
  {/if}

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
    <Editor
      {name}
      {color}
      {room}
      role={sessionRole}
      {selfProbeMarker}
      {connect}
      {toasts}
      storage={savedHere ? storage!.storage : null}
      lang={language.resolved}
      spellcheck={language.spellcheck}
      {writeLocked}
      {writeSoloAt}
      importRequest={pendingImport}
      onImportHandled={() => (pendingImport = null)}
      {autofocusTitle}
    />
    <CollabUnavailableIntro
      open={showCollabUnavailableIntro}
      saved={savedHere}
      storageLabel={savedHere && storage ? storage.storage.label : null}
      onConnectStorage={connectStorageFromCollabIntro}
      onDismiss={markCollabUnavailableSeen}
    />
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
  jumpToPeer={sessionState.jumpToPeer}
  onConnectStorage={() => openSettings()}
/>

<Settings
  backends={storageBackends}
  bind:open={settingsOpen}
  focusId={settingsFocus}
  {theme}
  {localCache}
  onCacheChange={setLocalCache}
  onCacheClear={clearLocalCopies}
  {turnPrefs}
  onTurnChange={saveTurnPrefs}
  languageChoice={language.choice}
  spellcheck={language.spellcheck}
  onLanguageChange={language.setChoice}
  onSpellcheckChange={language.setSpellcheck}
  exportBaseName={roomName.value ?? room}
  {toasts}
  onchange={bump}
  onconnect={afterConnect}
  ondisconnect={afterDisconnect}
  onimport={(bytes, filename) => (pendingImport = { bytes, filename })}
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

<MeetingJoinDialog open={joinOpen} onclose={() => (joinOpen = false)} {toasts} hallUrl={collabPlan.hallUrl} />

<ExportDialog
  open={exportOpen}
  onclose={() => (exportOpen = false)}
  baseName={roomName.value ?? room}
  {toasts}
/>
<Toast {toasts} />

<style>
  .unlock-line {
    padding: var(--sp-1) var(--sp-4) 0;
    color: var(--text-muted);
    font-size: var(--fs-300);
  }

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
  .solo-browser-note {
    margin-left: var(--sp-2);
    color: var(--text-faint);
    font-size: var(--fs-300);
    white-space: nowrap;
  }
</style>
