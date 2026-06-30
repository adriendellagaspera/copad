<script lang="ts">
  import type { SessionCredentials, LoginOptions } from './storage/types.js';
  import { OpenMode, InputType, LoginKind } from './storage/types.js';
  import type { StorageBackend } from './storage/index.js';
  import { isConfigured } from './storage/auth.js';

  import type { TurnPrefs } from './collaboration/turn.js';
  import { FallbackTurnPolicy } from './collaboration/types.js';
  import { parseTurnUrl, parseTurnUsername, parseTurnCredential } from './collaboration/parse.js';
  import type { TurnUrl } from './collaboration/types.js';
  import { useI18n } from './i18n/index.svelte.js';

  let {
    backends,
    open = $bindable(false),
    focusId = '',
    localCache = true,
    onCacheChange,
    onCacheClear,
    turnPrefs,
    onTurnChange,
    languageChoice = 'auto',
    spellcheck = true,
    onLanguageChange,
    onSpellcheckChange,
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
    languageChoice?: string;
    spellcheck?: boolean;
    onLanguageChange?: (lang: string) => void;
    onSpellcheckChange?: (on: boolean) => void;
    onchange?: () => void;
    onconnect?: (b: StorageBackend) => void;
    ondisconnect?: (b: StorageBackend) => void;
  } = $props();

  const i18n = useI18n();
  const t = $derived(i18n.t);

  // Language — 'auto' means browser language, anything else is a BCP-47 tag.
  // If the stored value isn't one of the preset options, show the custom input.
  // Only the 'auto' label is translated; the language names stay in their native form.
  const LANGUAGE_PRESETS = $derived([
    { value: 'auto', label: t.settings.editor.langAuto },
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
  ]);

  // Values are static; only labels change (for 'auto'). Reading a $derived outside a reactive
  // context is fine in Svelte 5 — it just computes lazily on first access.
  const isPreset = (v: string) => LANGUAGE_PRESETS.some(p => p.value === v);

  // Track the select value separately from the raw custom text input.
  let selectValue = $state(isPreset(languageChoice) ? languageChoice : 'custom');
  let customValue = $state(isPreset(languageChoice) ? '' : languageChoice);

  // Re-sync when the prop changes (drawer re-opens with fresh data).
  $effect(() => {
    if (open) {
      selectValue = isPreset(languageChoice) ? languageChoice : 'custom';
      customValue = isPreset(languageChoice) ? '' : languageChoice;
    }
  });

  function onSelectLanguage(value: string) {
    selectValue = value;
    if (value !== 'custom') {
      customValue = '';
      onLanguageChange?.(value);
    }
  }

  function onCustomLanguage(value: string) {
    customValue = value;
    if (value.trim()) onLanguageChange?.(value.trim());
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

  // Raw form strings (IO boundary — not TurnPrefs). Re-synced from the prop when
  // the drawer opens; converted to domain types only when the user hits Apply.
  let rawUrl = $state('');
  let rawUsername = $state('');
  let rawCredential = $state('');
  let turnFallback = $state<FallbackTurnPolicy>(FallbackTurnPolicy.OpenRelay);
  $effect(() => {
    if (open) {
      rawUrl = (turnPrefs?.urls ?? []).join(', ');
      rawUsername = turnPrefs?.username ?? '';
      rawCredential = turnPrefs?.credential ?? '';
      turnFallback = turnPrefs?.fallback ?? FallbackTurnPolicy.OpenRelay;
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

  async function connect(b: StorageBackend, opts?: LoginOptions) {
    busy = { ...busy, [b.storage.id]: true };
    errors = { ...errors, [b.storage.id]: '' };
    try {
      await b.auth.login(opts);
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
  <div class="settings" role="dialog" aria-modal="true" aria-label={t.settings.title}>
    <header class="settings-head">
      <h2>{t.settings.title}</h2>
      <button class="icon-btn" onclick={close} aria-label={t.settings.closeLabel}>✕</button>
    </header>

    <p class="settings-lead">{t.settings.lead}</p>

    <section class="backend">
      <div class="backend-head">
        <span class="backend-name">{t.settings.editor.title}</span>
      </div>
      <p class="backend-blurb">{t.settings.editor.blurb}</p>
      <label class="field">
        <span class="field-label">{t.settings.editor.language}</span>
        <select
          value={selectValue}
          onchange={e => onSelectLanguage(e.currentTarget.value)}
        >
          {#each LANGUAGE_PRESETS as p (p.value)}
            <option value={p.value}>{p.label}</option>
          {/each}
          <option value="custom">{t.settings.editor.langCustom}</option>
        </select>
        {#if selectValue === 'custom'}
          <input
            class="custom-lang"
            placeholder={t.settings.editor.langCustomPlaceholder}
            value={customValue}
            oninput={e => onCustomLanguage(e.currentTarget.value)}
          />
        {/if}
        <small class="field-help">{t.settings.editor.langHelp(navigator.language)}</small>
      </label>
      <label class="toggle">
        <input
          type="checkbox"
          checked={spellcheck}
          onchange={e => onSpellcheckChange?.(e.currentTarget.checked)}
        />
        <span>{t.settings.editor.spellcheck}</span>
      </label>
      <small class="field-help">{t.settings.editor.spellcheckHelp}</small>
    </section>

    <section class="backend">
      <div class="backend-head">
        <span class="backend-name">{t.settings.cache.title}</span>
        <span class="badge {localCache ? 'ok' : ''}">{localCache ? t.settings.cache.on : t.settings.cache.off}</span>
      </div>
      <p class="backend-blurb">{t.settings.cache.blurb}</p>
      <label class="toggle">
        <input
          type="checkbox"
          checked={localCache}
          onchange={e => onCacheChange?.(e.currentTarget.checked)}
        />
        <span>{t.settings.cache.toggle}</span>
      </label>
      <small class="field-help">
        {t.settings.cache.helpPrefix} <strong>{t.settings.cache.helpUnencrypted}</strong> {t.settings.cache.helpSuffix}
      </small>
      <div class="backend-actions">
        <button onclick={clearCache} disabled={clearing}>
          {clearing ? t.settings.cache.clearing : t.settings.cache.clear}
        </button>
      </div>
    </section>

    {#if onTurnChange}
      <section class="backend">
        <div class="backend-head">
          <span class="backend-name">{t.settings.turn.title}</span>
        </div>
        <p class="backend-blurb">{t.settings.turn.blurb}</p>
        <label class="toggle">
          <input
            type="checkbox"
            checked={turnFallback === FallbackTurnPolicy.OpenRelay}
            onchange={e => (turnFallback = e.currentTarget.checked ? FallbackTurnPolicy.OpenRelay : FallbackTurnPolicy.None)}
          />
          <span>{t.settings.turn.fallbackToggle}</span>
        </label>
        <label class="field">
          <span class="field-label">{t.settings.turn.urlLabel}</span>
          <input
            placeholder={t.settings.turn.urlPlaceholder}
            value={rawUrl}
            oninput={e => (rawUrl = e.currentTarget.value)}
          />
          <small class="field-help">{t.settings.turn.urlHelp}</small>
        </label>
        <label class="field">
          <span class="field-label">{t.settings.turn.usernameLabel}</span>
          <input value={rawUsername} oninput={e => (rawUsername = e.currentTarget.value)} />
        </label>
        <label class="field">
          <span class="field-label">{t.settings.turn.credentialLabel}</span>
          <input
            type="password"
            value={rawCredential}
            oninput={e => (rawCredential = e.currentTarget.value)}
          />
        </label>
        <div class="backend-actions">
          <button class="primary" onclick={applyTurn}>{t.settings.turn.apply}</button>
        </div>
      </section>
    {/if}

    {#snippet filenameField(b: StorageBackend)}
      {#if b.storage.setFilename}
        <label class="field">
          <span class="field-label">{t.settings.filename.label}</span>
          <input
            value={filenameOf(b)}
            placeholder={t.settings.filename.placeholder}
            oninput={e => setFilename(b, e.currentTarget.value)}
          />
          <small class="field-help">{t.settings.filename.help}</small>
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
            <span class="badge ok">{t.settings.backends.connected}</span>
          {:else}
            <span class="badge">{ready ? t.settings.backends.ready : t.settings.backends.needsSetup}</span>
          {/if}
        </div>
        {#if b.storage.blurb}<p class="backend-blurb">{b.storage.blurb}</p>{/if}

        {#each b.auth.configFields ?? [] as f (f.name)}
          {@const locked = b.auth.configLocked?.(f.name) ?? false}
          <label class="field">
            <span class="field-label">
              {f.label}
              {#if locked}<span class="lock" title={t.settings.backends.managedTitle}>{t.settings.backends.managed}</span>{/if}
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
            <button onclick={() => disconnect(b)}>{t.settings.backends.disconnect}</button>
          {:else}
            <button
              class="primary"
              onclick={() => connect(b)}
              disabled={!ready || busy[b.storage.id]}
            >
              {busy[b.storage.id] ? t.settings.backends.connecting : t.settings.backends.connect(b.storage.label)}
            </button>
          {/if}
          {#if errors[b.storage.id]}<p class="error">{errors[b.storage.id]}</p>{/if}
        </div>
      </section>
    {/each}

    {#if configurable.length === 0}
      <p class="settings-empty">{t.settings.backends.noConfigurable}</p>
    {/if}

    {#each connectable as b (b.storage.id)}
      {@const authed = b.auth.isAuthenticated()}
      <section class="backend" class:focused={b.storage.id === focusId}>
        <div class="backend-head">
          <span class="backend-name">{b.storage.label}</span>
          {#if authed}
            <span class="badge ok">{t.settings.backends.connected}</span>
          {:else if !b.storage.availability.ok}
            <span class="badge unavailable">{t.settings.backends.unavailable}</span>
          {:else}
            <span class="badge">{t.settings.backends.ready}</span>
          {/if}
        </div>
        {#if b.storage.blurb}<p class="backend-blurb">{b.storage.blurb}</p>{/if}

        {#if b.storage.availability.ok}{@render filenameField(b)}{/if}

        {#if !b.storage.availability.ok}
          <p class="unavailable-reason">{b.storage.availability.reason}</p>
        {:else if authed}
          <div class="backend-actions">
            <button onclick={() => disconnect(b)}>{t.settings.backends.disconnect}</button>
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
                </label>
              {/each}
              <div class="backend-actions">
                <button class="primary" type="submit" disabled={busy[b.storage.id]}>
                  {busy[b.storage.id] ? t.settings.backends.connecting : t.settings.backends.connect(b.storage.label)}
                </button>
              </div>
            </form>
          {:else if b.storage.id === 'local'}
            <div class="backend-actions">
              <button class="primary" onclick={() => connect(b)} disabled={busy[b.storage.id]}>
                {busy[b.storage.id] ? t.settings.backends.opening : t.settings.backends.openFile}
              </button>
              <button onclick={() => connect(b, { kind: LoginKind.Open, mode: OpenMode.New })} disabled={busy[b.storage.id]}>
                {t.settings.backends.newFile}
              </button>
            </div>
          {:else}
            <div class="backend-actions">
              <button class="primary" onclick={() => connect(b)} disabled={busy[b.storage.id]}>
                {busy[b.storage.id] ? t.settings.backends.connecting : t.settings.backends.connect(b.storage.label)}
              </button>
            </div>
          {/if}
          {#if errors[b.storage.id]}<p class="error">{errors[b.storage.id]}</p>{/if}
        {/if}
      </section>
    {/each}
  </div>
{/if}
