<script lang="ts">
  import type { EditorView } from 'prosemirror-view';
  import type { EditorState } from 'prosemirror-state';
  import type { Node as PMNode } from 'prosemirror-model';
  import { TextSelection } from 'prosemirror-state';
  import { setLink, removeLink, linkAround, normalizeHref, isValidHref } from '../linkCommands.js';
  import { runCommand } from '../commands.js';

  let { view, editorState }: { view: EditorView | null; editorState: EditorState | null } = $props();

  let open = $state(false);
  let href = $state('');
  let wasLinked = $state(false);
  let pos = $state<{ left: number; top: number } | null>(null);
  let inputEl = $state<HTMLInputElement | undefined>();
  let invalid = $derived(href.trim() !== '' && !isValidHref(href));

  // Captured up front so apply()/unlink() act on the originally selected text, not the live selection (deliberately collapsed to a caret below).
  let linkFrom = $state(0);
  let linkTo = $state(0);
  // ProseMirror nodes are immutable, so identity alone tells us if the doc changed underneath the popover.
  let openDoc = $state.raw<PMNode | null>(null);

  function openPopover(): void {
    if (!view) return;
    const state = view.state;
    const { from, to, empty } = state.selection;
    const existing = linkAround(state);
    wasLinked = existing !== null;
    href = existing?.href ?? '';
    linkFrom = existing ? existing.from : from;
    linkTo = existing ? existing.to : to;
    openDoc = state.doc;
    try {
      const c = view.coordsAtPos(from);
      pos = { left: c.left, top: c.bottom + 6 };
    } catch {
      pos = null;
    }
    // Collapsing before the focus microtask below avoids racing prosemirror-view's selectionchange-driven DOM sync, which reproduced as "Position N out of range" crashes when focus moved away mid-selection.
    if (!empty) {
      view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, to)));
    }
    open = true;
    queueMicrotask(() => inputEl?.focus());
  }

  // A doc change (undo, remote peer edit) invalidates the captured range; close rather than guess.
  $effect(() => {
    if (!open || openDoc === null || !editorState) return;
    if (editorState.doc !== openDoc) dismiss();
  });

  function close(): void {
    open = false;
    view?.focus();
  }

  // Collapses the selection on dismiss: leaving it active would pop SelectionToolbar right back up, looking like a second dismissal is needed.
  function dismiss(): void {
    if (view) {
      const { to } = view.state.selection;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, to)));
    }
    close();
  }

  // Defense in depth: clamps in case the range outlived the doc-identity effect above that normally closes the popover on a change.
  function currentLinkRange(): { from: number; to: number } {
    if (!view) return { from: linkFrom, to: linkTo };
    const size = view.state.doc.content.size;
    const from = Math.min(linkFrom, size);
    const to = Math.min(linkTo, size);
    return { from: Math.min(from, to), to: Math.max(from, to) };
  }

  function apply(): void {
    if (!view) return;
    const h = href.trim();
    if (!h) {
      // Acts on the captured range, not the live collapsed caret — otherwise removeLink only clears stored marks and leaves the link on the surrounding text.
      const { from, to } = currentLinkRange();
      if (from !== to) {
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
      }
      runCommand(view, removeLink);
      close();
      return;
    }
    if (!isValidHref(h)) return; // keep the popover open so the error stays visible
    const { from, to } = currentLinkRange();
    if (from === to) {
      const mark = view.state.schema.marks.link.create({ href: normalizeHref(h) });
      const tr = view.state.tr.insertText(h, from);
      tr.addMark(from, from + h.length, mark);
      view.dispatch(tr.scrollIntoView());
      close();
      return;
    }
    // Restore the range collapsed in openPopover so setLink applies to the text the popover was actually opened for.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
    runCommand(view, setLink(h));
    close();
  }

  function unlink(): void {
    if (!view) return;
    const { from, to } = currentLinkRange();
    if (from !== to) {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
    }
    runCommand(view, removeLink);
    close();
  }

  type CopadLinkEvent = CustomEvent<void>;
  $effect(() => {
    const dom = view?.dom;
    if (!dom) return;
    const handler = (_e: CopadLinkEvent): void => openPopover();
    dom.addEventListener('copad:link', handler as EventListener);
    return () => dom.removeEventListener('copad:link', handler as EventListener);
  });

  // Window-level, capture phase: guarantees Escape dismisses regardless of where focus landed, and fires before a page listener or extension (e.g. a password manager) can swallow it.
  $effect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismiss();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
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
    <!-- mousedown (preventDefault) not onclick: a click fires after the blur/dismiss race and proved unreliable. Enter/Space cover keyboard use. -->
    <button
      class="primary"
      disabled={invalid}
      onmousedown={(e) => { e.preventDefault(); apply(); }}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apply(); } }}
    >
      {wasLinked ? 'Update' : 'Link'}
    </button>
    {#if wasLinked}
      <button
        class="ghost"
        title="Remove link"
        onmousedown={(e) => { e.preventDefault(); unlink(); }}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); unlink(); } }}
      >
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
    /* Not --fs-300: this field autofocuses the instant the popover opens, and
       iOS Safari auto-zooms the page when a focused field's font-size is
       under 16px (see app.css's global input rule for the same fix). */
    font-size: var(--fs-400);
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
