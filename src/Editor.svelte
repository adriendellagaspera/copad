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
  import Toolbar from './Toolbar.svelte';
  import SelectionToolbar from './editor/ui/SelectionToolbar.svelte';
  import { codecForFilename } from './format/index.js';
  import SlashMenu from './editor/ui/SlashMenu.svelte';
  import LinkPopover from './editor/ui/LinkPopover.svelte';
  import WordCount from './editor/ui/WordCount.svelte';
  import Outline from './editor/ui/Outline.svelte';
  import ShortcutBar from './editor/ui/ShortcutBar.svelte';
  import type { PeerUser } from './ui/types.js';
  import { SaveStatus } from './ui/types.js';
  import type { Toasts } from './ui/toasts.svelte.js';
  import type { Storage, DocContent } from './storage/types.js';
  import { StorageAccess, DocFormat } from './storage/types.js';
  import type {
    CollabConnect,
    RoomId,
    DisplayName,
    CursorColor,
    PeerAwarenessState,
  } from './collaboration/types.js';
  import { ConnStatus, SessionRole } from './collaboration/types.js';
  import type { RoomName } from './collaboration/types.js';
  import { parsePeerAwarenessState, parseRoomName } from './collaboration/parse.js';
  import { bindRoomName, unbindRoomName, setRoomNameLocal } from './collaboration/roomName.svelte.js';
  import {
    setSessionConn,
    setSessionSave,
    setSessionPresence,
    setSessionDiagnostics,
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
  };

  let { storage, name, color, room, role = SessionRole.Writer, connect, toasts, lang = 'en', spellcheck = true }: Props =
    $props();

  const SAVE_DEBOUNCE = 3_000;

  // Collab session — created once for the lifetime of this component.
  // untrack: both props are intentionally read once — {#key room} in the parent
  // remounts this component whenever room changes.
  const collab = untrack(() => connect)(untrack(() => room));
  const yFragment = collab.doc.getXmlFragment('prosemirror');

  // Shared, editable room name. It lives in a dedicated Y.Map — NOT the
  // prosemirror fragment — so it syncs to every peer and rides along in the .yjs
  // format, yet never leaks into text/markdown/html/json exports (codecs only
  // read the fragment). The header edits it through the roomName bridge.
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
  $effect(() => setSessionConn(conn));
  $effect(() => setSessionSave(saveStatus));
  $effect(() => setSessionPresence(users, peers));

  // Broadcast full typed awareness state whenever any field changes.
  $effect(() => {
    const state: PeerAwarenessState = {
      user: { name, color },
      role,
      canPersist,
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

  // Leader = the persister with the lowest clientID. This prevents write races
  // when multiple peers have storage access to the same backend, while still
  // allowing a peer without storage access (e.g. a SharePoint guest) to have
  // their edits relayed and persisted by an authenticated leader.
  const isLeader = (): boolean => {
    const states = parsedStates();
    const persisterIds = [...states.entries()]
      .filter(([, s]) => s.canPersist)
      .map(([id]) => id);
    if (persisterIds.length === 0) return false;
    return collab.doc.clientID === Math.min(...persisterIds);
  };

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
    view.setProps({ attributes: { lang, spellcheck: spellcheck ? 'true' : 'false' } });
  });

  onMount(() => {
    const state = EditorState.create({
      schema,
      plugins: [
        ySyncPlugin(yFragment),
        yCursorPlugin(collab.awareness),
        yUndoPlugin(),
        slashMenuPlugin(),
        placeholderPlugin('Write something, or press “/” for commands…'),
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
      },
      // role is URL-derived and fixed for the session; untrack avoids a
      // reactive dependency inside ProseMirror's render cycle.
      editable: () => untrack(() => role) === SessionRole.Writer,
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
  });

  onDestroy(() => {
    clearTimeout(saveTimer);
    clearTimeout(savedTimer);
    offStatus();
    roomMeta.unobserve(onRoomMeta);
    unbindRoomName();
    resetSessionState();
    window.removeEventListener('beforeunload', flush);
    view?.destroy();
    collab.destroy();
  });
</script>

<div class="editor">
  <!-- Fixed bar: kept on touch devices, hidden on desktop (see editor.css)
       where the SelectionToolbar bubble takes over. -->
  <div class="fixed-toolbar">
    <Toolbar {view} {editorState} {toasts} />
  </div>
  <div class="content" bind:this={editorEl}></div>
  <div class="status">
    <ShortcutBar />
    <span class="spacer"></span>
    <WordCount {editorState} />
    <Outline {view} {editorState} />
  </div>
  <SelectionToolbar {view} {editorState} {toasts} />
  <SlashMenu {view} {editorState} />
  <LinkPopover {view} />
</div>
