<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EditorState } from 'prosemirror-state';
  import type { Transaction } from 'prosemirror-state';
  import { EditorView } from 'prosemirror-view';
  import { ySyncPlugin, yCursorPlugin, yUndoPlugin } from 'y-prosemirror';
  import * as Y from 'yjs';
  import { WebrtcProvider } from 'y-webrtc';
  import { schema } from './editor/schema.js';
  import { buildPlugins } from './editor/plugins.js';
  import Toolbar from './Toolbar.svelte';
  import type { StorageAdapter } from './storage/types.js';

  type Props = {
    adapter: StorageAdapter | null;
    name: string;
    color: string;
  };

  let { adapter, name, color }: Props = $props();

  const ROOM = import.meta.env.VITE_ROOM ?? 'copad-demo';
  const ROOM_PASSWORD: string | undefined = import.meta.env.VITE_ROOM_PASSWORD;
  const SIGNALING: string[] = (import.meta.env.VITE_SIGNALING_URL ?? 'ws://localhost:4444')
    .split(',')
    .map((s: string) => s.trim());
  const SAVE_DEBOUNCE = 3_000;

  // Yjs + WebRTC — created once for the lifetime of this component.
  const ydoc = new Y.Doc();
  const provider = new WebrtcProvider(ROOM, ydoc, {
    signaling: SIGNALING,
    password: ROOM_PASSWORD,
  });
  const yFragment = ydoc.getXmlFragment('prosemirror');

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
  provider.awareness.on('change', () => {
    peers = provider.awareness.getStates().size || 1;
  });

  // Sync display name + cursor color with other peers.
  $effect(() => {
    provider.awareness.setLocalStateField('user', { name, color });
  });

  // Load from storage when adapter becomes available (or changes to a different backend).
  $effect(() => {
    if (!adapter?.isAuthenticated() || !view || loadedFrom === adapter.id) return;
    const id = adapter.id;
    adapter.load()
      .then(bytes => {
        if (bytes) Y.applyUpdate(ydoc, bytes);
        loadedFrom = id;
      })
      .catch(e => console.warn('Copad: load failed, starting with current state', e));
  });

  // Only the peer with the lowest clientID persists to storage (prevents write races).
  const isLeader = (): boolean => {
    const ids = [...provider.awareness.getStates().keys()];
    return ids.length === 0 || ydoc.clientID === Math.min(...ids);
  };

  const flush = (): void => {
    if (!adapter?.isAuthenticated() || !isLeader()) return;
    adapter.save(Y.encodeStateAsUpdate(ydoc)).catch((e: Error) =>
      console.warn('Copad: autosave failed', e)
    );
  };

  ydoc.on('update', () => {
    if (!adapter?.isAuthenticated()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DEBOUNCE);
  });

  window.addEventListener('beforeunload', flush);

  onMount(() => {
    const state = EditorState.create({
      schema,
      plugins: [
        ySyncPlugin(yFragment),
        yCursorPlugin(provider.awareness),
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
    provider.destroy();
    ydoc.destroy();
  });
</script>

<div class="editor">
  <Toolbar {view} {editorState} />
  <div class="status">
    <span class="dot"></span>
    {peers} peer(s) connected · room "{ROOM}"
    {#if adapter?.isAuthenticated()}
      · {adapter.label} ✓
    {:else}
      · storage not connected
    {/if}
  </div>
  <div class="content" bind:this={editorEl}></div>
</div>
