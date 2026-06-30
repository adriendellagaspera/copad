<script lang="ts">
  import Dialog from './Dialog.svelte';
  import type { Diagnostics } from '../collaboration/types.js';
  import { Transport, IceCandidateType } from '../collaboration/types.js';
  import { useI18n } from '../i18n/index.svelte.js';

  let {
    open,
    onclose,
    transport,
    getDiagnostics,
    reconnect,
  }: {
    open: boolean;
    onclose: () => void;
    transport: Transport;
    getDiagnostics?: () => Promise<Diagnostics>;
    reconnect?: () => void;
  } = $props();

  const i18n = useI18n();
  const t = $derived(i18n.t);

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
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  });

  function doReconnect(): void {
    reconnect?.();
    setTimeout(refresh, 600);
  }
</script>

<Dialog {open} {onclose} title={t.connection.title}>
  <ul class="diag">
    <li>
      <span>{t.connection.transport}</span>
      <strong>{transport === Transport.P2P ? t.connection.p2p : t.connection.relay}</strong>
    </li>
    <li>
      <span>{t.connection.signaling}</span>
      <strong>{diag?.signaling ? t.connection.signalingOk : t.connection.signalingKo}</strong>
    </li>
    <li>
      <span>{t.connection.peers}</span>
      <strong>{diag?.peers ?? 0}</strong>
    </li>
  </ul>

  {#if transport === Transport.P2P}
    {#if diag && diag.connections.length}
      <h3>{t.connection.peerConnections}</h3>
      <ul class="diag-peers">
        {#each diag.connections as c (c.id)}
          <li>
            <code>{c.id.slice(0, 8)}</code>
            <span class="conn-type {c.type}">
              {c.type === IceCandidateType.Relay
                ? t.connection.relayed
                : c.type === IceCandidateType.Direct
                  ? t.connection.direct
                  : t.connection.negotiating}
            </span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="diag-note">{t.connection.noPeers}</p>
    {/if}
    <p class="diag-help">{t.connection.turnHelp}</p>
  {/if}

  <div class="diag-actions">
    <button onclick={doReconnect} disabled={!reconnect}>{t.connection.reconnect}</button>
    {#if loading}<span class="diag-loading">{t.connection.refreshing}</span>{/if}
  </div>
</Dialog>

<style>
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
