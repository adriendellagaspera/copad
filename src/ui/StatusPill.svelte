<script lang="ts">
  import { ConnStatus, Transport } from '../collaboration/types.js';
  import { SaveStatus } from './types.js';
  import { useI18n } from '../i18n/index.svelte.js';

  let {
    conn,
    saveStatus,
    hasStorage,
    storageLabel,
    transport,
    onclick,
  }: {
    conn: ConnStatus;
    saveStatus: SaveStatus;
    hasStorage: boolean;
    storageLabel?: string;
    transport: Transport;
    onclick?: () => void;
  } = $props();

  const i18n = useI18n();
  const t = $derived(i18n.t);

  type Tone = 'muted' | 'ok' | 'warn' | 'danger' | 'accent';
  type Icon = 'offline' | 'spinner' | 'check' | 'cloud' | 'live';

  const isP2P = $derived(transport === Transport.P2P);
  const tag = $derived(isP2P ? t.status.p2p : t.status.relay);
  const transportTitle = $derived(isP2P ? t.status.p2pTitle : t.status.relayTitle);

  const state = $derived.by(
    (): { label: string; tone: Tone; icon: Icon; title: string; tag?: string } => {
      if (conn === ConnStatus.Offline)
        return { label: t.status.offline, tone: 'warn', icon: 'offline', title: t.status.offlineTitle };
      if (conn === ConnStatus.Connecting)
        return {
          label: t.status.connecting,
          tone: 'muted',
          icon: 'spinner',
          title: isP2P ? t.status.connectingP2P : t.status.connectingRelay,
        };
      // connected or waiting — save status is orthogonal and takes precedence while active.
      if (hasStorage) {
        const where = storageLabel ?? 'storage';
        if (saveStatus === SaveStatus.Error)
          return { label: t.status.saveFailed, tone: 'danger', icon: 'cloud', title: t.status.saveFailedTitle(where) };
        if (saveStatus === SaveStatus.Saving)
          return { label: t.status.saving, tone: 'muted', icon: 'spinner', title: t.status.savingTitle(where) };
        if (saveStatus === SaveStatus.Saved)
          return { label: t.status.saved, tone: 'ok', icon: 'check', title: t.status.savedTitle(where) };
        if (conn === ConnStatus.Waiting)
          return {
            label: t.status.noPeers,
            tone: 'muted',
            icon: 'cloud',
            title: t.status.noPeersStorageTitle(where),
            tag,
          };
        return { label: t.status.synced, tone: 'ok', icon: 'cloud', title: t.status.syncedTitle(where), tag };
      }
      if (conn === ConnStatus.Waiting)
        return {
          label: t.status.noPeers,
          tone: 'muted',
          icon: 'live',
          title: t.status.noPeersTitle(transportTitle),
          tag,
        };
      return {
        label: t.status.live,
        tone: 'accent',
        icon: 'live',
        title: t.status.liveTitle(transportTitle),
        tag,
      };
    },
  );
</script>

<svelte:element
  this={onclick ? 'button' : 'span'}
  class="pill {state.tone}"
  class:clickable={!!onclick}
  type={onclick ? 'button' : undefined}
  role={onclick ? undefined : 'status'}
  aria-live="polite"
  title={state.title}
  {onclick}
>
  {#if state.icon === 'spinner'}
    <span class="spinner" aria-hidden="true"></span>
  {:else if state.icon === 'check'}
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7" /></svg>
  {:else if state.icon === 'offline'}
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.6M19 13a10 10 0 0 0-4-2.8M12 20h.01" /></svg>
  {:else if state.icon === 'live'}
    <span class="live-dot" aria-hidden="true"></span>
  {:else}
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.5A3.5 3.5 0 0 1 18 18Z" /></svg>
  {/if}
  <span class="pill-label">{state.label}</span>
  {#if state.tag}
    <span class="transport-tag" title={transportTitle}>{state.tag}</span>
  {/if}
</svelte:element>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.15rem 0.5rem;
    border-radius: var(--r-full);
    font-size: var(--fs-300);
    font-weight: 500;
    line-height: 1.4;
    white-space: nowrap;
  }
  .pill.muted {
    color: var(--text-muted);
    background: var(--surface-3);
  }
  .pill.ok {
    color: var(--ok);
    background: var(--ok-soft);
  }
  .pill.warn {
    color: var(--warn);
    background: var(--warn-soft);
  }
  .pill.danger {
    color: var(--danger);
    background: var(--danger-soft);
  }
  .pill.accent {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .pill.clickable {
    border: none;
    cursor: pointer;
  }
  .pill.clickable:hover {
    filter: brightness(0.96);
  }
  .pill svg {
    display: block;
  }
  .transport-tag {
    font-size: var(--fs-200, 0.6875rem);
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    opacity: 0.7;
    padding-left: 0.3rem;
    margin-left: 0.05rem;
    border-left: 1px solid currentColor;
    /* keep the divider subtle against the pill background */
    border-color: color-mix(in srgb, currentColor 35%, transparent);
  }
  .spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-top-color: transparent;
    animation: pill-spin 0.7s linear infinite;
  }
  .live-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 0 0 currentColor;
    animation: live-pulse 2s var(--ease) infinite;
  }
  @keyframes pill-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes live-pulse {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 50%, transparent);
    }
    70% {
      box-shadow: 0 0 0 5px transparent;
    }
    100% {
      box-shadow: 0 0 0 0 transparent;
    }
  }
</style>
