<script lang="ts">
  import {
    paletteGroups,
    parsePaletteInput,
    type PaletteSources,
    type PaletteItemId,
  } from './commandPalette.js';
  import type { DialogOpen } from './types.js';

  let {
    open,
    sources,
    onclose,
    onpick,
  }: {
    open: DialogOpen;
    sources: PaletteSources;
    onclose: () => void;
    onpick: (id: PaletteItemId) => void;
  } = $props();

  const PLACEHOLDER = 'Search documents, headings, actions';

  let raw = $state('');
  let index = $state(0);
  let inputEl = $state<HTMLInputElement | undefined>();
  let listEl = $state<HTMLDivElement | undefined>();

  const groups = $derived(open ? paletteGroups(sources, parsePaletteInput(raw)) : []);
  const rows = $derived(groups.flatMap((g) => g.items));
  const active = $derived(rows.length ? Math.min(index, rows.length - 1) : 0);

  // ':' is legal in an id but not in a bare CSS selector, and these ids reach
  // aria-activedescendant, which is matched by id.
  const optionId = (id: PaletteItemId): string => `palette-${id.replace(/[^\w-]/g, '_')}`;

  $effect(() => {
    if (!open) return;
    raw = '';
    index = 0;
    inputEl?.focus();
  });

  $effect(() => {
    void active;
    listEl?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  });

  function step(by: number): void {
    if (rows.length === 0) return;
    index = (active + by + rows.length) % rows.length;
  }

  function pick(id: PaletteItemId): void {
    onpick(id);
    onclose();
  }

  function onKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        step(1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        step(-1);
        return;
      case 'Enter':
        e.preventDefault();
        if (rows[active]) pick(rows[active].id);
        return;
      case 'Escape':
        e.preventDefault();
        onclose();
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="palette-backdrop" onmousedown={onclose}></div>
  <div class="palette" role="dialog" aria-modal="true" aria-label="Search and commands">
    <input
      bind:this={inputEl}
      bind:value={raw}
      class="palette-input"
      type="text"
      role="combobox"
      aria-expanded="true"
      aria-controls="palette-results"
      aria-activedescendant={rows[active] ? optionId(rows[active].id) : undefined}
      aria-label={PLACEHOLDER}
      placeholder={PLACEHOLDER}
      autocomplete="off"
      spellcheck="false"
      oninput={() => (index = 0)}
      onkeydown={onKeydown}
    />

    <div class="palette-results" id="palette-results" role="listbox" aria-label="Results" bind:this={listEl}>
      {#each groups as group (group.label)}
        <div class="palette-group-label" aria-hidden="true">{group.label}</div>
        {#each group.items as item (item.id)}
          {@const i = rows.indexOf(item)}
          <button
            type="button"
            class="palette-row"
            role="option"
            id={optionId(item.id)}
            aria-selected={i === active}
            data-active={i === active}
            onmousemove={() => (index = i)}
            onmousedown={(e) => {
              e.preventDefault();
              pick(item.id);
            }}
          >
            <span class="palette-label">{item.label}</span>
            {#if item.hint}<span class="palette-hint">{item.hint}</span>{/if}
          </button>
        {/each}
      {:else}
        <p class="palette-empty">Nothing matches “{raw.trim()}”.</p>
      {/each}
    </div>

    <div class="palette-foot">
      <span><kbd>#</kbd> headings</span>
      <span><kbd>&gt;</kbd> actions</span>
      <span><kbd>/</kbd> insert</span>
      <span class="palette-foot-end"><kbd>↵</kbd> open · <kbd>esc</kbd> close</span>
    </div>
  </div>
{/if}

<style>
  .palette-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-dialog);
    background: var(--overlay);
  }
  .palette {
    position: fixed;
    z-index: calc(var(--z-dialog) + 1);
    top: 12vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(480px, calc(100vw - 2 * var(--sp-4)));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-lg);
  }
  .palette-input {
    flex: none;
    width: 100%;
    padding: var(--sp-3) var(--sp-4);
    border: none;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    background: transparent;
    color: var(--text);
    font-size: var(--fs-400);
  }
  .palette-input:focus {
    outline: none;
  }
  .palette-results {
    flex: 1 1 auto;
    min-height: 0;
    max-height: min(50vh, 380px);
    overflow-y: auto;
    padding: var(--sp-1);
  }
  .palette-group-label {
    padding: var(--sp-2) var(--sp-2) var(--sp-1);
    color: var(--text-faint);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }
  .palette-row {
    display: flex;
    align-items: baseline;
    gap: var(--sp-3);
    width: 100%;
    padding: 0.35rem var(--sp-2);
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  .palette-row[data-active='true'] {
    background: var(--accent-soft);
  }
  .palette-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-300);
    color: var(--text);
  }
  .palette-row[data-active='true'] .palette-label {
    color: var(--accent-soft-text);
  }
  .palette-hint {
    flex: none;
    font-size: 0.72rem;
    color: var(--text-faint);
  }
  .palette-empty {
    margin: 0;
    padding: var(--sp-3) var(--sp-2);
    color: var(--text-muted);
    font-size: var(--fs-300);
  }
  .palette-foot {
    flex: none;
    display: flex;
    gap: var(--sp-3);
    padding: var(--sp-2) var(--sp-3);
    border-top: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text-faint);
    font-size: 0.68rem;
  }
  .palette-foot-end {
    margin-left: auto;
  }
  .palette-foot kbd {
    font-family: var(--font-mono);
    font-size: 0.95em;
  }
</style>
