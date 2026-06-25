<script lang="ts">
  import type { EditorView } from 'prosemirror-view';
  import { setLink, removeLink, currentLinkHref, normalizeHref } from '../linkCommands.js';
  import { runCommand } from '../commands.js';

  let { view }: { view: EditorView | null } = $props();

  let open = $state(false);
  let href = $state('');
  let wasLinked = $state(false);
  let pos = $state<{ left: number; top: number } | null>(null);
  let inputEl = $state<HTMLInputElement | undefined>();

  function openPopover(): void {
    if (!view) return;
    const state = view.state;
    const existing = currentLinkHref(state);
    wasLinked = existing !== null;
    href = existing ?? '';
    try {
      const c = view.coordsAtPos(state.selection.from);
      pos = { left: c.left, top: c.bottom + 6 };
    } catch {
      pos = null;
    }
    open = true;
    queueMicrotask(() => inputEl?.focus());
  }

  function close(): void {
    open = false;
    view?.focus();
  }

  function apply(): void {
    if (!view) return;
    const h = href.trim();
    if (!h) {
      runCommand(view, removeLink);
      close();
      return;
    }
    const { empty, from } = view.state.selection;
    if (empty) {
      // No selection: insert the URL as linked text.
      const mark = view.state.schema.marks.link.create({ href: normalizeHref(h) });
      const tr = view.state.tr.insertText(h, from);
      tr.addMark(from, from + h.length, mark);
      view.dispatch(tr.scrollIntoView());
      close();
      return;
    }
    runCommand(view, setLink(h));
    close();
  }

  function unlink(): void {
    if (!view) return;
    runCommand(view, removeLink);
    close();
  }

  // Bridge: Mod-k and the toolbar link button both dispatch `copad:link`.
  $effect(() => {
    const dom = view?.dom;
    if (!dom) return;
    const handler = (): void => openPopover();
    dom.addEventListener('copad:link', handler as EventListener);
    return () => dom.removeEventListener('copad:link', handler as EventListener);
  });
</script>

{#if open && pos}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="link-backdrop" onmousedown={close}></div>
  <div class="link-popover" style="left:{pos.left}px; top:{pos.top}px" role="dialog" aria-label="Edit link">
    <input
      bind:this={inputEl}
      type="url"
      placeholder="Paste or type a link"
      bind:value={href}
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          apply();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      }}
    />
    <button class="primary" onmousedown={(e) => { e.preventDefault(); apply(); }}>
      {wasLinked ? 'Update' : 'Link'}
    </button>
    {#if wasLinked}
      <button class="ghost" onmousedown={(e) => { e.preventDefault(); unlink(); }} title="Remove link">
        Unlink
      </button>
    {/if}
  </div>
{/if}

<style>
  .link-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-menu);
  }
  .link-popover {
    position: fixed;
    z-index: calc(var(--z-menu) + 1);
    display: flex;
    gap: var(--sp-2);
    align-items: center;
    padding: var(--sp-2);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-lg);
    animation: link-in var(--dur-fast) var(--ease);
  }
  .link-popover input {
    width: 240px;
    font-size: var(--fs-300);
  }
  .link-popover button {
    flex-shrink: 0;
  }
  @keyframes link-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
