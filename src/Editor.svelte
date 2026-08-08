<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { EditorState } from 'prosemirror-state';
  import type { Transaction } from 'prosemirror-state';
  import { EditorView } from 'prosemirror-view';
  import { ySyncPlugin, ySyncPluginKey, yCursorPlugin, yUndoPlugin } from 'y-prosemirror';
  import { schema } from './editor/schema.js';
  import { buildPlugins, stripNestedTables } from './editor/plugins.js';
  import { slashMenuPlugin } from './editor/ui/slashMenu.js';
  import { placeholderPlugin } from './editor/ui/placeholder.js';
  import { lineBlockHintPlugin } from './editor/ui/lineBlockHint.js';
  import { keyboardInset, collapseKeyboardInset } from './ui/keyboardInset.svelte.js';
  import Toolbar from './Toolbar.svelte';
  import SelectionToolbar from './editor/ui/SelectionToolbar.svelte';
  import CaretFormatHint from './editor/ui/CaretFormatHint.svelte';
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
  } from './collaboration/types.js';
  import { ConnStatus, PresenceKind, SessionRole } from './collaboration/types.js';
  import type { RoomName, PersistTarget } from './collaboration/types.js';
  import { parsePeerAwarenessState, parseRoomName, parseRoomUrl } from './collaboration/parse.js';
  import { recentDocsStore } from './collaboration/recentDocs.js';
  import { nextPersistHealth, nextRegime, UNPROVEN, PersistRegime, type PersistHealth } from './collaboration/persistHealth.js';
  import { browserId } from './collaboration/browserId.js';
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
    setSessionPresence,
    setSessionRoomPresence,
    setSessionSoloBrowser,
    setSessionDiagnostics,
    setSessionEditing,
    setSessionJumpToPeer,
    resetSessionState,
  } from './collaboration/sessionState.svelte.js';

  type Props = {
    storage: Storage | null;
    name: DisplayName;
    color: CursorColor;
    room: RoomId;
    role?: SessionRole;
    connect: CollabConnect;
    toasts: Toasts;
    lang?: string;
    spellcheck?: boolean;
    /** When true the editor is read-only — the write gate (`writeGateFor()` in
     *  `App.svelte`) is holding. This component only reflects it. */
    writeLocked?: boolean;
    /** Stamped by `App.svelte` only on an explicit "Write alone anyway" click
     *  — never by `writeLocked` itself going false, which also happens when a
     *  peer joins or durability proves out. Drives the focus-on-unlock effect
     *  below; a natural unlock must never steal focus (contract §4.1). */
    writeSoloAt?: EpochMs | null;
    /** A file picked in App.svelte — its own header button, or Settings' Browse
     *  dialog — waiting to be decoded into this document. App owns every import
     *  entry point; this is their one hand-off into the live `collab.doc`. */
    importRequest?: { bytes: Uint8Array; filename: Filename } | null;
    /** Called once `importRequest` has been applied (success or failure), so the
     *  parent can clear it and this effect doesn't re-fire on the next render. */
    onImportHandled?: () => void;
  };

  let {
    storage, name, color, room, role = SessionRole.Writer, connect, toasts, lang = 'en', spellcheck = true,
    writeLocked = false, writeSoloAt = null, importRequest = null, onImportHandled,
  }: Props = $props();

  // Plain (non-reactive) tracking var — detects a new `writeSoloAt` stamp in
  // the effect below. untrack: intentionally read once (its value at mount),
  // not a live reactive binding.
  let lastWriteSoloAt = untrack(() => writeSoloAt);

  const SAVE_DEBOUNCE = 3_000 as Milliseconds;

  // Collab session — created once for the lifetime of this component.
  // untrack: both props are intentionally read once — `room` is fixed for the
  // tab's lifetime, and a `connect` change goes through the parent's
  // `rebuildCollab()` remount, not a reactive read here.
  const collab = untrack(() => connect)(untrack(() => room));
  const yFragment = collab.doc.getXmlFragment('prosemirror');

  // Idle tracking for remote cursors — fed into yCursorPlugin's builders below
  // so a peer who parked their cursor and stepped away fades instead of
  // cluttering the doc forever (SOTA: Figma fades after ~5 min idle).
  const presenceActivity = trackPresenceActivity(collab.awareness);
  const REMOTE_CURSOR_FADE_TICK = 15_000 as Milliseconds;
  let fadeTimer: ReturnType<typeof setInterval> | undefined;

  // Shared, editable room name. It lives in a dedicated Y.Map — NOT the
  // prosemirror fragment — so it syncs to every peer and rides along in the .yjs
  // format, yet never leaks into text/markdown/html/json exports (codecs only
  // read the fragment). DocTitle (rendered below) edits it through the
  // roomName bridge — same bridge App.svelte used to read/write when the
  // field lived in the header instead of the document.
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

  // Records this room into the recent-docs switcher on mount, then keeps its
  // title in step as roomName.value changes (local rename or a synced one).
  const recentDocs = recentDocsStore();
  $effect(() => {
    const url = parseRoomUrl(location.href);
    if (url) recentDocs.record({ room, url, title: roomName.value });
  });

  let editorEl = $state<HTMLDivElement | undefined>();
  // $state.raw: track reference changes for reactivity but don't proxy the
  // EditorView/EditorState objects themselves — ProseMirror objects are not
  // designed to be deeply proxied.
  let view = $state.raw<EditorView | null>(null);
  let editorState = $state.raw<EditorState | null>(null);
  let users = $state<PeerUser[]>([]);
  let peers = $state(1);
  let conn = $state<ConnStatus>(ConnStatus.Connecting);
  let roomPresence = $state<RoomPresence>({ kind: PresenceKind.Unknown });
  // True while every accompanying peer shares our own browserId — a second tab, not a stranger.
  let soloBrowser = $state(false);
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

  // Whether this peer can write to its own storage backend for this file.
  // Updated asynchronously when the storage prop changes (backends with access()
  // may need a round-trip; backends without it resolve synchronously).
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
  // Parse each raw awareness entry from peers at the IO boundary.
  const parsedStates = (): ReadonlyMap<number, PeerAwarenessState> => {
    const result = new Map<number, PeerAwarenessState>();
    collab.awareness.getStates().forEach((raw, id) => {
      result.set(id, parsePeerAwarenessState(raw));
    });
    return result;
  };

  const readUsers = (): PeerUser[] => {
    const states = parsedStates();
    const selfId = collab.doc.clientID;
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

  const readSoloBrowser = (): boolean => {
    const states = parsedStates();
    const selfId = collab.doc.clientID;
    const mine = browserId();
    let sawOther = false;
    for (const [id, state] of states) {
      if (id === selfId) continue;
      sawOther = true;
      if (state.browserId !== mine) return false;
    }
    return sawOther;
  };

  const refreshPresence = (): void => {
    peers = collab.awareness.getStates().size || 1;
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
  // Connection/presence/save status are derived here from `collab` but rendered
  // in App's header (outside this component). Diagnostics are fixed for the
  // session; the rest are mirrored reactively as they change.
  setSessionDiagnostics({
    transport: collab.transport,
    getDiagnostics: collab.getDiagnostics ? () => collab.getDiagnostics!() : undefined,
    reconnect: collab.reconnect,
  });
  // Reads `view`/`users` live at call time, so it's safe to publish once here
  // even though `view` itself isn't assigned until onMount below. The peer's
  // own colour drives the flash ring so it reads as "them", not a generic cue.
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

  // Mobile-only signal (see the M3 layout in App.svelte / editor.css): whether
  // the document currently has focus, so the header can swap its bottom dock
  // between navigation actions and the formatting toolbar. Desktop ignores
  // this — its formatting toolbar is the floating selection bubble instead.
  // Tapping a toolbar button would otherwise blur the content *before* the
  // click lands (contentEditable loses focus on pointerdown), hiding the
  // dock out from under the tap; Toolbar.svelte guards against that by
  // preventing default on its own pointerdown.
  $effect(() => {
    const el = editorEl;
    if (!el) return;
    const onFocusIn = () => setSessionEditing(true);
    const onFocusOut = () => {
      setSessionEditing(false);
      // Don't wait on visualViewport's own (often-delayed) resize event to
      // learn the keyboard is closing — see collapseKeyboardInset's doc.
      collapseKeyboardInset();
    };
    el.addEventListener('focusin', onFocusIn);
    el.addEventListener('focusout', onFocusOut);
    return () => {
      el.removeEventListener('focusin', onFocusIn);
      el.removeEventListener('focusout', onFocusOut);
    };
  });

  // Broadcast full typed awareness state whenever any field changes.
  $effect(() => {
    const target = myPersistTarget();
    const state: PeerAwarenessState = {
      user: { name, color },
      role,
      canPersist,
      browserId: browserId(),
      ...(target ? { persistTarget: target } : {}),
    };
    collab.awareness.setLocalState(state);
  });

  // Load from storage when adapter becomes available (or changes to a different backend).
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
        // A Denied load() falsifies write-access too — usable before the first keystroke.
        const kind = parseWriteFailure(e);
        if (kind === WriteFailureKind.Denied) {
          persistHealth = nextPersistHealth(persistHealth, { ok: false, kind }, now());
        }
      });
  });

  // Import of an arbitrary file into the current document — no backend
  // involved for this write itself. App.svelte owns every entry point (its
  // own header button, Settings' Browse-a-connected-backend dialog) and
  // hands the picked bytes down via `importRequest`; this is only where the
  // decode actually happens, since `collab.doc` lives here. `codec.decode`
  // writes straight into it via `writePmDoc`/`prosemirrorToYXmlFragment`
  // rather than a ProseMirror transaction, so it bypasses `view.editable`
  // entirely — the write-gate has to be re-checked here explicitly.
  const canImport = $derived(role === SessionRole.Writer && !writeLocked);

  async function applyImport(bytes: Uint8Array, filename: Filename): Promise<void> {
    const ext = extensionOf(filename);
    if (!knownExtensions().includes(ext)) {
      toasts.error(`Unsupported file type${ext ? ` "${ext}"` : ''} — try .yjs, .md, .txt, .html, or .json`);
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

  // A file picked in App.svelte (its header button or Settings' Browse
  // dialog — see `importRequest` prop above) arrives here once per distinct
  // request; `onImportHandled` lets the parent clear it so this effect
  // doesn't re-fire on the next unrelated render. Settings has no write-gate
  // awareness of its own (it's rendered regardless of role), so a request
  // can arrive here from a reader even though App's own header button stays
  // disabled for one — always resolve it (never leave it dangling for a
  // later gate change to silently pick up) and say why nothing happened.
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

  // Leader = the lowest-clientID persister *writing the same file* (same target).
  // Scoping by target lets two owners on different backends (or different accounts
  // of one backend) each persist their own copy, while still electing a single
  // writer among peers sharing one file — and a peer without storage access (e.g.
  // a SharePoint guest) still has their edits relayed and persisted by a saver.
  const isLeader = (): boolean =>
    isPersistLeader(collab.doc.clientID, myPersistTarget(), parsedStates());

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
        // A repeat failure is already carried by StatusPill's durable state; toast only the transition into it.
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

  // Apply lang + spellcheck via ProseMirror's attributes EditorProp so they
  // survive ProseMirror re-renders (direct DOM manipulation would be patched
  // away by PM's decoration diffing on each state update).
  $effect(() => {
    if (!view) return;
    // setProps({ attributes }) replaces the whole attributes object, so every
    // static attribute (not just lang/spellcheck) has to be repeated here.
    view.setProps({
      attributes: { lang, spellcheck: spellcheck ? 'true' : 'false', 'aria-label': 'Document editor' },
    });
  });

  // Toggle editability when the write-gate opens/closes. ProseMirror re-reads the
  // `editable` prop on each state update, so re-setting it (setProps triggers one)
  // is what actually flips contentEditable — the gate lifts the moment a peer joins.
  $effect(() => {
    const locked = writeLocked;
    if (view) view.setProps({ editable: () => role === SessionRole.Writer && !locked });
  });

  // Focuses the view on an explicit "Write alone anyway" click — the
  // yield-on-write listener below already covers typing/clicking *in* the
  // editor, but that button lifts the gate from outside it, leaving the next
  // keystroke to go nowhere. Keyed off `writeSoloAt`, not `writeLocked`
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
      // Set lang and spellcheck from the start so the browser picks up the
      // correct dictionary before the first $effect fires.
      attributes: {
        lang: untrack(() => lang),
        spellcheck: untrack(() => spellcheck) ? 'true' : 'false',
        'aria-label': 'Document editor',
      },
      // role is URL-derived and fixed for the session; untrack avoids a
      // reactive dependency inside ProseMirror's render cycle. The write-gate's
      // reactive updates go through the $effect above; this is just the seed value.
      editable: () => untrack(() => role) === SessionRole.Writer && !untrack(() => writeLocked),
      // Pasted HTML can carry a table nested inside a cell (via an
      // intermediate blockquote/list, which the schema legitimately allows
      // everywhere else) straight past the schema's own paste parser — see
      // stripNestedTables. Local-only; never touches a synced transaction.
      transformPasted: (slice) => stripNestedTables(slice, schema),
      // ProseMirror calls dispatchTransaction with the EditorView as `this`,
      // so we use `this` here instead of closing over the outer `view` variable.
      // Closing over `view` would fail on the first call because ProseMirror
      // invokes dispatchTransaction during construction before `view` is assigned.
      dispatchTransaction(tr: Transaction) {
        const self = this as unknown as EditorView;
        const next = self.state.apply(tr);
        self.updateState(next);
        editorState = next;
        const isChangeOrigin = !!tr.getMeta(ySyncPluginKey)?.isChangeOrigin;
        regime = nextRegime(regime, { docChanged: tr.docChanged, isChangeOrigin });
        if (tr.docChanged && !isChangeOrigin) setSessionLocalEdit(now());
      },
    });

    editorState = state;

    // Remote cursors fade continuously with idle time, but y-prosemirror keys
    // its cursor widget by clientId and reuses the existing DOM node across
    // decoration recomputes rather than rebuilding it — so periodically
    // forcing a recompute wouldn't re-run remoteCursorBuilder for an
    // otherwise-untouched peer. Mutate the already-rendered elements directly.
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
  <!-- Fixed bar: hidden on desktop (see editor.css), where the SelectionToolbar
       bubble takes over. On mobile it's the "format mode" of the bottom dock —
       occupying the same fixed slot as App.svelte's nav-mode dock, shown only
       while the document has focus (see setSessionEditing above) so it never
       costs vertical space at rest and always sits right above the keyboard. -->
  <div
    class="fixed-toolbar"
    class:editing={sessionState.editing}
    style="--kb-inset: {keyboardInset.px}px"
  >
    <Toolbar {view} {editorState} {toasts} />
  </div>
  <!-- DocTitle renders inside `.content` (not as a sibling) so it scrolls away
       with the rest of the document instead of costing permanent chrome —
       ProseMirror's EditorView only ever appendChild()s its own dom onto this
       node on mount (never clears it), so it's safe to give it existing
       children. Order matters: DocTitle must already be in the DOM before
       `new EditorView(editorEl!, …)` runs in onMount below, so its dom lands
       after (visually below) this, not before. -->
  <div class="content" bind:this={editorEl}>
    <DocTitle {room} name={roomName.value} onRename={(raw) => renameRoom(parseRoomName(raw))} />
  </div>
  <div class="status">
    <ShortcutBar {editorState} />
    <span class="spacer"></span>
    <WordCount {editorState} />
    <Outline {view} {editorState} />
  </div>
  <SelectionToolbar {view} {editorState} {toasts} />
  <CaretFormatHint {view} {editorState} />
  <SlashMenu {view} {editorState} />
  <LinkPopover {view} {editorState} />
</main>
