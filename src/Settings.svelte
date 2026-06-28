<script lang="ts">
  import type { SessionCredentials } from './storage/types.js';
  import type { StorageBackend } from './storage/index.js';
  import { isConfigured } from './storage/auth.js';

  import type { TurnPrefs } from './collaboration/turn.js';
  import type { FallbackTurnPolicy } from './collaboration/types.js';
  import { parseTurnUrl, parseTurnUsername, parseTurnCredential } from './collaboration/parse.js';
  import type { TurnUrl } from './collaboration/types.js';

  let {
    backends,
    open = $bindable(false),
    focusId = '',
    localCache = true,
    onCacheChange,
    onCacheClear,
    turnPrefs,
    onTurnChange,
    onchange,
    onconnect,
    ondisconnect,
  }: {
    backends: StorageBackend[];
    open?: boolean;
    focusId?: string;
    localCache?: boolean;
    onCacheChange?: (on: boolean) => void;
    onCacheClear?: () => void | Promise<void>;
    turnPrefs?: TurnPrefs;
    onTurnChange?: (p: TurnPrefs) => void;
    onchange?: () => void;
    onconnect?: (b: StorageBackend) => void;
    ondisconnect?: (b: StorageBackend) => void;
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

  // Raw form strings (IO boundary — not TurnPrefs). Re-synced from the prop when
  // the drawer opens; converted to domain types only when the user hits Apply.
  let rawUrl = $state('');
  let rawUsername = $state('');
  let rawCredential = $state('');
  let turnFallback = $state<FallbackTurnPolicy>('openrelay');
  $effect(() => {
    if (open) {
      rawUrl = (turnPrefs?.urls ?? []).join(', ');
      rawUsername = turnPrefs?.username ?? '';
      rawCredential = turnPrefs?.credential ?? '';
      turnFallback = turnPrefs?.fallback ?? 'openrelay';
    }
  });
  function applyTurn() {
    const urls = rawUrl
      .split(',')
      .map((s) => parseTurnUrl(s.trim()))
      .filter((u): u is TurnUrl => u !== null);
    onTurnChange?.({
      urls,
      username: parseTurnUsername(rawUsername),
      credential: parseTurnCredential(rawCredential),
      fallback: turnFallback,
    });
  }

  const configurable = $derived(
    backends.filter(b => b.auth.configFields && b.auth.configFields.length > 0)
  );
  const connectable = $derived(
    backends.filter(b => !b.auth.configFields || b.auth.configFields.length === 0)
  );

  // Per-backend busy/error state — keyed by backend id.
  let busy = $state<Record<string, boolean>>({});
  let errors = $state<Record<string, string>>({});
  // Per-backend credential inputs — keyed by backend id then field name.
  let creds = $state<Record<string, SessionCredentials>>({});
  // Per-backend filename overrides — keyed by backend id (cloud backends).
  let fnames = $state<Record<string, string>>({});

  function setConfig(b: StorageBackend, name: string, value: string) {
    b.auth.setConfig?.(name, value);
    onchange?.();
  }

  function filenameOf(b: StorageBackend): string {
    return fnames[b.storage.id] ?? b.storage.filename?.() ?? '';
  }

  function setFilename(b: StorageBackend, value: string) {
    fnames = { ...fnames, [b.storage.id]: value };
    b.storage.setFilename?.(value);
    onchange?.();
  }

  async function connect(b: StorageBackend, c?: SessionCredentials) {
    busy = { ...busy, [b.storage.id]: true };
    errors = { ...errors, [b.storage.id]: '' };
    try {
      await b.auth.login(c);
      onconnect?.(b);
    } catch (e) {
      errors = { ...errors, [b.storage.id]: (e as Error).message };
    } finally {
      busy = { ...busy, [b.storage.id]: false };
    }
  }

  function disconnect(b: StorageBackend) {
    b.auth.logout();
    ondisconnect?.(b);
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

    {#if onTurnChange}
      <section class="backend">
        <div class="backend-head">
          <span class="backend-name">Connection (WebRTC)</span>
        </div>
        <p class="backend-blurb">
          Peer-to-peer needs a TURN relay to connect across mobile carrier networks
          (CGNAT / symmetric NAT). A free public relay is used by default; add your
          own for reliability. Changes apply on the next reconnect.
        </p>
        <label class="toggle">
          <input
            type="checkbox"
            checked={turnFallback === 'openrelay'}
            onchange={e => (turnFallback = e.currentTarget.checked ? 'openrelay' : 'none')}
          />
          <span>Use a public TURN relay when none is configured</span>
        </label>
        <label class="field">
          <span class="field-label">TURN URL(s)</span>
          <input
            placeholder="turns:your-turn.example:5349"
            value={rawUrl}
            oninput={e => (rawUrl = e.currentTarget.value)}
          />
          <small class="field-help">Comma-separated. Overrides both the default and any deployment TURN.</small>
        </label>
        <label class="field">
          <span class="field-label">TURN username</span>
          <input value={rawUsername} oninput={e => (rawUsername = e.currentTarget.value)} />
        </label>
        <label class="field">
          <span class="field-label">TURN credential</span>
          <input
            type="password"
            value={rawCredential}
            oninput={e => (rawCredential = e.currentTarget.value)}
          />
        </label>
        <div class="backend-actions">
          <button class="primary" onclick={applyTurn}>Apply &amp; reconnect</button>
        </div>
      </section>
    {/if}

    {#snippet filenameField(b: StorageBackend)}
      {#if b.storage.setFilename}
        <label class="field">
          <span class="field-label">File name</span>
          <input
            value={filenameOf(b)}
            placeholder="document.yjs"
            oninput={e => setFilename(b, e.currentTarget.value)}
          />
          <small class="field-help">
            The extension picks the format — .yjs (native), .md, .html, .json (PM), or any
            source/text extension (.txt, .py, .js, .ts, .rs, .go, .yml, …).
            Takes effect on connect.
          </small>
        </label>
      {/if}
    {/snippet}

    {#each configurable as b (b.storage.id)}
      {@const ready = isConfigured(b.auth)}
      {@const authed = b.auth.isAuthenticated()}
      <section class="backend" class:focused={b.storage.id === focusId}>
        <div class="backend-head">
          <span class="backend-name">{b.storage.label}</span>
          {#if authed}
            <span class="badge ok">Connected</span>
          {:else}
            <span class="badge">{ready ? 'Ready' : 'Needs setup'}</span>
          {/if}
        </div>
        {#if b.storage.blurb}<p class="backend-blurb">{b.storage.blurb}</p>{/if}

        {#each b.auth.configFields ?? [] as f (f.name)}
          {@const locked = b.auth.configLocked?.(f.name) ?? false}
          <label class="field">
            <span class="field-label">
              {f.label}
              {#if locked}<span class="lock" title="Set by this deployment">🔒 managed</span>{/if}
            </span>
            <input
              type={f.type ?? 'text'}
              placeholder={f.placeholder ?? ''}
              value={b.auth.config?.(f.name) ?? ''}
              disabled={locked}
              oninput={e => setConfig(b, f.name, e.currentTarget.value)}
            />
            {#if f.help}<small class="field-help">{f.help}</small>{/if}
          </label>
        {/each}

        {@render filenameField(b)}

        <div class="backend-actions">
          {#if authed}
            <button onclick={() => disconnect(b)}>Disconnect</button>
          {:else}
            <button
              class="primary"
              onclick={() => connect(b)}
              disabled={!ready || busy[b.storage.id]}
            >
              {busy[b.storage.id] ? 'Connecting…' : `Connect ${b.storage.label}`}
            </button>
          {/if}
          {#if errors[b.storage.id]}<p class="error">{errors[b.storage.id]}</p>{/if}
        </div>
      </section>
    {/each}

    {#if configurable.length === 0}
      <p class="settings-empty">No storage backends require configuration.</p>
    {/if}

    {#each connectable as b (b.storage.id)}
      {@const authed = b.auth.isAuthenticated()}
      <section class="backend" class:focused={b.storage.id === focusId}>
        <div class="backend-head">
          <span class="backend-name">{b.storage.label}</span>
          {#if authed}
            <span class="badge ok">Connected</span>
          {:else if !b.storage.availability.ok}
            <span class="badge unavailable">Unavailable</span>
          {:else}
            <span class="badge">Ready</span>
          {/if}
        </div>
        {#if b.storage.blurb}<p class="backend-blurb">{b.storage.blurb}</p>{/if}

        {#if b.storage.availability.ok}{@render filenameField(b)}{/if}

        {#if !b.storage.availability.ok}
          <p class="unavailable-reason">{b.storage.availability.reason}</p>
        {:else if authed}
          <div class="backend-actions">
            <button onclick={() => disconnect(b)}>Disconnect</button>
          </div>
        {:else}
          {#if b.auth.credentialFields}
            <form class="creds" onsubmit={e => { e.preventDefault(); connect(b, creds[b.storage.id] ?? {}); }}>
              {#each b.auth.credentialFields as f (f.name)}
                <label class="field">
                  <span class="field-label">{f.label}</span>
                  <input
                    type={f.type ?? 'text'}
                    placeholder={f.placeholder ?? ''}
                    value={creds[b.storage.id]?.[f.name] ?? ''}
                    oninput={e => { creds = { ...creds, [b.storage.id]: { ...(creds[b.storage.id] ?? {}), [f.name]: e.currentTarget.value } }; }}
                  />
                </label>
              {/each}
              <div class="backend-actions">
                <button class="primary" type="submit" disabled={busy[b.storage.id]}>
                  {busy[b.storage.id] ? 'Connecting…' : `Connect ${b.storage.label}`}
                </button>
              </div>
            </form>
          {:else if b.storage.id === 'local'}
            <div class="backend-actions">
              <button class="primary" onclick={() => connect(b)} disabled={busy[b.storage.id]}>
                {busy[b.storage.id] ? 'Opening…' : 'Open file'}
              </button>
              <button onclick={() => connect(b, { mode: 'new' })} disabled={busy[b.storage.id]}>
                New file
              </button>
            </div>
          {:else}
            <div class="backend-actions">
              <button class="primary" onclick={() => connect(b)} disabled={busy[b.storage.id]}>
                {busy[b.storage.id] ? 'Connecting…' : `Connect ${b.storage.label}`}
              </button>
            </div>
          {/if}
          {#if errors[b.storage.id]}<p class="error">{errors[b.storage.id]}</p>{/if}
        {/if}
      </section>
    {/each}
  </div>
{/if}
