<script lang="ts">
  import { ConnStatus, Transport } from '../collaboration/types.js';
  import { SaveStatus } from './types.js';

  // One status chip, two orthogonal facts — the single glanceable answer to
  // "is what I write reaching anyone, and is it kept for me?".
  //
  //   ┌ connection ┄┄┄┄┄┄┄┄┄┄┄┐   ┌ durability ┄┄┄┄┄┄┄┄┄┐
  //   ●  Direct / Alone / …        ⚡ Live-only / 💾 Saved
  //
  // These are independent axes (I can be Live+connected yet Live-only), so the
  // chip keeps them as two dots rather than one conflated word. The chip is
  // neutral; each segment carries its own tone via icon/text colour, Linear-style.
  //
  // North-star: the durability half is the signal the mobile epic elevates
  // (#105) — "voice (live) / paper in pocket (saved)". It never promises an absent
  // peer will see live edits. The heavy teaching (IntroDialog) and the loud
  // consequential warning (WriteGate / SyncBanner) live elsewhere; this chip is the
  // quiet, always-present reference — tap opens the detail sheet.
  let {
    conn,
    saveStatus,
    hasStorage,
    storageLabel,
    warning,
    transport,
    onclick,
  }: {
    conn: ConnStatus;
    saveStatus: SaveStatus;
    hasStorage: boolean;
    storageLabel?: string;
    /** A file-collision warning (another room saves to the same file). Outranks
     *  the durability state — the user needs to see it. */
    warning?: string;
    transport: Transport;
    onclick?: () => void;
  } = $props();

  type Tone = 'muted' | 'ok' | 'warn' | 'danger' | 'accent';
  type ConnIcon = 'offline' | 'spinner' | 'live';
  type DurIcon = 'bolt' | 'disk' | 'spinner' | 'cloud' | 'warning';

  const isP2P = $derived(transport === Transport.P2P);
  const transportTitle = $derived(
    isP2P
      ? 'Peer-to-peer — edits travel directly between browsers, no server in the data path'
      : 'Relayed — edits travel through the collaboration server',
  );

  // ── Axis A: connection & liveness (are my edits reaching anyone?) ────────────
  // When connected we lead with the transport (Direct / Relay) — the pulsing dot
  // already says "live", so the word states *how*. Matches the mockup's
  // "Connecté · Direct".
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
          title: isP2P ? 'Connecting to the signaling server' : 'Connecting to the collaboration server',
        };
      if (conn === ConnStatus.Waiting)
        return {
          label: 'Alone',
          tone: 'muted',
          icon: 'live',
          pulse: false,
          title: `${transportTitle}. No peers yet — share the link to invite collaborators`,
        };
      return {
        label: isP2P ? 'Direct' : 'Relay',
        tone: 'accent',
        icon: 'live',
        pulse: true,
        title: `${transportTitle}. Editing live with peers present now`,
      };
    },
  );

  // ── Axis B: durability (is my work kept for me?) ─────────────────────────────
  // The save lifecycle (Saving…/Saved/Save failed) is a facet of durability, so it
  // lives here; live-only is the standing "nothing of mine is kept" fact.
  const d = $derived.by(
    (): { label: string; tone: Tone; icon: DurIcon; title: string } => {
      if (warning) return { label: 'Conflict', tone: 'danger', icon: 'warning', title: warning };
      if (hasStorage) {
        const where = storageLabel ?? 'your storage';
        if (saveStatus === SaveStatus.Error)
          return { label: 'Save failed', tone: 'danger', icon: 'cloud', title: `Could not save to ${where}` };
        if (saveStatus === SaveStatus.Saving)
          return { label: 'Saving…', tone: 'muted', icon: 'spinner', title: `Saving to ${where}` };
        return {
          label: 'Saved',
          tone: 'accent',
          icon: 'disk',
          title: `Kept for you in ${where}. Collaborators edit live but can’t write to your storage.`,
        };
      }
      return {
        label: 'Live-only',
        tone: 'muted',
        icon: 'bolt',
        title:
          'Live-only for you — real-time collaboration + local cache, but nothing of yours saves this room. Connect a storage backend to keep your own copy.',
      };
    },
  );

  const title = $derived(`${c.title}\n${d.title}`);
</script>

<svelte:element
  this={onclick ? 'button' : 'span'}
  class="chip"
  class:clickable={!!onclick}
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
    {:else}
      <span class="live-dot" class:pulse={c.pulse} aria-hidden="true"></span>
    {/if}
    <span class="seg-label">{c.label}</span>
  </span>

  <span class="divider" aria-hidden="true"></span>

  <span class="seg dur {d.tone}">
    {#if d.icon === 'spinner'}
      <span class="spinner" aria-hidden="true"></span>
    {:else if d.icon === 'disk'}
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>
    {:else if d.icon === 'cloud'}
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.5A3.5 3.5 0 0 1 18 18Z" /></svg>
    {:else if d.icon === 'warning'}
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>
    {:else}
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" /></svg>
    {/if}
    <span class="seg-label">{d.label}</span>
  </span>
</svelte:element>

<style>
  /* Neutral chip; each segment colours only its own icon + label, so two tones
     coexist without competing background tints (Linear-style). */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.2rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--r-full);
    background: var(--surface-2);
    font-size: var(--fs-300);
    font-weight: 500;
    line-height: 1.4;
    white-space: nowrap;
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
    color: var(--warn);
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
  /* On a touch/narrow header the connection half recedes to its dot — the mockup's
     "puce colorée qu'on lit sans la lire" — while durability keeps its word, since
     "is my work kept?" is the signal the mobile epic elevates. Full connection
     detail is one tap away in the dialog. */
  @media (max-width: 720px) {
    .seg.conn .seg-label {
      display: none;
    }
  }
</style>
