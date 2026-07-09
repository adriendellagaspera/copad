<script lang="ts">
  import type { EditorView } from 'prosemirror-view';
  import type { EditorState } from 'prosemirror-state';
  import { TextSelection } from 'prosemirror-state';
  import { setLink, removeLink, currentLinkHref, normalizeHref, isValidHref } from '../linkCommands.js';
  import { runCommand } from '../commands.js';

  let { view, editorState }: { view: EditorView | null; editorState: EditorState | null } = $props();

  let open = $state(false);
  let href = $state('');
  let wasLinked = $state(false);
  let pos = $state<{ left: number; top: number } | null>(null);
  let inputEl = $state<HTMLInputElement | undefined>();
  let invalid = $derived(href.trim() !== '' && !isValidHref(href));

  // The range the popover was opened for, captured up front (see openPopover)
  // so apply()/unlink() always act on the text the user actually selected,
  // never on whatever `view.state.selection` happens to be by the time they
  // run — that live selection is deliberately collapsed to a caret below.
  let linkFrom = $state(0);
  let linkTo = $state(0);
  // The doc the popover was opened against, kept by reference (ProseMirror
  // nodes are immutable — any content change produces a new object). Used
  // to auto-dismiss if the document changes underneath the popover.
  let openDoc = $state<unknown>(null);

  function openPopover(): void {
    if (!view) return;
    const state = view.state;
    const { from, to, empty } = state.selection;
    const existing = currentLinkHref(state);
    wasLinked = existing !== null;
    href = existing ?? '';
    linkFrom = from;
    linkTo = to;
    openDoc = state.doc;
    try {
      const c = view.coordsAtPos(from);
      pos = { left: c.left, top: c.bottom + 6 };
    } catch {
      pos = null;
    }
    // Collapse the live selection to a caret *before* handing focus to the
    // popover's own <input> (the queueMicrotask below). Leaving a real,
    // possibly cross-paragraph Selection active in the contenteditable
    // while focus moves away asynchronously races prosemirror-view's own
    // selectionchange-driven DOM sync: its DOMObserver reads the browser's
    // current Selection back into a document position on every native
    // `selectionchange` event, and losing focus mid-selection can hand it a
    // now-stale position outside the document — this is what produced the
    // reported "Position N out of range" / "setEnd on Range" crashes
    // (reproduced via Ctrl+K opened over a selection, handing focus to this
    // input). `linkFrom`/`linkTo` above remember the original range so
    // apply()/unlink() can still act on it.
    if (!empty) {
      view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, to)));
    }
    open = true;
    queueMicrotask(() => inputEl?.focus());
  }

  // If the document changes while the popover is open — an undo/redo, a
  // remote peer's edit, anything — the captured linkFrom/linkTo range and
  // the wasLinked/href snapshot no longer describe anything well-defined:
  // "the same range" may not even exist anymore. Rather than guess, close
  // the popover; the user can re-open it against the current document. Our
  // own selection-collapse dispatch above doesn't touch doc content, so it
  // doesn't trigger this — only a real content change does.
  $effect(() => {
    if (!open || openDoc === null || !editorState) return;
    if (editorState.doc !== openDoc) dismiss();
  });

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

  /** Clamp the captured range to the current document, in case it changed
   *  underneath the popover in some way the doc-identity effect above
   *  didn't already close it for (defense in depth — normally that effect
   *  means apply()/unlink() only ever run against the same doc `linkFrom`/
   *  `linkTo` were captured from). */
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
      runCommand(view, removeLink);
      close();
      return;
    }
    if (!isValidHref(h)) return; // keep the popover open so the error stays visible
    const { from, to } = currentLinkRange();
    if (from === to) {
      // No selection: insert the URL as linked text.
      const mark = view.state.schema.marks.link.create({ href: normalizeHref(h) });
      const tr = view.state.tr.insertText(h, from);
      tr.addMark(from, from + h.length, mark);
      view.dispatch(tr.scrollIntoView());
      close();
      return;
    }
    // Restore the originally selected range — collapsed to a caret in
    // openPopover to avoid the focus/selection race documented there — so
    // setLink applies to the text the popover was actually opened for.
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

  // Bridge: Mod-k and the toolbar link button both dispatch `copad:link`.
  type CopadLinkEvent = CustomEvent<void>;
  $effect(() => {
    const dom = view?.dom;
    if (!dom) return;
    const handler = (_e: CopadLinkEvent): void => openPopover();
    dom.addEventListener('copad:link', handler as EventListener);
    return () => dom.removeEventListener('copad:link', handler as EventListener);
  });

  // Window-level Escape (matches IdentityMenu/Settings): the
  // input's own onkeydown only fires once it holds focus, which a slow
  // coordsAtPos or a delayed focus microtask can race — this guarantees
  // Escape always dismisses the popover regardless of where focus landed.
  // Capture phase so we see it before any other in-page listener (or a
  // browser-extension content script on the input, e.g. a password manager)
  // gets a chance to stopPropagation() or otherwise swallow the first press.
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
