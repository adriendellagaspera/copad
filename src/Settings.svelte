<script lang="ts">
  import type { Storage, SessionCredentials } from './storage/types.js';
  import { isConfigured } from './storage/types.js';

  let {
    backends,
    open = $bindable(false),
    focusId = '',
    localCache = true,
    onCacheChange,
    onCacheClear,
    onchange,
    onconnect,
    ondisconnect,
  }: {
    backends: Storage[];
    open?: boolean;
    focusId?: string;
    localCache?: boolean;
    onCacheChange?: (on: boolean) => void;
    onCacheClear?: () => void | Promise<void>;
    onchange?: () => void;
    onconnect?: (s: Storage) => void;
    ondisconnect?: (s: Storage) => void;
  } = $props();

  let clearing = $state(false);
  async function clearCache() {
    clearing = true;
    try {
      await onCacheClear?.();
    } finally {
      clearing = false;
    }
  }

  const configurable = $derived(backends.filter(s => s.configFields && s.configFields.length > 0));
  const connectable = $derived(backends.filter(s => !s.configFields || s.configFields.length === 0));

  // Per-backend busy/error state — keyed by backend id.
  let busy = $state<Record<string, boolean>>({});
  let errors = $state<Record<string, string>>({});
  // Per-backend credential inputs — keyed by backend id then field name.
  let creds = $state<Record<string, SessionCredentials>>({});
  // Per-backend filename overrides — keyed by backend id (cloud backends).
  let fnames = $state<Record<string, string>>({});

  function setConfig(s: Storage, name: string, value: string) {
    s.setConfig?.(name, value);
    onchange?.();
  }

  function filenameOf(s: Storage): string {
    return fnames[s.id] ?? s.filename?.() ?? '';
  }

  function setFilename(s: Storage, value: string) {
    fnames = { ...fnames, [s.id]: value };
    s.setFilename?.(value);
    onchange?.();
  }

  async function connect(s: Storage, c?: SessionCredentials) {
    busy = { ...busy, [s.id]: true };
    errors = { ...errors, [s.id]: '' };
    try {
      await s.connect(c);
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

    <section class="backend">
      <div class="backend-head">
        <span class="backend-name">Local copy</span>
        <span class="badge {localCache ? 'ok' : ''}">{localCache ? 'On' : 'Off'}</span>
      </div>
      <p class="backend-blurb">
        Keep a copy of your documents in this browser so they survive a reload and
        work offline — even with no storage backend connected.
      </p>
      <label class="toggle">
        <input
          type="checkbox"
          checked={localCache}
          onchange={e => onCacheChange?.(e.currentTarget.checked)}
        />
        <span>Keep a local copy of documents</span>
      </label>
      <small class="field-help">
        Stored <strong>unencrypted</strong> in this browser, regardless of any room
        password (that only encrypts the connection). Turn this off for a shared or
        untrusted device.
      </small>
      <div class="backend-actions">
        <button onclick={clearCache} disabled={clearing}>
          {clearing ? 'Clearing…' : 'Clear local copies'}
        </button>
      </div>
    </section>

    {#snippet filenameField(s: Storage)}
      {#if s.setFilename}
        <label class="field">
          <span class="field-label">File name</span>
          <input
            value={filenameOf(s)}
            placeholder="document.yjs"
            oninput={e => setFilename(s, e.currentTarget.value)}
          />
          <small class="field-help">
            The extension picks the format — .yjs (native), .md, .html, .json (PM), or any
            source/text extension (.txt, .py, .js, .ts, .rs, .go, .yml, …).
            Takes effect on connect.
          </small>
        </label>
      {/if}
    {/snippet}

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

        {@render filenameField(s)}

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

    {#each connectable as s (s.id)}
      {@const authed = s.isAuthenticated()}
      <section class="backend" class:focused={s.id === focusId}>
        <div class="backend-head">
          <span class="backend-name">{s.label}</span>
          {#if authed}
            <span class="badge ok">Connected</span>
          {:else if s.unavailableReason}
            <span class="badge unavailable">Unavailable</span>
          {:else}
            <span class="badge">Ready</span>
          {/if}
        </div>
        {#if s.blurb}<p class="backend-blurb">{s.blurb}</p>{/if}

        {#if !s.unavailableReason}{@render filenameField(s)}{/if}

        {#if s.unavailableReason}
          <p class="unavailable-reason">{s.unavailableReason}</p>
        {:else if authed}
          <div class="backend-actions">
            <button onclick={() => disconnect(s)}>Disconnect</button>
          </div>
        {:else}
          {#if s.credentialFields}
            <form class="creds" onsubmit={e => { e.preventDefault(); connect(s, creds[s.id] ?? {}); }}>
              {#each s.credentialFields as f (f.name)}
                <label class="field">
                  <span class="field-label">{f.label}</span>
                  <input
                    type={f.type ?? 'text'}
                    placeholder={f.placeholder ?? ''}
                    value={creds[s.id]?.[f.name] ?? ''}
                    oninput={e => { creds = { ...creds, [s.id]: { ...(creds[s.id] ?? {}), [f.name]: e.currentTarget.value } as SessionCredentials }; }}
                  />
                </label>
              {/each}
              <div class="backend-actions">
                <button class="primary" type="submit" disabled={busy[s.id]}>
                  {busy[s.id] ? 'Connecting…' : `Connect ${s.label}`}
                </button>
              </div>
            </form>
          {:else if s.id === 'local'}
            <div class="backend-actions">
              <button class="primary" onclick={() => connect(s)} disabled={busy[s.id]}>
                {busy[s.id] ? 'Opening…' : 'Open file'}
              </button>
              <button onclick={() => connect(s, { mode: 'new' })} disabled={busy[s.id]}>
                New file
              </button>
            </div>
          {:else}
            <div class="backend-actions">
              <button class="primary" onclick={() => connect(s)} disabled={busy[s.id]}>
                {busy[s.id] ? 'Connecting…' : `Connect ${s.label}`}
              </button>
            </div>
          {/if}
          {#if errors[s.id]}<p class="error">{errors[s.id]}</p>{/if}
        {/if}
      </section>
    {/each}
  </div>
{/if}
