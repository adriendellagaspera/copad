<script lang="ts">
  import { ConnStatus, Transport } from '../collaboration/types.js';
  import { SaveStatus } from './types.js';

  let {
    conn,
    saveStatus,
    hasStorage,
    storageLabel,
    warning,
    transport,
    encrypted = false,
    keepLabels = false,
    onclick,
  }: {
    conn: ConnStatus;
    saveStatus: SaveStatus;
    hasStorage: boolean;
    storageLabel?: string;
    warning?: string;
    transport: Transport;
    encrypted?: boolean;
    keepLabels?: boolean;
    onclick?: () => void;
  } = $props();

  type Tone = 'muted' | 'ok' | 'warn' | 'danger' | 'accent';
  type ConnIcon = 'offline' | 'spinner' | 'live' | 'unreachable';
  type DurIcon = 'cloudCheck' | 'cloudOff' | 'spinner' | 'warning';

  const isP2P = $derived(transport === Transport.P2P);

  const c = $derived.by(
    (): { label: string; tone: Tone; icon: ConnIcon; pulse: boolean; title: string } => {
      if (conn === ConnStatus.Offline)
        return { label: 'Offline', tone: 'warn', icon: 'offline', pulse: false, title: 'No network connection' };
      if (conn === ConnStatus.Connecting)
        return {
          label: 'Connecting…',
          tone: 'muted',
          icon: 'spinner',
          pulse: false,
          title: 'Reaching the server',
        };
      if (conn === ConnStatus.Unreachable)
        return {
          label: "Can't connect",
          tone: 'danger',
          icon: 'unreachable',
          pulse: false,
          title: "The server didn't answer — click to retry",
        };
      if (conn === ConnStatus.Waiting)
        return {
          label: 'Waiting',
          tone: 'muted',
          icon: 'live',
          pulse: false,
          title: 'Nobody else here yet — share the link to invite someone',
        };
      return {
        label: isP2P ? 'Direct' : 'Relay',
        tone: 'accent',
        icon: 'live',
        pulse: true,
        title: isP2P ? 'Editing live, browser to browser' : 'Editing live, through the server',
      };
    },
  );

  const d = $derived.by(
    (): { label: string; tone: Tone; icon: DurIcon; title: string } => {
      if (warning) return { label: 'Conflict', tone: 'danger', icon: 'warning', title: warning };
      if (hasStorage) {
        const where = storageLabel ?? 'your storage';
        if (saveStatus === SaveStatus.Error)
          return { label: 'Save failed', tone: 'danger', icon: 'cloudOff', title: `Could not save to ${where}` };
        if (saveStatus === SaveStatus.Saving)
          return { label: 'Saving…', tone: 'muted', icon: 'spinner', title: `Saving to ${where}` };
        return {
          label: 'Saved',
          tone: 'accent',
          icon: 'cloudCheck',
          title: `Kept for you in ${where} — your own copy`,
        };
      }
      return {
        label: 'Not saved',
        tone: 'muted',
        icon: 'cloudOff',
        title:
          'Nothing of yours is kept for this room — only a cache that dies with this browser. Connect storage to keep your own copy.',
      };
    },
  );

  const encryptedTitle =
    'End-to-end encrypted — servers only ever see ciphertext';
  const title = $derived(
    `${c.title}\n${d.title}${encrypted ? `\n${encryptedTitle}` : ''}`,
  );
</script>

<svelte:element
  this={onclick ? 'button' : 'span'}
  class="chip"
  class:clickable={!!onclick}
  class:keep-labels={keepLabels}
  type={onclick ? 'button' : undefined}
  role={onclick ? undefined : 'status'}
  aria-live="polite"
  {title}
  {onclick}
>
  <span class="seg conn {c.tone}">
    {#if c.icon === 'spinner'}
      <span class="spinner" aria-hidden="true"></span>
    {:else if c.icon === 'offline'}
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.6M19 13a10 10 0 0 0-4-2.8M12 20h.01" /></svg>
    {:else if c.icon === 'unreachable'}
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><line x1="12" y1="7.5" x2="12" y2="12.5" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
    {:else}
      <span class="live-dot" class:pulse={c.pulse} aria-hidden="true"></span>
    {/if}
    <span class="seg-label">{c.label}</span>
  </span>

  <span class="divider" aria-hidden="true"></span>

  <span class="seg dur {d.tone}">
    {#if d.icon === 'spinner'}
      <span class="spinner" aria-hidden="true"></span>
    {:else if d.icon === 'cloudCheck'}
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 0 1 1.5 8.7" /><path d="M9 14.5l2 2 4-4" /></svg>
    {:else if d.icon === 'cloudOff'}
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H9a7 7 0 0 1-1.4-13.8" /><path d="M11 5.1A7 7 0 0 1 15.7 10h1.8a4.5 4.5 0 0 1 2.3 8.3" /><path d="M3 3l18 18" /></svg>
    {:else}
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>
    {/if}
    <span class="seg-label">{d.label}</span>
  </span>

  {#if encrypted}
    <span class="divider" aria-hidden="true"></span>
    <span class="seg secure accent">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>
      <span class="seg-label">Encrypted</span>
    </span>
  {/if}
</svelte:element>

<style>
  /* Flush, not boxed: the header capsule and the mobile dock already supply the pill. */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    height: 36px;
    min-height: 0;
    padding: 0 10px;
    border-radius: var(--r-full);
    background: transparent;
    font-size: var(--fs-300);
    font-weight: 500;
    line-height: 1.4;
    white-space: nowrap;
    transition: background var(--dur-fast, 120ms) var(--ease, ease);
  }
  .chip.clickable {
    cursor: pointer;
  }
  .chip.clickable:hover {
    background: var(--surface-3);
  }
  .seg {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .seg svg {
    display: block;
  }
  .seg.muted {
    color: var(--text-muted);
  }
  .seg.ok {
    color: var(--ok);
  }
  .seg.warn {
    /* --warn-text, not --warn: --warn is ~3:1 on --surface-2, below AA's 4.5:1 for text. */
    color: var(--warn-text);
  }
  .seg.danger {
    color: var(--danger);
  }
  .seg.accent {
    color: var(--accent);
  }
  .divider {
    width: 1px;
    align-self: stretch;
    margin: 0.15rem 0;
    background: var(--border);
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
  }
  .live-dot.pulse {
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
  @media (prefers-reduced-motion: reduce) {
    .live-dot.pulse {
      animation: none;
    }
  }
  /* Clipped rather than removed, so screen readers still announce the labels. */
  @media (max-width: 720px) {
    .chip:not(.keep-labels) .seg-label {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
      border: 0;
    }
  }
</style>
