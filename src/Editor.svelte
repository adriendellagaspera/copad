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
  import type { Storage } from './storage/types.js';
  import type { CollabConnect } from './collaboration/types.js';

  type Props = {
    storage: Storage | null;
    name: string;
    color: string;
    room: string;
    connect: CollabConnect;
    onstoragestatus?: () => void;
  };

  let { storage, name, color, room, connect, onstoragestatus }: Props = $props();

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

  // Track peer count via awareness.
  collab.awareness.on('change', () => {
    peers = collab.awareness.getStates().size || 1;
  });

  // Sync display name + cursor color with other peers.
  $effect(() => {
    collab.awareness.setLocalStateField('user', { name, color });
  });

  // Load from storage when adapter becomes available (or changes to a different backend).
  $effect(() => {
    if (!storage?.isAuthenticated() || !view || loadedFrom === storage.id) return;
    const id = storage.id;
    storage.load()
      .then((bytes: Uint8Array | null) => {
        if (bytes) Y.applyUpdate(collab.doc, bytes);
        loadedFrom = id;
      })
      .catch((e: unknown) => console.warn('Copad: load failed, starting with current state', e));
  });

  // Only the peer with the lowest clientID persists to storage (prevents write races).
  const isLeader = (): boolean => {
    const ids = [...collab.awareness.getStates().keys()];
    return ids.length === 0 || collab.doc.clientID === Math.min(...ids);
  };

  const flush = (): void => {
    if (!storage?.isAuthenticated() || !isLeader()) return;
    storage.save(Y.encodeStateAsUpdate(collab.doc)).catch((e: Error) =>
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
