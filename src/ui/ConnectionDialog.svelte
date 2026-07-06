<script lang="ts">
  import Dialog from './Dialog.svelte';
  import type { Diagnostics } from '../collaboration/types.js';
  import { Transport, IceCandidateType } from '../collaboration/types.js';

  let {
    open,
    onclose,
    transport,
    saved,
    storageLabel,
    warning,
    getDiagnostics,
    reconnect,
    onConnectStorage,
  }: {
    open: boolean;
    onclose: () => void;
    transport: Transport;
    /** Whether this room is Saved to *your own* backend (vs live-only for you).
     *  The durability half of the status chip that opens this dialog. */
    saved: boolean;
    storageLabel?: string;
    /** A file-collision warning (another room saves to the same file). */
    warning?: string;
    getDiagnostics?: () => Promise<Diagnostics>;
    reconnect?: () => void;
    /** Open Settings to connect a backend (shown when the room is live-only). */
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
</script>

<Dialog {open} {onclose} title="Connection & storage">
  <!-- Durability first: the "is my work kept for me?" half of the chip, spelled out.
       This is the detail the mobile status chip defers to on tap. -->
  <div class="store {warning ? 'conflict' : saved ? 'saved' : 'live'}">
    {#if warning}
      <p class="store-head">File conflict</p>
      <p class="store-sub">{warning}</p>
    {:else if saved}
      <p class="store-head">Saved to {storageLabel ?? 'your storage'}</p>
      <p class="store-sub">
        A copy of this room is kept for you. Collaborators edit live, but can't write to
        your storage, and peers who join later won't see it unless they're here now.
      </p>
    {:else}
      <p class="store-head">Live-only</p>
      <p class="store-sub">
        Real-time collaboration + a local cache on this device, but nothing of yours is
        kept for this room. Connect a storage backend to keep your own copy.
      </p>
      <button class="store-cta" type="button" onclick={() => { onConnectStorage(); onclose(); }}>
        Connect storage
      </button>
    {/if}
  </div>

  <ul class="diag">
    <li>
      <span>Transport</span>
      <strong>{transport === Transport.P2P ? 'Peer-to-peer (WebRTC)' : 'Relay (server)'}</strong>
    </li>
    <li>
      <span>Signaling</span>
      <strong>{diag?.signaling ? 'Connected' : 'Not connected'}</strong>
    </li>
    <li>
      <span>Peers</span>
      <strong>{diag?.peers ?? 0}</strong>
    </li>
  </ul>

  {#if transport === Transport.P2P}
    {#if diag && diag.connections.length}
      <h3>Peer connections</h3>
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
</Dialog>

<style>
  /* Durability summary — tinted by state, mirroring the chip's durability segment. */
  .store {
    margin: 0 0 var(--sp-4);
    padding: var(--sp-3) var(--sp-4);
    border: 1px solid var(--border);
    border-radius: var(--r-md, 8px);
    background: var(--surface-2);
  }
  .store.saved {
    border-color: color-mix(in srgb, var(--accent) 35%, transparent);
    background: var(--accent-soft);
  }
  .store.conflict {
    border-color: color-mix(in srgb, var(--danger) 35%, transparent);
    background: var(--danger-soft);
  }
  .store-head {
    margin: 0;
    font-size: var(--fs-400);
    font-weight: 600;
    color: var(--text);
  }
  .store.saved .store-head {
    color: var(--accent);
  }
  .store.conflict .store-head {
    color: var(--danger);
  }
  .store-sub {
    margin: var(--sp-1) 0 0;
    color: var(--text-muted);
    font-size: var(--fs-300);
    line-height: 1.5;
  }
  .store-cta {
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
  .store-cta:hover {
    filter: brightness(1.05);
  }
  .diag,
  .diag-peers {
    list-style: none;
    margin: 0 0 var(--sp-3);
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
  h3 {
    margin: var(--sp-3) 0 var(--sp-2);
    font-size: var(--fs-400);
    font-weight: 600;
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
