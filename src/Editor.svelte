<script lang="ts">
  import type { SpellcheckEnabled, ResolvedLanguage } from './ui/types.js';
  import { onMount, onDestroy, untrack } from 'svelte';
  import { EditorState } from 'prosemirror-state';
  import type { Transaction } from 'prosemirror-state';
  import { EditorView } from 'prosemirror-view';
  import { ySyncPlugin, ySyncPluginKey, yCursorPlugin, yUndoPlugin } from 'y-prosemirror';
  import { schema } from './editor/schema.js';
  import { buildPlugins, stripNestedTables } from './editor/plugins.js';
  import { slashMenuPlugin } from './editor/ui/slashMenu.js';
  import { placeholderPlugin, isSoleEmptyBlock } from './editor/ui/placeholder.js';
  import { lineBlockHintPlugin } from './editor/ui/lineBlockHint.js';
  import { keyboardInset, collapseKeyboardInset } from './ui/keyboardInset.svelte.js';
  import Toolbar from './Toolbar.svelte';
  import SelectionToolbar from './editor/ui/SelectionToolbar.svelte';
  import { codecForFilename, extensionOf, knownExtensions } from './format/index.js';
  import SlashMenu from './editor/ui/SlashMenu.svelte';
  import LinkPopover from './editor/ui/LinkPopover.svelte';
  import WordCount from './editor/ui/WordCount.svelte';
  import Outline from './editor/ui/Outline.svelte';
  import ShortcutBar from './editor/ui/ShortcutBar.svelte';
  import type { PeerUser } from './ui/types.js';
  import { SaveStatus } from './ui/types.js';
  import type { Toasts } from './ui/toasts.svelte.js';
  import type { Storage, DocContent, Filename, StorageId } from './storage/types.js';
  import { StorageAccess, DocFormat, docContentBytes } from './storage/types.js';
  import { WriteFailureKind } from './storage/writeOutcome.js';
  import { parseWriteFailure } from './storage/parse.js';
  import type {
    CollabConnect,
    RoomId,
    DisplayName,
    CursorColor,
    PeerAwarenessState,
    RoomPresence,
    ClientId,
  } from './collaboration/types.js';
  import { ConnStatus, PresenceKind, SessionRole } from './collaboration/types.js';
  import type { RoomName, PersistTarget } from './collaboration/types.js';
  import { parsePeerAwarenessState, parseRoomName, parseClientId } from './collaboration/parse.js';
  import { nextPersistHealth, nextRegime, UNPROVEN, PersistRegime, type PersistHealth } from './collaboration/persistHealth.js';
  import { browserId } from './collaboration/browserId.js';
  import type { SelfProbeMarker } from './collaboration/selfProbeMarker.js';
  import { persistTargetKey, isPersistLeader } from './collaboration/leader.js';
  import { trackPresenceActivity } from './collaboration/presenceActivity.js';
  import { remoteCursorBuilder, remoteSelectionBuilder, refreshPresenceFade, jumpToPresence } from './editor/ui/remoteCursors.js';
  import { roomName, renameRoom, bindRoomName, unbindRoomName, setRoomNameLocal } from './collaboration/roomName.svelte.js';
  import { bindExport, unbindExport } from './editor/exportBridge.svelte.js';
  import DocTitle from './editor/ui/DocTitle.svelte';
  import { now, type Milliseconds, type EpochMs } from './time.js';
  import {
    sessionState,
    setSessionConn,
    setSessionSave,
    setSessionPersistHealth,
    setSessionRegime,
    setSessionLocalEdit,
    setSessionDocEmpty,
    setSessionPresence,
    setSessionRoomPresence,
    setSessionSoloBrowser,
    setSessionDiagnostics,
    setSessionEditing,
    setSessionJumpToPeer,
    resetSessionState,
    type SoloBrowser,
    type DocEmpty,
    type EditorFocused,
    type PeerCount,
  } from './collaboration/sessionState.svelte.js';

  type Props = {
    storage: Storage | null;
    name: DisplayName;
    color: CursorColor;
    room: RoomId;
    role?: SessionRole;
    /** Set only on a tab `MeetingJoinDialog` just opened, so its presence
     *  probe can recognize and discard this tab's own self-join. */
    selfProbeMarker?: SelfProbeMarker | null;
    connect: CollabConnect;
    toasts: Toasts;
    lang?: ResolvedLanguage;
    spellcheck?: SpellcheckEnabled;
    /** When true the editor is read-only: the write gate (`writeGateFor()` in
     *  `App.svelte`) is holding. This component only reflects it. */
    writeLocked?: boolean;
    /** Stamped by `App.svelte` only on an explicit "Write alone anyway" click,
     *  never by `writeLocked` itself going false, which also happens when a
     *  peer joins or durability proves out. Drives the focus-on-unlock effect
     *  below; a natural unlock must never steal focus (contract §4.1). */
    writeSoloAt?: EpochMs | null;
    /** A file picked in App.svelte (its own header button, or Settings' Browse
     *  dialog), waiting to be decoded into this document. App owns every import
     *  entry point; this is their one hand-off into the live `collab.doc`. */
    importRequest?: { bytes: Uint8Array; filename: Filename } | null;
    /** Called once `importRequest` has been applied (success or failure), so the
     *  parent can clear it and this effect doesn't re-fire on the next render. */
    onImportHandled?: () => void;
    /** Set by App.svelte's one-shot `?new=1` marker for a freshly opened tab. */
    autofocusTitle?: boolean;
  };

  let {
    storage, name, color, room, role = SessionRole.Writer, selfProbeMarker = null, connect, toasts,
    lang = 'en' as ResolvedLanguage, spellcheck = true as SpellcheckEnabled,
    writeLocked = false, writeSoloAt = null, importRequest = null, onImportHandled, autofocusTitle = false,
  }: Props = $props();

  let lastWriteSoloAt = untrack(() => writeSoloAt);

  const SAVE_DEBOUNCE = 3_000 as Milliseconds;

  // untrack: `room` is fixed for the tab's lifetime, and a `connect` change goes
  // through the parent's `rebuildCollab()` remount, not a reactive read here.
  const collab = untrack(() => connect)(untrack(() => room));
  const yFragment = collab.doc.getXmlFragment('prosemirror');

  const presenceActivity = trackPresenceActivity(collab.awareness);
  const REMOTE_CURSOR_FADE_TICK = 15_000 as Milliseconds;
  let fadeTimer: ReturnType<typeof setInterval> | undefined;

  // A dedicated Y.Map, not the prosemirror fragment, so it never leaks into
  // text/markdown/html/json exports (codecs only read the fragment).
  const roomMeta = collab.doc.getMap('roomMeta');
  const readRoomName = (): RoomName | null =>
    parseRoomName(typeof roomMeta.get('name') === 'string' ? (roomMeta.get('name') as string) : null);
  bindRoomName(readRoomName(), (n) => {
    if (n) roomMeta.set('name', n);
    else roomMeta.delete('name');
  });
  const onRoomMeta = (): void => setRoomNameLocal(readRoomName());
  roomMeta.observe(onRoomMeta);

  bindExport((codec) => Promise.resolve(codec.encode(collab.doc)));

  let editorEl = $state<HTMLDivElement | undefined>();
  let view = $state.raw<EditorView | null>(null);
  let editorState = $state.raw<EditorState | null>(null);
  let users = $state<PeerUser[]>([]);
  let peers = $state<PeerCount>(1 as PeerCount);
  let conn = $state<ConnStatus>(ConnStatus.Connecting);
  let roomPresence = $state<RoomPresence>({ kind: PresenceKind.Unknown });
  let soloBrowser = $state<SoloBrowser>(false as SoloBrowser);
  let saveStatus = $state<SaveStatus>(SaveStatus.Idle);
  // Branch (b)'s state machine (docs/contract.md §3.2/§3.3, persistHealth.ts).
  let persistHealth = $state<PersistHealth>(UNPROVEN);
  let regime = $state<PersistRegime>(PersistRegime.Cold);
  let loadedFrom = $state<StorageId | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let savedTimer: ReturnType<typeof setTimeout> | undefined;
  // Otherwise a failure on the session's last keystroke is never retried.
  const RETRY_BACKOFF_MS = [3_000, 6_000, 12_000, 30_000] as Milliseconds[];
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryAttempt = 0;

  let canPersist = $state(false);

  $effect(() => {
    const s = storage;
    if (!s) {
      canPersist = false;
      return;
    }
    if (!s.access) {
      canPersist = true;
      return;
    }
    s.access().then((a: StorageAccess) => {
      canPersist = a !== StorageAccess.Read;
    });
  });

  // ── Presence (derived from awareness) ──────────────────────────────────────
  const parsedStates = (): ReadonlyMap<ClientId, PeerAwarenessState> => {
    const result = new Map<ClientId, PeerAwarenessState>();
    collab.awareness.getStates().forEach((raw, id) => {
      result.set(parseClientId(id), parsePeerAwarenessState(raw));
    });
    return result;
  };

  const readUsers = (): PeerUser[] => {
    const states = parsedStates();
    const selfId = parseClientId(collab.doc.clientID);
    const list: PeerUser[] = [];
    states.forEach((state, id) => {
      list.push({
        id,
        name: state.user.name,
        color: state.user.color,
        self: id === selfId,
      });
    });
    // Self first, then others by join order.
    list.sort((a, b) => (a.self ? -1 : b.self ? 1 : a.id - b.id));
    return list;
  };

  const readSoloBrowser = (): SoloBrowser => {
    const states = parsedStates();
    const selfId = parseClientId(collab.doc.clientID);
    const mine = browserId();
    let sawOther = false;
    for (const [id, state] of states) {
      if (id === selfId) continue;
      sawOther = true;
      if (state.browserId !== mine) return false as SoloBrowser;
    }
    return sawOther as SoloBrowser;
  };

  const refreshPresence = (): void => {
    peers = (collab.awareness.getStates().size || 1) as PeerCount;
    users = readUsers();
    soloBrowser = readSoloBrowser();
  };
  collab.awareness.on('change', refreshPresence);
  refreshPresence();

  // ── Connection status ───────────────────────────────────────────────────────
  const offStatus = collab.onStatus((s) => {
    conn = s;
  });
  const offPresence = collab.onPresence?.((p) => {
    roomPresence = p;
  });

  // ── Push session state to the header bridge ─────────────────────────────────
  setSessionDiagnostics({
    transport: collab.transport,
    getDiagnostics: collab.getDiagnostics ? () => collab.getDiagnostics!() : undefined,
    reconnect: collab.reconnect,
  });
  // Reads `view`/`users` live at call time, so publishing here is safe even
  // though `view` isn't assigned until onMount below.
  setSessionJumpToPeer((clientId) => {
    if (!view) return;
    jumpToPresence(view.dom, clientId, users.find((u) => u.id === clientId)?.color);
  });
  $effect(() => setSessionConn(conn));
  $effect(() => setSessionSave(saveStatus));
  $effect(() => setSessionPersistHealth(persistHealth));
  $effect(() => setSessionRegime(regime));
  $effect(() => setSessionPresence(users, peers));
  $effect(() => setSessionRoomPresence(roomPresence));
  $effect(() => setSessionSoloBrowser(soloBrowser));

  // Mobile-only: swaps the bottom dock between nav actions and the formatting
  // toolbar. contentEditable loses focus on pointerdown before a tap lands, so
  // Toolbar.svelte guards against that by preventing default on its own pointerdown.
  $effect(() => {
    const el = editorEl;
    if (!el) return;
    const onFocusIn = () => setSessionEditing(true as EditorFocused);
    const onFocusOut = () => {
      setSessionEditing(false as EditorFocused);
      collapseKeyboardInset();
    };
    el.addEventListener('focusin', onFocusIn);
    el.addEventListener('focusout', onFocusOut);
    return () => {
      el.removeEventListener('focusin', onFocusIn);
      el.removeEventListener('focusout', onFocusOut);
    };
  });

  $effect(() => {
    const target = myPersistTarget();
    const state: PeerAwarenessState = {
      user: { name, color },
      role,
      canPersist,
      browserId: browserId(),
      ...(target ? { persistTarget: target } : {}),
      ...(selfProbeMarker ? { selfProbeMarker } : {}),
    };
    collab.awareness.setLocalState(state);
  });

  $effect(() => {
    if (!storage || !view || loadedFrom === storage.id) return;
    const id = storage.id;
    const codec = codecForFilename(storage.filename?.() ?? 'document.yjs');
    const label = storage.label;
    storage
      .load()
      .then(async (content: DocContent | null) => {
        if (content) {
          await codec.decode(docContentBytes(content), collab.doc);
        }
        loadedFrom = id;
      })
      .catch((e: unknown) => {
        console.warn('Copad: load failed, starting with current state', e);
        toasts.error(`Couldn't load from ${label}: ${(e as Error).message}`);
        // A Denied load() falsifies write-access too, usable before the first keystroke.
        const kind = parseWriteFailure(e);
        if (kind === WriteFailureKind.Denied) {
          persistHealth = nextPersistHealth(persistHealth, { ok: false, kind }, now());
        }
      });
  });

  // `codec.decode` writes straight into `collab.doc`, bypassing `view.editable`
  // entirely: the write-gate has to be re-checked here explicitly.
  const canImport = $derived(role === SessionRole.Writer && !writeLocked);

  async function applyImport(bytes: Uint8Array, filename: Filename): Promise<void> {
    const ext = extensionOf(filename);
    if (!knownExtensions().includes(ext)) {
      toasts.error(`Unsupported file type${ext ? ` "${ext}"` : ''}, try .yjs, .md, .txt, .html, or .json`);
      return;
    }
    if (
      yFragment.length > 0 &&
      !window.confirm(`Replace the current document with "${filename}"? This can't be undone for collaborators.`)
    ) {
      return;
    }
    try {
      await codecForFilename(filename).decode(bytes, collab.doc);
      toasts.success(`Imported ${filename}`);
    } catch (e) {
      toasts.error(`Couldn't import ${filename}: ${(e as Error).message}`);
    }
  }

  // Settings has no write-gate awareness of its own, so a request can arrive here
  // from a reader: always resolve it rather than leaving it dangling.
  $effect(() => {
    const req = importRequest;
    if (!req) return;
    if (!canImport) {
      toasts.error('You need write access to import a file.');
      onImportHandled?.();
      return;
    }
    applyImport(req.bytes, req.filename).finally(() => onImportHandled?.());
  });

  // The file this peer would persist to, as a target key (hashed backend +
  // filename + browser install id). Absent when this peer isn't persisting.
  const DEFAULT_TARGET_FILE = 'document.yjs' as Filename;
  const myPersistTarget = (): PersistTarget | undefined =>
    storage && canPersist
      ? persistTargetKey(browserId(), storage.id, storage.filename?.() ?? DEFAULT_TARGET_FILE)
      : undefined;

  // Leader election is scoped by target so two owners on different backends each
  // persist their own copy, while peers sharing one file elect a single writer.
  const isLeader = (): boolean =>
    isPersistLeader(parseClientId(collab.doc.clientID), myPersistTarget(), parsedStates());

  const flush = (): void => {
    const s = storage;
    if (!s || !isLeader()) return;
    clearTimeout(retryTimer);
    const codec = codecForFilename(s.filename?.() ?? 'document.yjs');
    const label = s.label;
    saveStatus = SaveStatus.Saving;
    Promise.resolve(codec.encode(collab.doc))
      .then((bytes) => {
        const content: DocContent = s.contentFormat === DocFormat.Text
          ? { format: DocFormat.Text, text: new TextDecoder().decode(bytes) }
          : { format: DocFormat.Binary, bytes };
        return s.save(content);
      })
      .then((receipt) => {
        retryAttempt = 0;
        persistHealth = nextPersistHealth(persistHealth, { ok: true, receipt }, now());
        saveStatus = SaveStatus.Saved;
        clearTimeout(savedTimer);
        savedTimer = setTimeout(() => {
          if (saveStatus === SaveStatus.Saved) saveStatus = SaveStatus.Idle;
        }, 2_500);
      })
      .catch((e: unknown) => {
        // Toast only the transition into failure, not every repeat.
        const wasAlreadyFailing = saveStatus === SaveStatus.Error;
        saveStatus = SaveStatus.Error;
        persistHealth = nextPersistHealth(persistHealth, { ok: false, kind: parseWriteFailure(e) }, now());
        console.warn('Copad: autosave failed', e);
        if (!wasAlreadyFailing) toasts.error(`Couldn't save to ${label}: ${(e as Error).message}`);
        const backoff = RETRY_BACKOFF_MS[Math.min(retryAttempt, RETRY_BACKOFF_MS.length - 1)];
        retryAttempt++;
        retryTimer = setTimeout(flush, backoff);
      });
  };

  collab.doc.on('update', () => {
    if (!storage) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DEBOUNCE);
  });

  window.addEventListener('beforeunload', flush);

  // setProps({ attributes }) replaces the whole object; direct DOM manipulation
  // would be patched away by ProseMirror's decoration diffing.
  $effect(() => {
    if (!view) return;
    view.setProps({
      attributes: { lang, spellcheck: spellcheck ? 'true' : 'false', 'aria-label': 'Document editor' },
    });
  });

  $effect(() => {
    const locked = writeLocked;
    if (view) view.setProps({ editable: () => role === SessionRole.Writer && !locked });
  });

  // Focuses the view on an explicit "Write alone anyway" click, which lifts the
  // gate from outside the editor. Keyed off `writeSoloAt`, not `writeLocked`
  // itself, so a peer joining (a natural unlock) never steals focus.
  $effect(() => {
    if (writeSoloAt !== null && writeSoloAt !== lastWriteSoloAt) view?.focus();
    lastWriteSoloAt = writeSoloAt;
  });

  onMount(() => {
    const state = EditorState.create({
      schema,
      plugins: [
        ySyncPlugin(yFragment),
        yCursorPlugin(collab.awareness, {
          cursorBuilder: remoteCursorBuilder(presenceActivity),
          selectionBuilder: remoteSelectionBuilder(presenceActivity),
        }),
        yUndoPlugin(),
        slashMenuPlugin(),
        placeholderPlugin('Write something, or press “/” for commands…'),
        lineBlockHintPlugin(),
        ...buildPlugins(schema),
      ],
    });

    view = new EditorView(editorEl!, {
      state,
      attributes: {
        lang: untrack(() => lang),
        spellcheck: untrack(() => spellcheck) ? 'true' : 'false',
        'aria-label': 'Document editor',
      },
      // Seed value only: the write-gate's reactive updates go through the $effect above.
      editable: () => untrack(() => role) === SessionRole.Writer && !untrack(() => writeLocked),
      // A table can be nested inside a cell via an intermediate blockquote/list on
      // paste, past the schema's own paste parser; see stripNestedTables.
      transformPasted: (slice) => stripNestedTables(slice, schema),
      // ProseMirror calls dispatchTransaction with the view as `this`; closing over
      // the outer `view` would fail on the first call, before it's assigned.
      dispatchTransaction(tr: Transaction) {
        const self = this as unknown as EditorView;
        const next = self.state.apply(tr);
        self.updateState(next);
        editorState = next;
        const isChangeOrigin = !!tr.getMeta(ySyncPluginKey)?.isChangeOrigin;
        regime = nextRegime(regime, { docChanged: tr.docChanged, isChangeOrigin });
        if (tr.docChanged && !isChangeOrigin) setSessionLocalEdit(now());
        if (tr.docChanged) setSessionDocEmpty(isSoleEmptyBlock(next.doc) as DocEmpty);
      },
    });

    editorState = state;
    setSessionDocEmpty(isSoleEmptyBlock(state.doc) as DocEmpty);

    // y-prosemirror reuses each cursor's existing DOM node across decoration
    // recomputes, so a forced recompute wouldn't re-run remoteCursorBuilder;
    // mutate the already-rendered elements directly instead.
    fadeTimer = setInterval(() => {
      if (view) refreshPresenceFade(view.dom, presenceActivity);
    }, REMOTE_CURSOR_FADE_TICK);
  });

  onDestroy(() => {
    clearTimeout(saveTimer);
    clearTimeout(savedTimer);
    clearTimeout(retryTimer);
    clearInterval(fadeTimer);
    presenceActivity.destroy();
    offStatus();
    offPresence?.();
    roomMeta.unobserve(onRoomMeta);
    unbindRoomName();
    unbindExport();
    resetSessionState();
    window.removeEventListener('beforeunload', flush);
    view?.destroy();
    collab.destroy();
  });
</script>

<main class="editor" aria-label="Document">
  <!-- Hidden on desktop (see editor.css); on mobile this is the dock's "format mode". -->
  <div
    class="fixed-toolbar"
    class:editing={sessionState.editing}
    style="--kb-inset: {keyboardInset.px}px"
  >
    <Toolbar {view} {editorState} {toasts} />
  </div>
  <!-- DocTitle must already be in the DOM before `new EditorView(editorEl!, …)`
       runs in onMount: it only ever appendChild()s, never clears the node. -->
  <div class="content" bind:this={editorEl}>
    <DocTitle {room} name={roomName.value} onRename={(raw) => renameRoom(parseRoomName(raw))} autofocus={autofocusTitle} />
  </div>
  <div class="status">
    <ShortcutBar {editorState} />
    <span class="spacer"></span>
    <WordCount {editorState} />
    <Outline {view} {editorState} />
  </div>
  <SelectionToolbar {view} {editorState} {toasts} />
  <SlashMenu {view} {editorState} />
  <LinkPopover {view} {editorState} />
</main>
