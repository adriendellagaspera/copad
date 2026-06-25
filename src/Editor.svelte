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
  import { codecForFilename } from './format/index.js';
  import SlashMenu from './editor/ui/SlashMenu.svelte';
  import LinkPopover from './editor/ui/LinkPopover.svelte';
  import WordCount from './editor/ui/WordCount.svelte';
  import Outline from './editor/ui/Outline.svelte';
  import StatusPill from './ui/StatusPill.svelte';
  import PresenceBar from './ui/PresenceBar.svelte';
  import type { PeerUser, SaveStatus } from './ui/types.js';
  import type { Toasts } from './ui/toasts.svelte.js';
  import type { Storage, StorageAccess, DocContent } from './storage/types.js';
  import type {
    CollabConnect,
    ConnStatus,
    RoomId,
    SessionRole,
    DisplayName,
    CursorColor,
    PeerAwarenessState,
  } from './collaboration/types.js';

  type Props = {
    storage: Storage | null;
    name: DisplayName;
    color: CursorColor;
    room: RoomId;
    role?: SessionRole;
    connect: CollabConnect;
    toasts: Toasts;
    onstoragestatus?: () => void;
  };

  let { storage, name, color, room, role = 'writer', connect, toasts, onstoragestatus }: Props =
    $props();

  const SAVE_DEBOUNCE = 3_000;

  // Collab session — created once for the lifetime of this component.
  // untrack: both props are intentionally read once — {#key room} in the parent
  // remounts this component whenever room changes.
  const collab = untrack(() => connect)(untrack(() => room));
  const yFragment = collab.doc.getXmlFragment('prosemirror');

  let editorEl = $state<HTMLDivElement | undefined>();
  // $state.raw: track reference changes for reactivity but don't proxy the
  // EditorView/EditorState objects themselves — ProseMirror objects are not
  // designed to be deeply proxied.
  let view = $state.raw<EditorView | null>(null);
  let editorState = $state.raw<EditorState | null>(null);
  let users = $state<PeerUser[]>([]);
  let peers = $state(1);
  let conn = $state<ConnStatus>('connecting');
  let saveStatus = $state<SaveStatus>('idle');
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
      canPersist = a !== 'read';
    });
  });

  // ── Presence (derived from awareness) ──────────────────────────────────────
  // y-protocols types getStates() as Map<number, { [key: string]: any }>; we
  // cast once here because we know every peer calls setLocalState(PeerAwarenessState).
  const typedStates = (): ReadonlyMap<number, PeerAwarenessState> =>
    collab.awareness.getStates() as unknown as ReadonlyMap<number, PeerAwarenessState>;

  const readUsers = (): PeerUser[] => {
    const states = typedStates();
    const selfId = collab.doc.clientID;
    const list: PeerUser[] = [];
    states.forEach((state, id) => {
      list.push({
        id,
        name: state?.user?.name ?? ('Anonymous' as DisplayName),
        color: state?.user?.color ?? ('#888888' as CursorColor),
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
          const bytes = content.format === 'binary'
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
    const states = typedStates();
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
    saveStatus = 'saving';
    Promise.resolve(codec.encode(collab.doc))
      .then((bytes) => {
        const content: DocContent = s.contentFormat === 'text'
          ? { format: 'text', text: new TextDecoder().decode(bytes) }
          : { format: 'binary', bytes };
        return s.save(content);
      })
      .then(() => {
        saveStatus = 'saved';
        clearTimeout(savedTimer);
        savedTimer = setTimeout(() => {
          if (saveStatus === 'saved') saveStatus = 'idle';
        }, 2_500);
      })
      .catch((e: Error) => {
        saveStatus = 'error';
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
      // role is URL-derived and fixed for the session; untrack avoids a
      // reactive dependency inside ProseMirror's render cycle.
      editable: () => untrack(() => role) === 'writer',
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
    window.removeEventListener('beforeunload', flush);
    view?.destroy();
    collab.destroy();
  });
</script>

<div class="editor">
  <Toolbar {view} {editorState} {toasts} />
  <div class="status">
    <StatusPill
      {conn}
      {saveStatus}
      hasStorage={storage !== null}
      storageLabel={storage?.label}
      transport={collab.transport}
      onclick={storage !== null ? undefined : onstoragestatus}
    />
    <PresenceBar {users} />
    <span class="peer-count">{peers} {peers === 1 ? 'peer' : 'peers'}</span>
    <span class="spacer"></span>
    <WordCount {editorState} />
    <Outline {view} {editorState} />
  </div>
  <div class="content" bind:this={editorEl}></div>
  <SlashMenu {view} {editorState} />
  <LinkPopover {view} />
</div>
