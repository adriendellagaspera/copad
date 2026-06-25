<script lang="ts">
  import type { ConnStatus } from '../collaboration/types.js';
  import type { SaveStatus } from './types.js';

  let {
    conn,
    saveStatus,
    hasStorage,
    storageLabel,
    onclick,
  }: {
    conn: ConnStatus;
    saveStatus: SaveStatus;
    hasStorage: boolean;
    storageLabel?: string;
    onclick?: () => void;
  } = $props();

  type Tone = 'muted' | 'ok' | 'warn' | 'danger' | 'accent';
  type Icon = 'offline' | 'spinner' | 'check' | 'cloud' | 'live';

  const state = $derived.by((): { label: string; tone: Tone; icon: Icon; title: string } => {
    if (conn === 'offline')
      return { label: 'Offline', tone: 'warn', icon: 'offline', title: 'No network connection' };
    if (conn === 'connecting')
      return {
        label: 'Connecting…',
        tone: 'muted',
        icon: 'spinner',
        title: 'Connecting to the signaling server',
      };
    // connected or waiting — save status is orthogonal and takes precedence while active.
    if (hasStorage) {
      const where = storageLabel ?? 'storage';
      if (saveStatus === 'error')
        return { label: 'Save failed', tone: 'danger', icon: 'cloud', title: `Could not save to ${where}` };
      if (saveStatus === 'saving')
        return { label: 'Saving…', tone: 'muted', icon: 'spinner', title: `Saving to ${where}` };
      if (saveStatus === 'saved')
        return { label: 'Saved', tone: 'ok', icon: 'check', title: `Saved to ${where}` };
      if (conn === 'waiting')
        return {
          label: 'No peers yet',
          tone: 'muted',
          icon: 'cloud',
          title: `Connected — share the link to collaborate. Autosaving to ${where}`,
        };
      return { label: 'Synced', tone: 'ok', icon: 'cloud', title: `Synced — saving to ${where}` };
    }
    if (conn === 'waiting')
      return {
        label: 'No peers yet',
        tone: 'muted',
        icon: 'live',
        title: 'Connected to signaling — share the link to invite collaborators',
      };
    return {
      label: 'Live',
      tone: 'accent',
      icon: 'live',
      title: 'Peer-to-peer — connect storage to save across sessions',
    };
  });
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
