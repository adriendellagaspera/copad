<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { EditorState } from 'prosemirror-state';
  import type { Transaction } from 'prosemirror-state';
  import { EditorView } from 'prosemirror-view';
  import { ySyncPlugin, yCursorPlugin, yUndoPlugin } from 'y-prosemirror';
  import * as Y from 'yjs';
  import { schema } from './editor/schema.js';
  import { buildPlugins } from './editor/plugins.js';
  import Toolbar from './Toolbar.svelte';
  import type { Storage, StorageAccess, DocContent } from './storage/types.js';
  import type { CollabConnect, RoomId, SessionRole, DisplayName, CursorColor, PeerUser, PeerAwarenessState } from './collaboration/types.js';

  type Props = {
    storage: Storage | null;
    name: DisplayName;
    color: CursorColor;
    room: RoomId;
    role?: SessionRole;
    connect: CollabConnect;
    onstoragestatus?: () => void;
  };

  let { storage, name, color, room, role = 'writer', connect, onstoragestatus }: Props = $props();

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
  let peers = $state(1);
  let loadedFrom = $state<string | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  // Whether this peer can write to its own storage backend for this file.
  // Updated asynchronously when the storage prop changes (backends with access()
  // may need a round-trip; backends without it resolve synchronously).
  let canPersist = $state(false);

  $effect(() => {
    const s = storage;
    if (!s?.isAuthenticated()) {
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

  // Track peer count via awareness.
  collab.awareness.on('change', () => {
    peers = collab.awareness.getStates().size || 1;
  });

  // Broadcast full typed awareness state whenever any field changes.
  $effect(() => {
    const state: PeerAwarenessState = {
      user: { name, color } satisfies PeerUser,
      role,
      canPersist,
    };
    collab.awareness.setLocalState(state);
  });

  function textToYjs(doc: Y.Doc, text: string): void {
    doc.transact(() => {
      const fragment = doc.getXmlFragment('prosemirror');
      fragment.delete(0, fragment.length);
      const para = new Y.XmlElement('paragraph');
      const content = new Y.XmlText();
      content.insert(0, text);
      para.insert(0, [content]);
      fragment.insert(0, [para]);
    });
  }

  function yjsToText(doc: Y.Doc): string {
    type XmlNode = Y.XmlElement | Y.XmlText | Y.XmlFragment;
    const collectText = (node: XmlNode): string => {
      if (node instanceof Y.XmlText) return node.toString();
      let out = '';
      for (const child of (node as unknown as Iterable<XmlNode>)) {
        out += collectText(child);
      }
      if (node instanceof Y.XmlElement &&
          (node.nodeName === 'paragraph' || node.nodeName === 'heading')) {
        out += '\n';
      }
      return out;
    };
    return collectText(doc.getXmlFragment('prosemirror')).trim();
  }

  // Load from storage when adapter becomes available (or changes to a different backend).
  $effect(() => {
    if (!storage?.isAuthenticated() || !view || loadedFrom === storage.id) return;
    const id = storage.id;
    storage.load()
      .then((content: DocContent | null) => {
        if (content) {
          if (content.format === 'binary') {
            Y.applyUpdate(collab.doc, content.bytes);
          } else {
            textToYjs(collab.doc, content.text);
          }
        }
        loadedFrom = id;
      })
      .catch((e: unknown) => console.warn('Copad: load failed, starting with current state', e));
  });

  // Leader = the persister with the lowest clientID. This prevents write races
  // when multiple peers have storage access to the same backend, while still
  // allowing a peer without storage access (e.g. a SharePoint guest) to have
  // their edits relayed and persisted by an authenticated leader.
  const isLeader = (): boolean => {
    const states = collab.awareness.getStates() as unknown as ReadonlyMap<number, PeerAwarenessState>;
    const persisterIds = [...states.entries()]
      .filter(([, s]) => s.canPersist)
      .map(([id]) => id);
    if (persisterIds.length === 0) return false;
    return collab.doc.clientID === Math.min(...persisterIds);
  };

  const flush = (): void => {
    if (!storage?.isAuthenticated() || !isLeader()) return;
    const content: DocContent = storage.contentFormat === 'text'
      ? { format: 'text', text: yjsToText(collab.doc) }
      : { format: 'binary', bytes: Y.encodeStateAsUpdate(collab.doc) };
    storage.save(content).catch((e: Error) =>
      console.warn('Copad: autosave failed', e)
    );
  };

  collab.doc.on('update', () => {
    if (!storage?.isAuthenticated()) return;
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
    window.removeEventListener('beforeunload', flush);
    view?.destroy();
    collab.destroy();
  });
</script>

<div class="editor">
  <Toolbar {view} {editorState} />
  <div class="status">
    <span class="dot"></span>
    {peers} peer(s) connected · room "{room}"
    {#if storage?.isAuthenticated()}
      · {storage.label} ✓
    {:else}
      · <button class="status-link" onclick={onstoragestatus}>storage not connected</button>
    {/if}
  </div>
  <div class="content" bind:this={editorEl}></div>
</div>
