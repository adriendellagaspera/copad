<script lang="ts">
  import type { EditorView } from 'prosemirror-view';
  import { TextSelection } from 'prosemirror-state';
  import { setLink, removeLink, currentLinkHref, normalizeHref, isValidHref } from '../linkCommands.js';
  import { runCommand } from '../commands.js';

  let { view }: { view: EditorView | null } = $props();

  let open = $state(false);
  let href = $state('');
  let wasLinked = $state(false);
  let pos = $state<{ left: number; top: number } | null>(null);
  let inputEl = $state<HTMLInputElement | undefined>();
  let invalid = $derived(href.trim() !== '' && !isValidHref(href));

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

  // Cancel path (Escape / click-away): collapse the selection so focus lands
  // straight back in the text, instead of leaving the prior selection active
  // — which would pop the SelectionToolbar bubble right back up and make it
  // look like a second dismissal is needed to really get back to editing.
  function dismiss(): void {
    if (view) {
      const { to } = view.state.selection;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, to)));
    }
    close();
  }

  function apply(): void {
    if (!view) return;
    const h = href.trim();
    if (!h) {
      runCommand(view, removeLink);
      close();
      return;
    }
    if (!isValidHref(h)) return; // keep the popover open so the error stays visible
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
  type CopadLinkEvent = CustomEvent<void>;
  $effect(() => {
    const dom = view?.dom;
    if (!dom) return;
    const handler = (_e: CopadLinkEvent): void => openPopover();
    dom.addEventListener('copad:link', handler as EventListener);
    return () => dom.removeEventListener('copad:link', handler as EventListener);
  });

  // Window-level Escape (matches RoomSwitcher/IdentityMenu/Settings): the
  // input's own onkeydown only fires once it holds focus, which a slow
  // coordsAtPos or a delayed focus microtask can race — this guarantees
  // Escape always dismisses the popover regardless of where focus landed.
  $effect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismiss();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

{#if open && pos}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="link-backdrop" onmousedown={dismiss}></div>
  <div class="link-popover" style="left:{pos.left}px; top:{pos.top}px" role="dialog" aria-label="Edit link">
    <div class="link-field">
      <input
        bind:this={inputEl}
        type="url"
        placeholder="Paste or type a link"
        class:invalid
        aria-invalid={invalid}
        bind:value={href}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            apply();
          }
        }}
      />
      {#if invalid}
        <span class="link-error">That doesn't look like a valid link</span>
      {/if}
    </div>
    <button class="primary" disabled={invalid} onmousedown={(e) => { e.preventDefault(); apply(); }}>
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
  .link-field {
    position: relative;
    width: 240px;
  }
  .link-popover input {
    width: 100%;
    font-size: var(--fs-300);
  }
  .link-popover input.invalid {
    border-color: var(--danger);
  }
  .link-error {
    position: absolute;
    top: calc(100% + var(--sp-1));
    left: 0;
    font-size: var(--fs-200);
    color: var(--danger);
    white-space: nowrap;
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
