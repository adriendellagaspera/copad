<script lang="ts">
  import Dialog from './Dialog.svelte';
  import PresenceBar from './PresenceBar.svelte';
  import type { Diagnostics } from '../collaboration/types.js';
  import { ConnStatus, Transport, IceCandidateType } from '../collaboration/types.js';
  import { SaveStatus } from './types.js';
  import type { PeerUser } from './types.js';

  // The detail sheet the status chip opens. It answers the same two questions the
  // chip poses in shorthand — "is my work kept?" and "are my edits reaching anyone?"
  // — but spelled out, and it re-uses the chip's exact glyphs + tones so the two
  // read as one system. Three blocks, top-down: Storage (durability) → Live session
  // (connection + presence) → How edits travel (transport). Raw diagnostics fold
  // into a "Technical details" disclosure so the sheet is clear by default.
  let {
    open,
    onclose,
    transport,
    conn,
    saved,
    saveStatus = SaveStatus.Idle,
    storageLabel,
    warning,
    encrypted = false,
    peers = [],
    getDiagnostics,
    reconnect,
    onConnectStorage,
  }: {
    open: boolean;
    onclose: () => void;
    transport: Transport;
    /** Connection state — mirrors the chip's connection segment. */
    conn: ConnStatus;
    /** Whether this room is Saved to *your own* backend (vs not saved for you). */
    saved: boolean;
    /** Save lifecycle, so a failed save surfaces here too. */
    saveStatus?: SaveStatus;
    storageLabel?: string;
    /** A file-collision warning (another room saves to the same file). */
    warning?: string;
    /** This room is end-to-end encrypted — adds the shield "Encrypted" block. */
    encrypted?: boolean;
    /** Everyone present (including you); rendered as presence avatars. */
    peers?: PeerUser[];
    getDiagnostics?: () => Promise<Diagnostics>;
    reconnect?: () => void;
    /** Open Settings to connect a backend (shown when the room is not saved). */
    onConnectStorage: () => void;
  } = $props();

  let diag = $state<Diagnostics | undefined>(undefined);
  let loading = $state(false);

  async function refresh(): Promise<void> {
    const p = getDiagnostics?.();
    if (!p) return;
    loading = true;
    try {
      diag = await p;
    } catch {
      /* ignore */
    } finally {
      loading = false;
    }
  }

  // Poll while the dialog is open.
  $effect(() => {
    if (!open) return;
    void refresh();
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  });

  function doReconnect(): void {
    reconnect?.();
    setTimeout(refresh, 600);
  }

  const isP2P = $derived(transport === Transport.P2P);
  const others = $derived(peers.filter((p) => !p.self));

  // ── Storage block (durability) — same glyphs/tones as the chip ───────────────
  type StoreIcon = 'cloudCheck' | 'cloudOff' | 'warning';
  const store = $derived.by(
    (): { tone: string; icon: StoreIcon; head: string; sub: string; cta: boolean } => {
      if (warning)
        return { tone: 'danger', icon: 'warning', head: 'File conflict', sub: warning, cta: false };
      const where = storageLabel ?? 'your storage';
      if (saved && saveStatus === SaveStatus.Error)
        return {
          tone: 'danger',
          icon: 'cloudOff',
          head: 'Save failed',
          sub: `Couldn't save to ${where}. Your edits are still live and cached on this device; Copad keeps retrying.`,
          cta: false,
        };
      if (saved)
        return {
          tone: 'accent',
          icon: 'cloudCheck',
          head: `Saved to ${where}`,
          sub: "A copy of this room is kept for you. Collaborators edit live, but can't write to your storage, and peers who join later won't see it unless they're here now.",
          cta: false,
        };
      return {
        tone: 'muted',
        icon: 'cloudOff',
        head: 'Not saved',
        sub: 'You edit live and a copy is cached on this device, but nothing of yours is kept for this room. Connect a storage backend to keep your own copy.',
        cta: true,
      };
    },
  );

  // ── Live session block (connection + liveness) — mirrors the chip's dot ───────
  const live = $derived.by(
    (): { tone: string; spinner: boolean; pulse: boolean; head: string; sub: string } => {
      if (conn === ConnStatus.Offline)
        return { tone: 'warn', spinner: false, pulse: false, head: 'Offline', sub: 'No network connection — reconnecting when you’re back online.' };
      if (conn === ConnStatus.Connecting)
        return {
          tone: 'muted',
          spinner: true,
          pulse: false,
          head: 'Connecting…',
          sub: isP2P ? 'Reaching the signaling server to find peers.' : 'Reaching the collaboration server.',
        };
      if (conn === ConnStatus.Waiting)
        return {
          tone: 'muted',
          spinner: false,
          pulse: false,
          head: 'You’re the only one here',
          sub: 'Share the link to invite someone — you’ll see their edits the moment they join.',
        };
      const n = others.length;
      return {
        tone: 'accent',
        spinner: false,
        pulse: true,
        head: 'Editing live',
        sub: n === 0
          ? 'Connected and syncing in real time.'
          : `${n} other ${n === 1 ? 'person is' : 'people are'} here now — you see each other’s edits instantly.`,
      };
    },
  );

  const showPresence = $derived(
    (conn === ConnStatus.Connected || conn === ConnStatus.Waiting) && peers.length > 0,
  );
