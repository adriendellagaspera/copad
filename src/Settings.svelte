<script lang="ts">
  import type { Storage } from './storage/types.js';
  import { isConfigured } from './storage/types.js';

  let {
    backends,
    open = $bindable(false),
    focusId = '',
    onchange,
    onconnect,
    ondisconnect,
  }: {
    backends: Storage[];
    open?: boolean;
    focusId?: string;
    onchange?: () => void;
    onconnect?: (s: Storage) => void;
    ondisconnect?: (s: Storage) => void;
  } = $props();

  const configurable = $derived(backends.filter(s => s.configFields && s.configFields.length > 0));

  // Per-backend busy/error state — keyed by backend id.
  let busy = $state<Record<string, boolean>>({});
  let errors = $state<Record<string, string>>({});

  function setConfig(s: Storage, name: string, value: string) {
    s.setConfig?.(name, value);
    onchange?.();
  }

  async function connect(s: Storage) {
    busy = { ...busy, [s.id]: true };
    errors = { ...errors, [s.id]: '' };
    try {
      await s.connect();
      onconnect?.(s);
    } catch (e) {
      errors = { ...errors, [s.id]: (e as Error).message };
    } finally {
      busy = { ...busy, [s.id]: false };
    }
  }

  function disconnect(s: Storage) {
    s.disconnect();
    ondisconnect?.(s);
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
      Configure your storage backends. App keys are saved in this browser and
      reused across sessions — you only set them once.
    </p>

    {#each configurable as s (s.id)}
      {@const ready = isConfigured(s)}
      {@const authed = s.isAuthenticated()}
      <section class="backend" class:focused={s.id === focusId}>
        <div class="backend-head">
          <span class="backend-name">{s.label}</span>
          {#if authed}
            <span class="badge ok">Connected</span>
          {:else}
            <span class="badge">{ready ? 'Ready' : 'Needs setup'}</span>
          {/if}
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
              oninput={e => setConfig(s, f.name, e.currentTarget.value)}
            />
            {#if f.help}<small class="field-help">{f.help}</small>{/if}
          </label>
        {/each}

        <div class="backend-actions">
          {#if authed}
            <button onclick={() => disconnect(s)}>Disconnect</button>
          {:else}
            <button
              class="primary"
              onclick={() => connect(s)}
              disabled={!ready || busy[s.id]}
            >
              {busy[s.id] ? 'Connecting…' : `Connect ${s.label}`}
            </button>
          {/if}
          {#if errors[s.id]}<p class="error">{errors[s.id]}</p>{/if}
        </div>
      </section>
    {/each}

    {#if configurable.length === 0}
      <p class="settings-empty">No storage backends require configuration.</p>
    {/if}
  </div>
{/if}
