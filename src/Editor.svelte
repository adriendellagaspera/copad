<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { EditorState } from 'prosemirror-state';
  import type { Transaction } from 'prosemirror-state';
  import { EditorView } from 'prosemirror-view';
  import { ySyncPlugin, yCursorPlugin, yUndoPlugin } from 'y-prosemirror';
  import { schema } from './editor/schema.js';
  import { buildPlugins } from './editor/plugins.js';
  import { slashMenuPlugin } from './editor/ui/slashMenu.js';
  import { placeholderPlugin } from './editor/ui/placeholder.js';
  import { lineBlockHintPlugin } from './editor/ui/lineBlockHint.js';
  import { keyboardInset, collapseKeyboardInset } from './ui/keyboardInset.svelte.js';
  import Toolbar from './Toolbar.svelte';
  import SelectionToolbar from './editor/ui/SelectionToolbar.svelte';
  import CaretFormatHint from './editor/ui/CaretFormatHint.svelte';
  import { codecForFilename } from './format/index.js';
  import SlashMenu from './editor/ui/SlashMenu.svelte';
  import LinkPopover from './editor/ui/LinkPopover.svelte';
  import WordCount from './editor/ui/WordCount.svelte';
  import Outline from './editor/ui/Outline.svelte';
  import ShortcutBar from './editor/ui/ShortcutBar.svelte';
  import type { PeerUser } from './ui/types.js';
  import { SaveStatus } from './ui/types.js';
  import type { Toasts } from './ui/toasts.svelte.js';
  import type { Storage, DocContent, Filename } from './storage/types.js';
  import { StorageAccess, DocFormat } from './storage/types.js';
  import type {
    CollabConnect,
    RoomId,
    DisplayName,
    CursorColor,
    PeerAwarenessState,
  } from './collaboration/types.js';
  import { ConnStatus, SessionRole } from './collaboration/types.js';
  import type { RoomName, PersistTarget } from './collaboration/types.js';
  import { parsePeerAwarenessState, parseRoomName } from './collaboration/parse.js';
  import { browserId } from './collaboration/browserId.js';
  import { persistTargetKey, isPersistLeader } from './collaboration/leader.js';
  import { trackPresenceActivity } from './collaboration/presenceActivity.js';
  import { remoteCursorBuilder, remoteSelectionBuilder, refreshPresenceFade, jumpToPresence } from './editor/ui/remoteCursors.js';
  import { roomName, renameRoom, bindRoomName, unbindRoomName, setRoomNameLocal } from './collaboration/roomName.svelte.js';
  import DocTitle from './editor/ui/DocTitle.svelte';
  import {
    sessionState,
    setSessionConn,
    setSessionSave,
    setSessionPresence,
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
    /** When true the editor is read-only, regardless of role — the write-gate holds
     *  back solo writing in a peer-to-peer, live-only room until someone joins. */
    writeLocked?: boolean;
    /** True while the room *could* be gated (P2P + live-only + no peer, not yet opted
     *  solo) — a superset of `writeLocked` that's also true during the pre-arm grace
     *  window. While it holds, the first writing gesture opts you into solo, so the
     *  gate never arms mid-typing and a click/keystroke never gets stranded. */
    writeGateEligible?: boolean;
    /** Called when the user makes the writing gesture (clicks or types in the body)
     *  while the gate could apply: that IS opting to write solo, so the gate yields
     *  there and then — no trip to a button. No-op otherwise. */
    onWriteSolo?: () => void;
  };

  let { storage, name, color, room, role = SessionRole.Writer, connect, toasts, lang = 'en', spellcheck = true, writeLocked = false, writeGateEligible = false, onWriteSolo }: Props =
    $props();

  const SAVE_DEBOUNCE = 3_000;

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
  const REMOTE_CURSOR_FADE_TICK = 15_000;
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

  let editorEl = $state<HTMLDivElement | undefined>();
  // $state.raw: track reference changes for reactivity but don't proxy the
  // EditorView/EditorState objects themselves — ProseMirror objects are not
  // designed to be deeply proxied.
  let view = $state.raw<EditorView | null>(null);
  let editorState = $state.raw<EditorState | null>(null);
  let users = $state<PeerUser[]>([]);
  let peers = $state(1);
  let conn = $state<ConnStatus>(ConnStatus.Connecting);
  let saveStatus = $state<SaveStatus>(SaveStatus.Idle);
  let loadedFrom = $state<string | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let savedTimer: ReturnType<typeof setTimeout> | undefined;

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

  const refreshPresence = (): void => {
    peers = collab.awareness.getStates().size || 1;
    users = readUsers();
  };
  collab.awareness.on('change', refreshPresence);
  refreshPresence();

  // ── Connection status ───────────────────────────────────────────────────────
  const offStatus = collab.onStatus((s) => {
    conn = s;
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
  $effect(() => setSessionPresence(users, peers));

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
          const bytes = content.format === DocFormat.Binary
            ? content.bytes
            : new TextEncoder().encode(content.text);
          await codec.decode(bytes, collab.doc);
        }
        loadedFrom = id;
      })
      .catch((e: unknown) => {
        console.warn('Copad: load failed, starting with current state', e);
        toasts.error(`Couldn't load from ${label}: ${(e as Error).message}`);
      });
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
      .then(() => {
        saveStatus = SaveStatus.Saved;
        clearTimeout(savedTimer);
        savedTimer = setTimeout(() => {
          if (saveStatus === SaveStatus.Saved) saveStatus = SaveStatus.Idle;
        }, 2_500);
      })
      .catch((e: Error) => {
        saveStatus = SaveStatus.Error;
        console.warn('Copad: autosave failed', e);
        toasts.error(`Couldn't save to ${label}: ${e.message}`);
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

  // Yield-on-write: the writing gesture itself — clicking or typing in the body —
  // is what opts you into writing solo, so the gate lifts under your cursor instead
  // of forcing a trip to a button. Listeners are attached whenever the gate is
  // *eligible* (not only once armed), so writing during the pre-arm grace window
  // opts you in too and the gate never arms mid-typing. When the gate is already
  // armed (editor read-only) we also flip the view editable *synchronously* so the
  // very click that lifted it still lands a caret; the $effect above reconciles.
  $effect(() => {
    const el = editorEl;
    if (!writeGateEligible || !el || !onWriteSolo) return;
    const yieldToWrite = (): void => {
      onWriteSolo?.();
      view?.setProps({ editable: () => role === SessionRole.Writer });
    };
    el.addEventListener('pointerdown', yieldToWrite, { capture: true });
    el.addEventListener('keydown', yieldToWrite, { capture: true });
    return () => {
      el.removeEventListener('pointerdown', yieldToWrite, { capture: true });
      el.removeEventListener('keydown', yieldToWrite, { capture: true });
    };
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
      // ProseMirror calls dispatchTransaction with the EditorView as `this`,
      // so we use `this` here instead of closing over the outer `view` variable.
      // Closing over `view` would fail on the first call because ProseMirror
      // invokes dispatchTransaction during construction before `view` is assigned.
      dispatchTransaction(tr: Transaction) {
        const self = this as unknown as EditorView;
        const next = self.state.apply(tr);
        self.updateState(next);
        editorState = next;
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
    clearInterval(fadeTimer);
    presenceActivity.destroy();
    offStatus();
    roomMeta.unobserve(onRoomMeta);
    unbindRoomName();
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
