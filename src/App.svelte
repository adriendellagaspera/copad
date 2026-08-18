<script lang="ts">
  import { tick as nextTick, untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import { exportBaseName } from './format/download.js';
  import { backends, DEFAULT_BACKEND } from './storage/index.js';
  import { pickFile } from './format/filePicker.js';
  import type { StorageBackend } from './storage/index.js';
  import { savedRoomsStore } from './storage/savedRooms.js';
  import { filenameForRoom, firstFileCollision } from './storage/filename.js';
  import { parseFilename } from './storage/parse.js';
  import { DEFAULT_FILENAME } from './storage/constants.js';
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
    resolveLandingRoom,
    type PageProtocol,
    type PageHostname,
  } from './collaboration/config.js';
  import { fetchIceServers } from './collaboration/iceServers.js';
  import { parseRoomCredential, parseSelfProbeMarker } from './collaboration/parse.js';
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
  import StorageIntro from './ui/StorageIntro.svelte';
  import FirstVisitIntro from './ui/FirstVisitIntro.svelte';
  import About from './ui/About.svelte';
  import { modKey } from './ui/platform.js';
  import LibraryDialog from './ui/LibraryDialog.svelte';
  import {
    rememberRoomVisit,
    clearRoomHistory,
    libraryWorthy,
    roomHistory,
    roomVisitUrl,
    openedLabel,
    roomDiscriminator,
    type PagePath,
    type RoomEngagement,
  } from './collaboration/roomHistory.js';
  import {
    actionItemId,
    parsePaletteItemId,
    type PaletteAction,
    type PaletteItemId,
    type PaletteItemKeywords,
    type PaletteItemHint,
    type PaletteItemLabel,
    type PaletteItemName,
    type PaletteRoom,
    paletteItemName,
  } from './ui/commandPalette.js';
  import { KEY_STORAGE_INTRO_SEEN } from './collaboration/constants.js';
  import { localStore } from './persistence/local.js';
  import { getTurnPrefs, setTurnPrefs, type TurnPrefs } from './collaboration/turn.js';
  import type { DisplayName, CursorColor, RoomId, CollabConnect, IceServer, WebsocketUrl, ClientId } from './collaboration/types.js';
  import { SessionRole, PresenceKind, Transport } from './collaboration/types.js';
  import { writeGateFor, gateSettleMs, gateLingerMs, type SoloOptIn } from './collaboration/writeGate.js';
  import { departureLingerDeadline } from './collaboration/departureHysteresis.js';
  import { now, type EpochMs } from './time.js';
  import { copyText } from './ui/clipboard.js';
  import { durabilityHolds as computeDurabilityHolds } from './collaboration/persistHealth.js';
  import { routeFor, aboutUrl, newDocumentUrl, RouteKind, type PageQuery } from './ui/route.js';
  import { introSlotFor, IntroSlotKind, type IntroEligible } from './ui/introSlot.js';
  import type {
    ConflictWarning,
    DialogOpen,    FocusAdvanced,
    PeerUser,
    RoomEncrypted,
    StorageAttached,
  } from './ui/types.js';
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
  import { storedName, rememberName } from './collaboration/identity.js';
  import { roomName } from './collaboration/roomName.svelte.js';
  import SyncBanner, { BannerPlacement } from './ui/SyncBanner.svelte';
  import Toast from './ui/Toast.svelte';
  import { createTheme } from './ui/theme.svelte.js';
  import { createFontChoice } from './ui/fontChoice.svelte.js';
  import { createToasts } from './ui/toasts.svelte.js';
  import { createLanguage } from './ui/language.svelte.js';
  import { initInputModality } from './ui/inputModality.js';

  const theme = createTheme();
  // No control here — FontSelect (mounted inside Settings) owns the picker;
  // this only applies whatever was last chosen as soon as the room loads,
  // rather than leaving it stuck at default until Settings happens to open.
  createFontChoice();
  const toasts = createToasts();
  const language = createLanguage();
  const reducedMotion =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  $effect(() => initInputModality());
  const CLOSED = false as DialogOpen;
  const OPENED = true as DialogOpen;
  let shareOpen = $state(CLOSED);
  let joinOpen = $state(CLOSED);
  let exportOpen = $state(CLOSED);
  let libraryOpen = $state(CLOSED);
  let paletteOpen = $state(CLOSED);
  const modLabel = modKey();

  const { access: envAccess, cipher: envCipher } = resolveRoomStrategy(import.meta.env.VITE_ROOM_AUTH);
  const perRoomPassword = roomPassword();
  const envRoomPassword = parseRoomCredential(import.meta.env.VITE_ROOM_PASSWORD ?? null);
  const passwordRequiredMode = envAccess.mode === RoomAccessMode.RoomPassword;
  const roomCipher: RoomCipher = {
    password: (r) => currentSecretKey() ?? perRoomPassword.credential(r) ?? envCipher.password(r),
  };
  const loc = {
    protocol: location.protocol as PageProtocol,
    hostname: location.hostname as PageHostname,
  };

  const transport: Transport =
    resolveTransport(import.meta.env.VITE_COLLAB_TRANSPORT) === 'websocket' ? Transport.Hub : Transport.P2P;

  let fetchedIce = $state<IceServer[]>([]);
  const usesIce = transport === Transport.P2P;
  const iceServersUrl = usesIce ? resolveIceServersUrl(import.meta.env.VITE_ICE_SERVERS_URL) : undefined;
  // Resolved before first mount: a later rebuild races y-webrtc's async room deregistration.
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
    if (transport === Transport.Hub) {
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
  // Remount rather than swap providers: y-webrtc's async deregistration makes `openRoom()` throw.
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
    clearRoomHistory();
    toasts.success('Cleared local copies and your document list');
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

  // Read before `startFreshRoom` below rewrites the URL and adds one.
  const linkedRoomParam = new URLSearchParams(location.search).get('room');
  const landing = resolveLandingRoom(linkedRoomParam, import.meta.env.VITE_DEFAULT_ROOM, newRoomId);
  const route = routeFor(location.search as PageQuery);

  // Runs before `room` is read below, so a reload returns to the minted room rather than minting another.
  function startFreshRoom(r: RoomId): void {
    const params = new URLSearchParams(location.search);
    params.set('room', r);
    const fragment = new URLSearchParams(location.hash.slice(1));
    fragment.set('k', currentSecretKey() ?? mintSecretKey());
    history.replaceState(null, '', `${location.pathname}?${params.toString()}#${fragment.toString()}`);
  }
  if (landing.minted && route.kind === RouteKind.Room) startFreshRoom(landing.room);

  // Cooperative only: a modified client could ignore ?role=reader.
  function roleFromUrl(): SessionRole {
    return new URLSearchParams(location.search).get('role') === SessionRole.Reader
      ? SessionRole.Reader
      : SessionRole.Writer;
  }

  function selfProbeMarkerFromUrl(): SelfProbeMarker | null {
    return parseSelfProbeMarker(new URLSearchParams(location.search).get('selfProbe'));
  }

  // Fixed for this tab's lifetime: a new document opens a new tab, never an in-place switch.
  const room: RoomId = landing.room;
  const sessionRole: SessionRole = roleFromUrl();
  const selfProbeMarker: SelfProbeMarker | null = selfProbeMarkerFromUrl();

  // Stripped once consumed, so a reload of this tab doesn't re-trigger it.
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
  let name = $state<DisplayName>(storedName());

  let pendingImport = $state<{ bytes: Uint8Array; filename: Filename } | null>(null);

  let tick = $state(0);
  const bump = () => { tick += 1; };

  let diagOpen = $state(CLOSED);
  const otherPeers = $derived(sessionState.users.filter((u) => !u.self));

  const COMPACT_CHROME_QUERY = '(pointer: coarse), (max-width: 900px)';
  let compactChrome = $state(
    typeof matchMedia !== 'undefined' && matchMedia(COMPACT_CHROME_QUERY).matches,
  );
  $effect(() => {
    const mql = matchMedia(COMPACT_CHROME_QUERY);
    compactChrome = mql.matches;
    const onChange = (e: MediaQueryListEvent) => { compactChrome = e.matches; };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  });

  let settingsOpen = $state(CLOSED);
  let settingsFocus = $state<StorageId | undefined>(undefined);
  let settingsAdvanced = $state(false as FocusAdvanced);

  function openSettings(id?: StorageId) {
    settingsFocus = id;
    settingsAdvanced = false as FocusAdvanced;
    settingsOpen = OPENED;
  }

  function openConnectionSettings(): void {
    settingsFocus = undefined;
    settingsAdvanced = true as FocusAdvanced;
    settingsOpen = OPENED;
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

  // Adopt your own landing room as saved, never a room reached by someone else's link.
  if (linkedRoomParam === null) {
    const s = untrack(() => storage);
    if (s && s.auth.isAuthenticated() && savedRoomsStore(s.storage.id).all().length === 0) {
      savedRoomsStore(s.storage.id).add(room);
    }
  }

  // Per-user, not room-level: several people can each save their own copy.
  const savedHere = $derived.by((): StorageAttached => {
    void tick;
    void room;
    const s = storage;
    return (!!s &&
      s.auth.isAuthenticated() &&
      savedRoomsStore(s.storage.id).saves(room)) as StorageAttached;
  });

  // Detectable only within this browser: there is no server-side coordination point.
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

  // Inputs and clocks for the write gate (docs/contract.md §1-§4).
  // `durabilityHolds`, not bare `savedHere`: a Broken room must keep its healing flush() calls (§3.2).
  const durabilityHolds = $derived(
    computeDurabilityHolds(savedHere, sessionState.persistHealth, sessionState.regime),
  );
  let soloRooms = $state<RoomId[]>([]);
  const soloOptIn = $derived((sessionState.diagnostics.transport === Transport.P2P &&
    soloRooms.includes(room)) as SoloOptIn);

  // Set only by the explicit click; Editor's focus-on-unlock effect keys off it (contract §4.1).
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

  // Plain `let`: the tab never reloads even though this module re-runs.
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

  // Re-arms per keystroke so it never cuts a mid-sentence writer off; capped in departureHysteresis.ts.
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

  // Separate flag from the departure effect's `wasAccompanied`; never steals focus (contract §4.1).
  let wasUnlockedAccompanied = false;
  let justJoinedIds = $state<ClientId[]>([]);
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

  // Import writes straight into `collab.doc`, bypassing ProseMirror's `editable` check.
  const canImportHere = $derived(sessionRole === SessionRole.Writer && !writeLocked);

  async function importLocalFile(): Promise<void> {
    if (!canImportHere) return;
    let file: File;
    try {
      file = await pickFile();
    } catch {
      return; // cancelled
    }
    pendingImport = {
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: parseFilename(file.name, DEFAULT_FILENAME),
    };
  }

  // Superset of `writeLocked`: also covers the grace window before the clocks let the gate hold.
  const gateEligible = $derived(
    (sessionRole === SessionRole.Writer &&
      !collabUnavailable &&
      !soloOptIn &&
      !durabilityHolds &&
      sessionState.presence.kind !== PresenceKind.Accompanied) as WriteGateArmable,
  );

  // `lockChecked` holds the Editor back so a locked room never caches plaintext without the key.
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
    // Never overwrite the stored fingerprint: it is what detects a wrong key.
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

  const storageIntroSeenStore = localStore<boolean>(
    KEY_STORAGE_INTRO_SEEN,
    (raw) => raw === 'true',
    String,
  );
  let storageIntroSeen = $state(storageIntroSeenStore.read());
  function markStorageIntroSeen(): void {
    if (storageIntroSeen) return;
    storageIntroSeen = true;
    storageIntroSeenStore.write(true);
  }
  const introEligible = $derived((!storageIntroSeen && !collabUnavailable && !savedHere
    && !writeLocked && iceReady && lockChecked && !lock.locked) as IntroEligible);
  const introSlot = $derived(
    introSlotFor({
      eligible: introEligible,
      docEmpty: sessionState.docEmpty,
      regime: sessionState.regime,
    }),
  );

  function connectStorageFromStorageIntro(): void {
    markStorageIntroSeen();
    openSettings();
  }

  const pagePath = location.pathname as PagePath;

  const engagement = $derived<RoomEngagement>({
    askedFor: !landing.minted || autofocusTitle,
    writing: writeSoloAt !== null,
    accompanied: otherPeers.length > 0,
    named: roomName.value !== null,
    savedHere,
  });

  // A locked room's key is missing or wrong, and recording it would overwrite a working one.
  $effect(() => {
    if (!lockChecked || lock.locked || !libraryWorthy(engagement)) return;
    rememberRoomVisit({
      room,
      name: roomName.value,
      key: currentSecretKey(),
      role: sessionRole,
      openedAt: now(),
    });
  });

  function replaceWithNewDocument(): void {
    location.href = newDocumentUrl(pagePath, newRoomId(), mintSecretKey());
  }

  function openAbout(): void {
    location.href = aboutUrl(pagePath);
  }

  // New tab, never in-place: `backends(room)` captures `room` by closure (storage/filename.ts).
  function newRoom(): void {
    window.open(newDocumentUrl(pagePath, newRoomId(), mintSecretKey()), '_blank', 'noopener');
  }

  // ── The command palette ────────────────────────────────────────────────────
  //
  // App owns the actions and the remembered rooms; Editor owns the headings and
  // the insertable blocks, which need the live view. Rows carry ids, not
  // callbacks, so this is the one place a pick turns back into a call.

  const action = (
    name: PaletteItemName,
    label: PaletteItemLabel,
    keywords: PaletteItemKeywords,
    run: () => void,
  ): PaletteAction & { readonly run: () => void } => ({
    id: actionItemId(name),
    label,
    keywords,
    run,
  });

  const paletteActions = $derived([
    action(
      paletteItemName('new'),
      'New document' as PaletteItemLabel,
      'create blank' as PaletteItemKeywords,
      newRoom,
    ),
    action(
      paletteItemName('library'),
      'Your documents' as PaletteItemLabel,
      'library recent rooms open' as PaletteItemKeywords,
      () => (libraryOpen = OPENED),
    ),
    action(
      paletteItemName('share'),
      'Share' as PaletteItemLabel,
      'invite link collaborate' as PaletteItemKeywords,
      () => (shareOpen = OPENED),
    ),
    action(
      paletteItemName('export'),
      'Export a copy' as PaletteItemLabel,
      'download save markdown pdf word' as PaletteItemKeywords,
      () => (exportOpen = OPENED),
    ),
    action(
      paletteItemName('join'),
      'Join a meeting link' as PaletteItemLabel,
      'meeting paste' as PaletteItemKeywords,
      () => (joinOpen = OPENED),
    ),
    action(
      paletteItemName('settings'),
      'Settings' as PaletteItemLabel,
      'preferences storage language theme' as PaletteItemKeywords,
      () => openSettings(),
    ),
    action(paletteItemName('about'), 'What Copad is' as PaletteItemLabel, 'help explain' as PaletteItemKeywords, openAbout),
    ...(canImportHere
      ? [
          action(
            paletteItemName('import'),
            'Import a file' as PaletteItemLabel,
            'upload open file' as PaletteItemKeywords,
            importLocalFile,
          ),
        ]
      : []),
  ]);

  const paletteRooms = $derived.by<PaletteRoom[]>(() => {
    if (!paletteOpen) return [];
    const reference = now();
    return roomHistory()
      .filter((visit) => visit.room !== room)
      .map((visit) => ({
        room: visit.room,
        label: (visit.name ?? `Untitled ${roomDiscriminator(visit.room)}`) as PaletteItemLabel,
        hint: openedLabel(visit.openedAt, reference) as string as PaletteItemHint,
      }));
  });

  function onPaletteCommand(id: PaletteItemId): void {
    const target = parsePaletteItemId(id);
    if (target.kind === 'room') {
      const visit = roomHistory().find((v) => v.room === target.room);
      if (visit) window.open(roomVisitUrl(visit, pagePath), '_blank', 'noopener');
      return;
    }
    paletteActions.find((a) => a.id === id)?.run();
  }

  // Unconditional, whatever holds focus — Link moved to Mod-Shift-K to free it
  // (#280). Left alone it would reach the browser's own search bar.
  $effect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'k' && e.key !== 'K') return;
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      e.preventDefault();
      paletteOpen = OPENED;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

{#if route.kind === RouteKind.About}
  <About onNewDocument={replaceWithNewDocument} {transport} page={pagePath} />
{:else}
<div class="app">
  <!-- Not an <h1>: DocTitle in Editor.svelte owns the page's only level-1 title. -->
  <header class="capsule">
    <button class="cap-mark" onclick={openAbout} title="What Copad is" aria-label="What Copad is">
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
      onclick={() => (libraryOpen = OPENED)}
      title="Your documents"
      aria-label="Your documents"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H9a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0-1.5-1.5H4Z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H15a2 2 0 0 0-2 2v13a1.5 1.5 0 0 1 1.5-1.5H20Z" />
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
    <button class="cap-btn" onclick={() => (joinOpen = OPENED)} title="Join a meeting link" aria-label="Join a meeting link">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    </button>
    <button class="cap-btn" onclick={() => (exportOpen = OPENED)} title="Export a copy of this document" aria-label="Export a copy of this document">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 15V3m0 0l-4 4m4-4l4 4" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
      </svg>
    </button>

    <button
      class="cap-search"
      onclick={() => (paletteOpen = OPENED)}
      aria-haspopup="dialog"
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" />
      </svg>
      <span class="cap-search-text">Search documents, headings, actions</span>
      <kbd class="cap-search-key">{modLabel}K</kbd>
    </button>

    <div class="session">
      <StatusPill
        conn={sessionState.conn}
        saveStatus={sessionState.saveStatus}
        hasStorage={savedHere}
        storageLabel={savedHere ? storage?.storage.label : undefined}
        warning={conflictWarning}
        transport={sessionState.diagnostics.transport}
        encrypted={roomEncrypted}
        onclick={() => (diagOpen = OPENED)}
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
        onName={(v) => { name = rememberName(v); }}
        onColor={(c) => { color = c; }}
      />
    </div>
    <button class="cap-share share-btn" onclick={() => (shareOpen = OPENED)} title="Share / invite collaborators">
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

  <!-- Hidden once the document has focus: editor.css's .fixed-toolbar takes this slot. -->
  <div
    class="mobile-dock"
    class:dock-hidden={sessionState.editing}
    style="--kb-inset: {keyboardInset.px}px"
  >
    <IdentityMenu
      {name}
      {color}
      colors={COLORS}
      onName={(v) => { name = rememberName(v); }}
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
      onclick={() => (diagOpen = OPENED)}
    />
    <div class="dock-fill"></div>
    <button class="dock-btn" onclick={newRoom} title="New document (opens in a new tab)" aria-label="New document (opens in a new tab)">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
    <button class="dock-btn" onclick={() => (libraryOpen = OPENED)} title="Your documents" aria-label="Your documents">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H9a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0-1.5-1.5H4Z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H15a2 2 0 0 0-2 2v13a1.5 1.5 0 0 1 1.5-1.5H20Z" />
      </svg>
    </button>
    <button class="dock-btn" onclick={importLocalFile} disabled={!canImportHere} title="Import a file into this document" aria-label="Import a file into this document">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3v12m0 0l-4-4m4 4l4-4" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
      </svg>
    </button>
    <button class="dock-btn" onclick={() => (joinOpen = OPENED)} title="Join a meeting link" aria-label="Join a meeting link">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    </button>
    <button class="dock-btn" onclick={() => (paletteOpen = OPENED)} title="Search and commands" aria-label="Search and commands" aria-haspopup="dialog">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" />
      </svg>
    </button>
    <button class="dock-btn" onclick={() => (exportOpen = OPENED)} title="Export a copy of this document" aria-label="Export a copy of this document">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 15V3m0 0l-4 4m4-4l4 4" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
      </svg>
    </button>
    <button class="dock-share" onclick={() => (shareOpen = OPENED)} title="Share / invite collaborators" aria-label="Share / invite collaborators">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
        <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
      </svg>
      <span class="dock-share-label">Share</span>
    </button>
    <button class="dock-btn" onclick={() => openSettings()} title="Settings" aria-label="Settings">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
      </svg>
    </button>
  </div>

  <!-- One strip, escalation ladder: gated → collab-unavailable → solo reminder. -->
  {#if !(compactChrome && sessionState.editing)}
    <div class="sync-banner-sheet-anchor" style="--kb-inset: {keyboardInset.px}px">
      <SyncBanner
        placement={BannerPlacement.Sheet}
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
        onShare={() => (shareOpen = OPENED)}
        onConnectStorage={() => openSettings()}
        onExport={() => (exportOpen = OPENED)}
        onWriteSolo={allowWriteSolo}
        onCopyInviteLink={copyInviteLink}
        onRetry={sessionState.diagnostics.reconnect}
        onConnectionDetails={() => (diagOpen = OPENED)}
      />
    </div>
  {/if}

  {#if introSlot.kind === IntroSlotKind.FirstVisit}
    <FirstVisitIntro
      transport={sessionState.diagnostics.transport}
      onShare={() => (shareOpen = OPENED)}
      onConnectStorage={connectStorageFromStorageIntro}
      onAbout={openAbout}
    />
  {:else if introSlot.kind === IntroSlotKind.Storage}
    <StorageIntro
      onConnectStorage={connectStorageFromStorageIntro}
      onDismiss={markStorageIntroSeen}
    />
  {/if}

  <!-- Self-dismissing; never steals focus (contract §4.1). -->
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
      {paletteOpen}
      onPaletteClose={() => (paletteOpen = CLOSED)}
      {paletteActions}
      {paletteRooms}
      {onPaletteCommand}
    />
  {/if}
</div>
{/if}

<ConnectionDialog
  open={diagOpen}
  onclose={() => (diagOpen = CLOSED)}
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
  onOpenConnectionSettings={openConnectionSettings}
/>

<Settings
  backends={storageBackends}
  bind:open={settingsOpen}
  focusId={settingsFocus}
  focusAdvanced={settingsAdvanced}
  {theme}
  {localCache}
  onCacheChange={setLocalCache}
  onCacheClear={clearLocalCopies}
  onAbout={openAbout}
  {turnPrefs}
  onTurnChange={saveTurnPrefs}
  languageChoice={language.choice}
  spellcheck={language.spellcheck}
  onLanguageChange={language.setChoice}
  onSpellcheckChange={language.setSpellcheck}
  exportBaseName={exportBaseName(roomName.value, room)}
  {toasts}
  onchange={bump}
  onconnect={afterConnect}
  ondisconnect={afterDisconnect}
  onimport={(bytes, filename) => (pendingImport = { bytes, filename })}
/>

<ShareDialog
  open={shareOpen}
  onclose={() => (shareOpen = CLOSED)}
  {room}
  {toasts}
  {transport}
  envPassword={envRoomPassword}
  saved={savedHere}
  storageLabel={savedHere ? storage?.storage.label : undefined}
/>

<MeetingJoinDialog open={joinOpen} onclose={() => (joinOpen = CLOSED)} {toasts} hallUrl={collabPlan.hallUrl} />

<LibraryDialog
  open={libraryOpen}
  onclose={() => (libraryOpen = CLOSED)}
  current={room}
  page={pagePath}
  onNew={() => { libraryOpen = CLOSED; newRoom(); }}
/>

<ExportDialog
  open={exportOpen}
  onclose={() => (exportOpen = CLOSED)}
  baseName={exportBaseName(roomName.value, room)}
  {toasts}
/>
<Toast {toasts} />

<style>
  .sync-banner-sheet-anchor {
    display: contents;
  }
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
