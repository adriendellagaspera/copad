<script lang="ts">
  import type { Storage } from './storage/types.js';
  import { isConfigured } from './storage/types.js';

  let {
    backends,
    open = $bindable(false),
    focusId = '',
    onchange,
  }: {
    backends: Storage[];
    open?: boolean;
    focusId?: string;
    onchange?: () => void;
  } = $props();

  // Only backends with one-time configuration belong here. Per-session logins
  // (WebDAV) and zero-config backends (Local) are handled on the front page.
  const configurable = $derived(backends.filter(s => s.configFields && s.configFields.length > 0));

  function set(s: Storage, name: string, value: string) {
    s.setConfig?.(name, value);
    onchange?.();
  }

  function close() {
    open = false;
  }
</script>

<svelte:window onkeydown={e => open && e.key === 'Escape' && close()} />

{#if open}
  <div class="settings-backdrop" onclick={close} role="presentation"></div>
  <div class="settings" role="dialog" aria-modal="true" aria-label="Settings">
    <header class="settings-head">
      <h2>Settings</h2>
      <button class="icon-btn" onclick={close} aria-label="Close settings">✕</button>
    </header>

    <p class="settings-lead">
      Configure the app keys your storage backends use. These are saved in this
      browser and reused across sessions — you only set them once.
    </p>

    {#each configurable as s (s.id)}
      {@const ready = isConfigured(s)}
      <section class="backend" class:focused={s.id === focusId}>
        <div class="backend-head">
          <span class="backend-name">{s.label}</span>
          <span class="badge" class:ok={ready}>{ready ? 'Ready' : 'Needs setup'}</span>
        </div>
        {#if s.blurb}<p class="backend-blurb">{s.blurb}</p>{/if}

        {#each s.configFields ?? [] as f (f.name)}
          {@const locked = s.configLocked?.(f.name) ?? false}
          <label class="field">
            <span class="field-label">
              {f.label}
              {#if locked}<span class="lock" title="Set by this deployment">🔒 managed</span>{/if}
            </span>
            <input
              type={f.type ?? 'text'}
              placeholder={f.placeholder ?? ''}
              value={s.config?.(f.name) ?? ''}
              disabled={locked}
              oninput={e => set(s, f.name, e.currentTarget.value)}
            />
            {#if f.help}<small class="field-help">{f.help}</small>{/if}
          </label>
        {/each}
      </section>
    {/each}

    {#if configurable.length === 0}
      <p class="settings-empty">No storage backends require configuration.</p>
    {/if}
  </div>
{/if}