</script>

<Dialog {open} {onclose} title="Connection & storage">
  <!-- Storage: is my work kept for me? -->
  <div class="block {store.tone}">
    <span class="block-icon" aria-hidden="true">
      {#if store.icon === 'cloudCheck'}
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 0 1 1.5 8.7" /><path d="M9 14.5l2 2 4-4" /></svg>
      {:else if store.icon === 'cloudOff'}
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 0 1-1.4-13.8" /><path d="M11 5.1A7 7 0 0 1 15.7 10h1.8a4.5 4.5 0 0 1 2.3 8.3" /><path d="M3 3l18 18" /></svg>
      {:else}
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>
      {/if}
    </span>
    <div class="block-body">
      <p class="block-head">{store.head}</p>
      <p class="block-sub">{store.sub}</p>
      {#if store.cta}
        <button class="block-cta" type="button" onclick={() => { onConnectStorage(); onclose(); }}>
          Connect storage
        </button>
      {/if}
    </div>
  </div>

  <!-- Live session: are my edits reaching anyone right now? -->
  <div class="block {live.tone}">
    <span class="block-icon" aria-hidden="true">
      {#if live.spinner}
        <span class="spinner"></span>
      {:else}
        <span class="dot" class:pulse={live.pulse}></span>
      {/if}
    </span>
    <div class="block-body">
      <p class="block-head">{live.head}</p>
      <p class="block-sub">{live.sub}</p>
      {#if showPresence}
        <div class="presence-row">
          <PresenceBar users={peers} />
        </div>
      {/if}
    </div>
  </div>

  <!-- How edits travel: who can see this? (transport — connected nodes / server) -->
  <div class="block muted">
    <span class="block-icon" aria-hidden="true">
      {#if isP2P}
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></svg>
      {:else}
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="7" rx="1.5" /><rect x="3" y="13" width="18" height="7" rx="1.5" /><path d="M7 7.5h.01M7 16.5h.01" /></svg>
      {/if}
    </span>
    <div class="block-body">
      <p class="block-head">{isP2P ? 'Peer-to-peer' : 'Relayed through the server'}</p>
      <p class="block-sub">
        {#if isP2P}
          Edits travel straight between browsers — no server sees your content.
        {:else}
          Edits pass through the collaboration server, which relays them (and can see them);
          a peer who joins later catches up through it.
        {/if}
      </p>
    </div>
  </div>

  <!-- Encryption: shown only when a per-room key is in effect. The shield here is
       the same mark the status chip's third segment uses. -->
  {#if encrypted}
    <div class="block accent">
      <span class="block-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>
      </span>
      <div class="block-body">
        <p class="block-head">End-to-end encrypted</p>
        <p class="block-sub">
          Your content is scrambled in your browser with this room's key. Relaying peers
          and the signaling server only ever see ciphertext — the key never leaves your
          device.
        </p>
      </div>
    </div>
  {/if}

  <details class="tech">
    <summary>Technical details</summary>
    <ul class="diag">
      <li><span>Transport</span><strong>{isP2P ? 'Peer-to-peer (WebRTC)' : 'Relay (server)'}</strong></li>
      <li><span>Signaling</span><strong>{diag?.signaling ? 'Connected' : 'Not connected'}</strong></li>
      <li><span>Peers</span><strong>{diag?.peers ?? 0}</strong></li>
    </ul>

    {#if isP2P}
      {#if diag && diag.connections.length}
        <ul class="diag-peers">
          {#each diag.connections as c (c.id)}
            <li>
              <code>{c.id.slice(0, 8)}</code>
              <span class="conn-type {c.type}">
                {c.type === IceCandidateType.Relay
                  ? 'Relayed via TURN'
                  : c.type === IceCandidateType.Direct
                    ? 'Direct'
                    : 'Negotiating…'}
              </span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="diag-note">No peer connections yet — share the link to invite someone.</p>
      {/if}
      <p class="diag-help">
        "Relayed via TURN" means your network blocked a direct path — common on mobile.
        If peers can't connect at all, add a TURN relay in Settings.
      </p>
    {/if}

    <div class="diag-actions">
      <button onclick={doReconnect} disabled={!reconnect}>Reconnect</button>
      {#if loading}<span class="diag-loading">refreshing…</span>{/if}
    </div>
  </details>
</Dialog>

<style>
  /* Info block: a tone-tinted icon bubble + body. The icon and tone match the
     status chip that opened this sheet, so the two read as one system. */
  .block {
    display: flex;
    gap: var(--sp-3);
    padding: var(--sp-3) 0;
    border-bottom: 1px solid var(--surface-3);
  }
  .block:last-of-type {
    border-bottom: none;
  }
  .block-icon {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    border-radius: var(--r-full);
    background: var(--surface-3);
    color: var(--text-muted);
  }
  .block.accent .block-icon {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .block.danger .block-icon {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .block.warn .block-icon {
    background: var(--warn-soft);
    color: var(--warn);
  }
  .block-icon svg {
    display: block;
  }
  .block-body {
    min-width: 0;
    flex: 1;
  }
  .block-head {
    margin: 0;
    font-size: var(--fs-400);
    font-weight: 600;
    color: var(--text);
  }
  .block.accent .block-head {
    color: var(--accent);
  }
  .block.danger .block-head {
    color: var(--danger);
  }
  .block-sub {
    margin: var(--sp-1) 0 0;
    color: var(--text-muted);
    font-size: var(--fs-300);
    line-height: 1.5;
  }
  .block-cta {
    margin-top: var(--sp-3);
    padding: 0.35rem 0.9rem;
    border: 1px solid var(--accent);
    border-radius: var(--r-full);
    background: var(--accent);
    color: var(--on-accent, #fff);
    font-size: var(--fs-300);
    font-weight: 600;
    cursor: pointer;
  }
  .block-cta:hover {
    filter: brightness(1.05);
  }
  .presence-row {
    margin-top: var(--sp-2);
  }
  /* Connection glyphs — the same dot/spinner the chip uses. */
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: currentColor;
  }
  .dot.pulse {
    box-shadow: 0 0 0 0 currentColor;
    animation: dlg-pulse 2s var(--ease) infinite;
  }
  .spinner {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-top-color: transparent;
    animation: dlg-spin 0.7s linear infinite;
  }
  @keyframes dlg-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes dlg-pulse {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 50%, transparent);
    }
    70% {
      box-shadow: 0 0 0 6px transparent;
    }
    100% {
      box-shadow: 0 0 0 0 transparent;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dot.pulse {
      animation: none;
    }
  }

  /* Technical details — folded away by default. */
  .tech {
    margin-top: var(--sp-3);
  }
  .tech summary {
    cursor: pointer;
    color: var(--text-muted);
    font-size: var(--fs-300);
    font-weight: 500;
    padding: var(--sp-2) 0;
    user-select: none;
  }
  .tech summary:hover {
    color: var(--text);
  }
  .diag,
  .diag-peers {
    list-style: none;
    margin: var(--sp-2) 0 var(--sp-3);
    padding: 0;
  }
  .diag li {
    display: flex;
    justify-content: space-between;
    gap: var(--sp-3);
    padding: 0.3rem 0;
    border-bottom: 1px solid var(--surface-3);
    font-size: var(--fs-300);
  }
  .diag li span {
    color: var(--text-muted);
  }
  .diag-peers li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.25rem 0;
    border-bottom: 1px solid var(--surface-3);
  }
  .diag-peers code {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .conn-type {
    font-size: var(--fs-300);
    font-weight: 500;
  }
  .conn-type.relay {
    color: var(--warn, var(--accent));
  }
  .conn-type.direct {
    color: var(--ok, var(--accent));
  }
  .diag-note,
  .diag-help {
    margin: var(--sp-2) 0;
    color: var(--text-muted);
    font-size: var(--fs-300);
    line-height: 1.5;
  }
  .diag-help {
    color: var(--text-faint);
    font-size: 0.75rem;
  }
  .diag-actions {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    margin-top: var(--sp-3);
  }
  .diag-loading {
    color: var(--text-faint);
    font-size: 0.75rem;
  }
</style>
