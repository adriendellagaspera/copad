<script lang="ts">
  import type { SessionCredentials, LoginOptions, StorageId } from './storage/types.js';
  import { OpenMode, InputType, LoginKind } from './storage/types.js';
  import type { StorageBackend } from './storage/index.js';
  import { isConfigured } from './storage/auth.js';
  import { STORAGE_ID } from './storage/constants.js';

  import type { TurnPrefs, TurnUrlDraft } from './collaboration/turn.js';
  import { TurnRelayStatus, turnRelayStatus } from './collaboration/turn.js';
  import { FallbackTurnPolicy } from './collaboration/types.js';
  import { parseTurnUrl, parseTurnUsername, parseTurnCredential } from './collaboration/parse.js';
  import type { TurnUrl } from './collaboration/types.js';
  import type { Theme } from './ui/theme.svelte.js';
  import { LANGUAGE_AUTO, parseLanguageChoice, type LanguageChoice } from './ui/language.svelte.js';
  import ThemeSelect from './ui/ThemeSelect.svelte';
  import ExportFormats from './ui/ExportFormats.svelte';
  import type { Toasts } from './ui/toasts.svelte.js';
  import { BRAND_ICONS } from './ui/brandIcons.js';
  import { GENERIC_ICONS } from './ui/genericStorageIcons.js';
  import { IMAGE_ICONS, SHAREPOINT_SITE_IMAGE, SHAREPOINT_ONEDRIVE_IMAGE } from './ui/imageIcons.js';
  import type { Filename } from './storage/types.js';

  import Dialog from './ui/Dialog.svelte';
  import BrowseDialog from './ui/BrowseDialog.svelte';

  type SettingsView = 'app' | 'storage';

  let {
    backends,
    open = $bindable(false),
    focusId,
    theme,
    localCache = true,
    onCacheChange,
    onCacheClear,
    turnPrefs,
    onTurnChange,
    focusAdvanced = false,
    languageChoice = LANGUAGE_AUTO,
    spellcheck = true,
    onLanguageChange,
    onSpellcheckChange,
    exportBaseName,
    toasts,
    onchange,
    onconnect,
    ondisconnect,
    onimport,
  }: {
    backends: StorageBackend[];
    open?: boolean;
    focusId?: StorageId;
    theme: Theme;
    localCache?: boolean;
    onCacheChange?: (on: boolean) => void;
    onCacheClear?: () => void | Promise<void>;
    turnPrefs?: TurnPrefs;
    onTurnChange?: (p: TurnPrefs) => void;
    focusAdvanced?: boolean;
    languageChoice?: LanguageChoice;
    spellcheck?: boolean;
    onLanguageChange?: (lang: LanguageChoice) => void;
    onSpellcheckChange?: (on: boolean) => void;
    exportBaseName: string;
    toasts: Toasts;
    onchange?: () => void;
    onconnect?: (b: StorageBackend) => void;
    ondisconnect?: (b: StorageBackend) => void;
    onimport?: (bytes: Uint8Array, filename: Filename) => void;
  } = $props();

  let browseTarget = $state<StorageBackend | null>(null);

  const LANGUAGE_PRESETS = [
    { value: 'auto', label: 'Auto (browser language)' },
    { value: 'en', label: 'English' },
    { value: 'fr', label: 'Français' },
    { value: 'es', label: 'Español' },
    { value: 'de', label: 'Deutsch' },
    { value: 'it', label: 'Italiano' },
    { value: 'pt', label: 'Português' },
    { value: 'nl', label: 'Nederlands' },
    { value: 'pl', label: 'Polski' },
    { value: 'ru', label: 'Русский' },
    { value: 'ar', label: 'العربية' },
    { value: 'zh', label: '中文' },
    { value: 'ja', label: '日本語' },
    { value: 'ko', label: '한국어' },
  ];

  const isPreset = (v: string) => LANGUAGE_PRESETS.some(p => p.value === v);

  let selectValue = $state(isPreset(languageChoice) ? languageChoice : 'custom');
  let customValue = $state(isPreset(languageChoice) ? '' : languageChoice);

  let activeView = $state<SettingsView>(focusId ? 'storage' : 'app');

  $effect(() => {
    if (open) {
      selectValue = isPreset(languageChoice) ? languageChoice : 'custom';
      customValue = isPreset(languageChoice) ? '' : languageChoice;
      activeView = focusId ? 'storage' : 'app';
    }
  });

  function onSelectLanguage(value: string) {
    selectValue = value;
    if (value !== 'custom') {
      customValue = '';
      onLanguageChange?.(parseLanguageChoice(value));
    }
  }

  function onCustomLanguage(value: string) {
    customValue = value;
    if (value.trim()) onLanguageChange?.(parseLanguageChoice(value));
  }

  let clearing = $state(false);
  async function clearCache() {
    clearing = true;
    try {
      await onCacheClear?.();
    } finally {
      clearing = false;
    }
  }

  // Raw form strings, not TurnPrefs: parsed into domain types only on Apply.
  let rawUrl = $state('');
  let rawUsername = $state('');
  let rawCredential = $state('');
  let turnFallback = $state<FallbackTurnPolicy>(FallbackTurnPolicy.OpenRelay);
  let advancedOpen = $state(false);
  $effect(() => {
    if (open) {
      rawUrl = (turnPrefs?.urls ?? []).join(', ');
      rawUsername = turnPrefs?.username ?? '';
      rawCredential = turnPrefs?.credential ?? '';
      turnFallback = turnPrefs?.fallback ?? FallbackTurnPolicy.OpenRelay;
      advancedOpen = focusAdvanced || (turnPrefs?.urls.length ?? 0) > 0;
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

  const turnStatus = $derived(turnRelayStatus(rawUrl as TurnUrlDraft, turnFallback));
  const TURN_STATUS_LABEL: Record<TurnRelayStatus, string> = {
    custom: 'Custom relay',
    public: 'Public relay active',
    none: 'No relay configured',
  };

  type StatusRank = 'connected' | 'ready' | 'setup' | 'unavailable';
  const RANK_ORDER: Record<StatusRank, number> = { connected: 0, ready: 1, setup: 2, unavailable: 3 };
  const RANK_LABEL: Record<StatusRank, string> = {
    connected: 'connected',
    ready: 'ready',
    setup: 'needs setup',
    unavailable: 'unavailable',
  };
  function statusRank(b: StorageBackend): StatusRank {
    if (withVersion(b.auth.isAuthenticated())) return 'connected';
    const hasConfigFields = (b.auth.configFields?.length ?? 0) > 0;
    if (hasConfigFields) return withVersion(isConfigured(b.auth)) ? 'ready' : 'setup';
    return b.storage.availability.ok ? 'ready' : 'unavailable';
  }
  const sortedBackends = $derived(
    [...backends].sort((a, b) => RANK_ORDER[statusRank(a)] - RANK_ORDER[statusRank(b)])
  );
  const storageDots = $derived(sortedBackends.map(b => statusRank(b)));
  const storageSummary = $derived.by(() => {
    const counts: Record<StatusRank, number> = { connected: 0, ready: 0, setup: 0, unavailable: 0 };
    for (const b of backends) counts[statusRank(b)]++;
    return (Object.keys(RANK_LABEL) as StatusRank[])
      .filter(rank => counts[rank] > 0)
      .map(rank => `${counts[rank]} ${RANK_LABEL[rank]}`)
      .join(', ');
  });

  let expandedId = $state<StorageId | undefined>(focusId);
  $effect(() => {
    if (open) expandedId = focusId;
  });
  function toggleExpanded(id: StorageId) {
    expandedId = expandedId === id ? undefined : id;
  }
  function monogram(label: string): string {
    return label.charAt(0).toUpperCase();
  }

  let busy = $state<Record<StorageId, boolean>>({});
  let errors = $state<Record<StorageId, string>>({});
  let creds = $state<Record<StorageId, SessionCredentials>>({});
  let fnames = $state<Record<StorageId, string>>({});

  // Backend config/session writes hit plain localStorage, not Svelte state: bump this to force `ready`/`authed` to re-derive.
  let stateVersion = $state(0);
  function withVersion<T>(value: T): T {
    void stateVersion;
    return value;
  }

  function setConfig(b: StorageBackend, name: string, value: string) {
    b.auth.setConfig?.(name, value);
    stateVersion += 1;
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

  // `TypeError: Failed to fetch` is the browser's generic network-error message, usually CORS blocking this origin.
  function friendlyConnectError(e: unknown): string {
    if (e instanceof TypeError && /fetch/i.test(e.message)) {
      return "Couldn't reach the server. This usually means the backend's CORS " +
        'settings don\'t allow requests from this origin. Check the backend\'s CORS ' +
        'configuration, or open the browser console for the underlying network error.';
    }
    if (e instanceof Error) return e.message;
    return 'Connection failed.';
  }

  async function connect(b: StorageBackend, opts?: LoginOptions) {
    busy = { ...busy, [b.storage.id]: true };
    errors = { ...errors, [b.storage.id]: '' };
    try {
      await b.auth.login(opts);
      onconnect?.(b);
    } catch (e) {
      errors = { ...errors, [b.storage.id]: friendlyConnectError(e) };
    } finally {
      busy = { ...busy, [b.storage.id]: false };
      stateVersion += 1;
    }
  }

  function disconnect(b: StorageBackend) {
    b.auth.logout();
    stateVersion += 1;
    ondisconnect?.(b);
  }

  function close() {
    open = false;
  }
</script>

{#snippet generalView()}
  <p class="settings-lead">
    Editor, local copy, and connectivity, grouped here while this register stays small.
  </p>

  <section class="backend">
    <div class="backend-head">
      <span class="backend-name">Editor</span>
    </div>
    <p class="backend-blurb">
      Language and spellchecking settings. The language tells the browser which
      dictionary to use for spellcheck.
    </p>
    <label class="field">
      <span class="field-label">Language</span>
      <select
        value={selectValue}
        onchange={e => onSelectLanguage(e.currentTarget.value)}
      >
        {#each LANGUAGE_PRESETS as p (p.value)}
          <option value={p.value}>{p.label}</option>
        {/each}
        <option value="custom">Other (BCP-47 tag)…</option>
      </select>
      {#if selectValue === 'custom'}
        <input
          class="custom-lang"
          placeholder="e.g. en-GB, zh-TW, pt-BR"
          value={customValue}
          oninput={e => onCustomLanguage(e.currentTarget.value)}
        />
      {/if}
      <small class="field-help">
        Used by the browser's native spellchecker and screen readers.
        "Auto" follows your browser's language setting ({navigator.language}).
      </small>
    </label>
    <label class="toggle">
      <input
        type="checkbox"
        checked={spellcheck}
        onchange={e => onSpellcheckChange?.(e.currentTarget.checked)}
      />
      <span>Enable spellcheck</span>
    </label>
    <small class="field-help">
      Uses your browser's built-in spell checker. Works best with a matching language above.
    </small>
  </section>

  <section class="backend">
    <div class="backend-head">
      <span class="backend-name">Export a copy</span>
    </div>
    <p class="backend-blurb">
      A one-off copy of this document, independent of any connected storage backend.
      Works while read-only.
    </p>
    <ExportFormats baseName={exportBaseName} {toasts} />
  </section>

  <section class="backend">
    <div class="backend-head">
      <span class="backend-name">Appearance</span>
    </div>
    <p class="backend-blurb">Light, dark, or follow your system setting.</p>
    <ThemeSelect {theme} />
  </section>

  <section class="backend">
    <div class="backend-head">
      <span class="backend-name">Local copy</span>
      <span class="badge {localCache ? 'ok' : ''}">{localCache ? 'On' : 'Off'}</span>
    </div>
    <p class="backend-blurb">
      Keep a copy of your documents in this browser so they survive a reload and
      work offline, even with no storage backend connected.
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
    <details class="advanced" bind:open={advancedOpen}>
      <summary class="advanced-summary">
        <span class="advanced-summary-label">Advanced</span>
        <span class="badge {turnStatus === TurnRelayStatus.None ? '' : 'ok'}">{TURN_STATUS_LABEL[turnStatus]}</span>
      </summary>
      <section class="backend advanced-body">
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
            checked={turnFallback === FallbackTurnPolicy.OpenRelay}
            onchange={e => (turnFallback = e.currentTarget.checked ? FallbackTurnPolicy.OpenRelay : FallbackTurnPolicy.None)}
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
    </details>
  {/if}
{/snippet}

{#snippet filenameField(b: StorageBackend)}
      {#if b.storage.setFilename}
        <label class="field">
          <span class="field-label">File name (this room)</span>
          <input
            value={filenameOf(b)}
            placeholder="document.yjs"
            oninput={e => setFilename(b, e.currentTarget.value)}
          />
          <small class="field-help">
            The target file for the current room: each room you own keeps its own document.
            The extension picks the format: .yjs (native), .md, .html, .json (PM), or any
            source/text extension (.txt, .py, .js, .ts, .rs, .go, .yml, …).
            Takes effect on connect.
          </small>
        </label>
      {/if}
    {/snippet}

{#snippet storageView()}
  <p class="settings-lead">
    Configure your storage backends. App keys are saved in this browser and
    reused across sessions: you only set them once.
  </p>

  {#if sortedBackends.length === 0}
    <p class="settings-empty">No storage backends available.</p>
  {/if}

  <div class="tile-grid">
    {#each sortedBackends as b (b.storage.id)}
      {@const hasConfigFields = (b.auth.configFields?.length ?? 0) > 0}
      {@const ready = hasConfigFields ? withVersion(isConfigured(b.auth)) : b.storage.availability.ok}
      {@const authed = withVersion(b.auth.isAuthenticated())}
      {@const expanded = expandedId === b.storage.id}
      {@const image = b.storage.id === STORAGE_ID.sharepoint
        ? (withVersion(b.auth.config?.('siteUrl')) ? SHAREPOINT_SITE_IMAGE : SHAREPOINT_ONEDRIVE_IMAGE)
        : IMAGE_ICONS[b.storage.id]}
      {@const icon = BRAND_ICONS[b.storage.id]}
      {@const generic = GENERIC_ICONS[b.storage.id]}
      <section class="tile" class:expanded class:focused={b.storage.id === focusId}>
        <button
          type="button"
          class="tile-head"
          aria-expanded={expanded}
          onclick={() => toggleExpanded(b.storage.id)}
        >
          {#if image}
            <span class="tile-monogram" aria-hidden="true">
              <img src={image} width="16" height="16" alt="" />
            </span>
          {:else if icon}
            <span class="tile-monogram" class:brand-github={b.storage.id === STORAGE_ID.github} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="#{icon.hex}"><path d={icon.path} /></svg>
            </span>
          {:else if generic}
            <span class="tile-monogram" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{@html generic}</svg>
            </span>
          {:else}
            <span class="tile-monogram" aria-hidden="true">{monogram(b.storage.label)}</span>
          {/if}
          <span class="tile-name">{b.storage.label}</span>
          {#if authed}
            <span class="badge ok">Connected</span>
          {:else if hasConfigFields}
            <span class="badge {ready ? 'ready' : 'warn'}">{ready ? 'Ready' : 'Needs setup'}</span>
          {:else if !b.storage.availability.ok}
            <span class="badge unavailable">Unavailable</span>
          {:else}
            <span class="badge ready">Ready</span>
          {/if}
        </button>

        {#if expanded}
          <div class="tile-body">
            {#if b.storage.blurb}<p class="backend-blurb">{b.storage.blurb}</p>{/if}

            {#if hasConfigFields}
              {#each b.auth.configFields ?? [] as f (f.name)}
                {@const locked = b.auth.configLocked?.(f.name) ?? false}
                <label class="field">
                  <span class="field-label">
                    {f.label}
                    {#if locked}
                      <span class="lock" title="Set by this deployment">
                        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                        managed
                      </span>
                    {/if}
                  </span>
                  <input
                    type={f.type ?? InputType.Text}
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
                  {#if b.storage.list}
                    <button onclick={() => (browseTarget = b)}>Browse…</button>
                  {/if}
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
            {:else}
              {#if b.storage.availability.ok}{@render filenameField(b)}{/if}

              {#if !b.storage.availability.ok}
                <p class="unavailable-reason">{b.storage.availability.reason}</p>
              {:else if authed}
                <div class="backend-actions">
                  <button onclick={() => disconnect(b)}>Disconnect</button>
                </div>
              {:else}
                {#if b.auth.credentialFields}
                  <form class="creds" onsubmit={e => { e.preventDefault(); connect(b, { kind: LoginKind.Credentials, credentials: creds[b.storage.id] ?? {} }); }}>
                    {#each b.auth.credentialFields as f (f.name)}
                      <label class="field">
                        <span class="field-label">{f.label}</span>
                        <input
                          type={f.type ?? InputType.Text}
                          placeholder={f.placeholder ?? ''}
                          value={creds[b.storage.id]?.[f.name] ?? ''}
                          oninput={e => { creds = { ...creds, [b.storage.id]: { ...(creds[b.storage.id] ?? {}), [f.name]: e.currentTarget.value } }; }}
                        />
                        {#if f.help}<small class="field-help">{f.help}</small>{/if}
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
                    <button onclick={() => connect(b, { kind: LoginKind.Open, mode: OpenMode.New })} disabled={busy[b.storage.id]}>
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
            {/if}
          </div>
        {/if}
      </section>
    {/each}
  </div>
{/snippet}

<Dialog {open} onclose={close} title="Settings" size="lg" flush>
  <div class="settings-body">
    <nav class="settings-nav" aria-label="Settings sections">
      <div class="settings-nav-group">
        <span class="settings-nav-label">Application</span>
        <button
          type="button"
          class="settings-nav-item"
          aria-current={activeView === 'app' ? 'page' : undefined}
          onclick={() => (activeView = 'app')}
        >
          General
        </button>
      </div>
      <div class="settings-nav-group">
        <span class="settings-nav-label">Accounts</span>
        <button
          type="button"
          class="settings-nav-item"
          aria-current={activeView === 'storage' ? 'page' : undefined}
          onclick={() => (activeView = 'storage')}
        >
          Storage
          <span class="storage-status-dots" title={storageSummary}>
            {#each storageDots as rank, i (i)}
              <span class="storage-status-dot storage-status-dot--{rank}"></span>
            {/each}
          </span>
        </button>
      </div>
    </nav>
    <div class="settings-detail">
      {#if activeView === 'app'}
        {@render generalView()}
      {:else}
        {@render storageView()}
      {/if}
    </div>
  </div>
</Dialog>

<BrowseDialog
  open={!!browseTarget}
  backend={browseTarget}
  onclose={() => (browseTarget = null)}
  onImport={(bytes, filename) => {
    onimport?.(bytes, filename);
    browseTarget = null;
    close();
  }}
/>
