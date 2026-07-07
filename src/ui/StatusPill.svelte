<script lang="ts">
  import { ConnStatus, Transport } from '../collaboration/types.js';
  import { SaveStatus } from './types.js';

  // One status chip, two orthogonal facts — the single glanceable answer to
  // "is what I write reaching anyone, and is it kept for me?".
  //
  //   ┌ connection ┄┄┄┄┄┄┄┄┄┄┄┐   ┌ durability ┄┄┄┄┄┄┄┄┄┐
  //   ●  Direct / Alone / …        ☁⃠ Not saved / ☁✓ Saved
  //
  // These are independent axes (I can be connected live yet Not saved), so the
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
    encrypted = false,
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
    /** This room is end-to-end encrypted (a per-room key is in effect). When true a
     *  third shield segment appears — a privacy fact that *varies per room*, unlike
     *  the transport, which the connection segment already states as Direct/Relay.
     *  Only shown when true, so public rooms keep the chip to two signals. */
    encrypted?: boolean;
    onclick?: () => void;
  } = $props();

  type Tone = 'muted' | 'ok' | 'warn' | 'danger' | 'accent';
  type ConnIcon = 'offline' | 'spinner' | 'live';
  // Durability on a single cloud/sync axis so the state reads even wordless (the
  // form used on mobile): cloud-check = kept in storage, cloud-off = not kept
  // (muted for live-only by design, danger for a failed save). Conflict keeps a
  // distinct alert triangle — it's an error, not a point on the kept/not-kept axis.
  type DurIcon = 'cloudCheck' | 'cloudOff' | 'spinner' | 'warning';

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
          return { label: 'Save failed', tone: 'danger', icon: 'cloudOff', title: `Could not save to ${where}` };
        if (saveStatus === SaveStatus.Saving)
          return { label: 'Saving…', tone: 'muted', icon: 'spinner', title: `Saving to ${where}` };
        return {
          label: 'Saved',
          tone: 'accent',
          icon: 'cloudCheck',
          title: `Kept for you in ${where}. Collaborators edit live but can’t write to your storage.`,
        };
      }
      return {
        label: 'Not saved',
        tone: 'muted',
        icon: 'cloudOff',
        title:
          'Not saved — you edit live and a copy is cached on this device, but nothing of yours is kept for this room. Connect a storage backend to keep your own copy.',
      };
    },
  );

  const encryptedTitle =
    'End-to-end encrypted — your content is scrambled in your browser with this room’s key; relays and the signaling server only ever see ciphertext.';
  const title = $derived(
    `${c.title}\n${d.title}${encrypted ? `\n${encryptedTitle}` : ''}`,
  );
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
    {:else if d.icon === 'cloudCheck'}
      <!-- Cloud + check = kept in your storage. -->
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 0 1 1.5 8.7" /><path d="M9 14.5l2 2 4-4" /></svg>
    {:else if d.icon === 'cloudOff'}
      <!-- Cloud with a slash = not kept in storage (the universal "not stored"). -->
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H9a7 7 0 0 1-1.4-13.8" /><path d="M11 5.1A7 7 0 0 1 15.7 10h1.8a4.5 4.5 0 0 1 2.3 8.3" /><path d="M3 3l18 18" /></svg>
    {:else}
      <!-- Conflict — a distinct alert, off the kept/not-kept axis. -->
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>
    {/if}
    <span class="seg-label">{d.label}</span>
  </span>

  {#if encrypted}
    <!-- Third segment, shown only when the room is E2E-encrypted — a privacy fact
         that varies per room. A shield reads even wordless on mobile. -->
    <span class="divider" aria-hidden="true"></span>
    <span class="seg secure accent">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>
      <span class="seg-label">Encrypted</span>
    </span>
  {/if}
</svelte:element>

<style>
  /* Flush segment, not a boxed chip — it lives inside the header capsule
     (or the mobile dock), which already supplies the pill; a border/fill
     here would nest one pill inside another. Each segment colours only its
     own icon + label, so two tones coexist without competing background
     tints (Linear-style). */
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
    /* --warn-text, not --warn: this colors the visible label text (~3:1 on
       --surface-2 with --warn, below AA's 4.5:1 for normal text). */
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
  /* On a touch/narrow header the chip collapses to two glyphs — a connection dot and
     the cloud/sync durability icon (the mockup's "puce colorée qu'on lit sans la
     lire"). The cloud-off / cloud-check pair reads wordless, and #115's IntroDialog
     has already taught the concept on entry; full detail is one tap away. Labels are
     clipped (not display:none) so screen readers still announce them. */
  @media (max-width: 720px) {
    .seg-label {
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
