<script lang="ts">
  import { slide } from 'svelte/transition';
  import { Transport } from '../collaboration/types.js';

  let {
    transport,
    onShare,
    onConnectStorage,
    onAbout,
  }: {
    /** Gates the encryption claim: the hub relays plaintext (contract §2). */
    transport: Transport;
    /** Invite someone — the action that opens writing (contract §4.2). */
    onShare: () => void;
    /** Open Settings to connect a storage backend. */
    onConnectStorage: () => void;
    /** Open the fuller explanation; the action is hidden while unwired. */
    onAbout?: () => void;
  } = $props();

  // base.css's reduced-motion reset only catches CSS transitions, not Svelte's JS ones.
  const reducedMotion =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
</script>

<!-- No dismiss control: it leaves by being used, never by being refused. -->
<aside class="first-visit" out:slide={{ duration: reducedMotion ? 0 : 200 }}>
  <p class="fv-body">
    <strong>Copad is a room, not a document server.</strong>
    {#if transport === Transport.P2P}
      Your words go browser to browser, end-to-end encrypted.
    {:else}
      Your words pass through this deployment's sync server, which can read them.
    {/if}
    Nothing here is saved yet, and a link shares the room, never your file. Writing alone
    is talking to an empty room, so it stays read-only until someone joins or you connect
    storage.
  </p>
  <div class="fv-actions">
    <button class="fv-cta" onclick={onShare}>Invite someone</button>
    <button class="fv-alt" onclick={onConnectStorage}>Connect storage</button>
    {#if onAbout}
      <button class="fv-more" onclick={onAbout}>How Copad works</button>
    {/if}
  </div>
</aside>

<style>
  .first-visit {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    flex-wrap: wrap;
    padding: var(--sp-2) var(--sp-4);
    margin-bottom: var(--sp-4);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    color: var(--text-muted);
    font-size: var(--fs-300);
    line-height: 1.4;
  }
  .fv-body {
    margin: 0;
    flex: 1 1 22rem;
    line-height: 1.5;
  }
  .fv-body strong {
    color: var(--text);
  }
  .fv-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2);
  }
  .fv-cta {
    padding: 0.34rem 0.9rem;
    border: 1px solid transparent;
    border-radius: var(--r-full);
    background: var(--accent);
    color: var(--accent-contrast);
    font-size: var(--fs-300);
    font-weight: 600;
    line-height: 1.4;
    cursor: pointer;
  }
  .fv-cta:hover {
    background: var(--accent-hover);
  }
  .fv-alt {
    padding: 0.34rem 0.9rem;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-full);
    background: transparent;
    color: var(--text);
    font-size: var(--fs-300);
    font-weight: 600;
    line-height: 1.4;
  }
  .fv-alt:hover {
    background: color-mix(in srgb, var(--text) 7%, transparent);
    border-color: var(--accent);
  }
  .fv-more {
    min-height: 32px;
    padding: 0.34rem 0.4rem;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--fs-300);
    font-weight: 500;
    line-height: 1.4;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .fv-more:hover {
    color: var(--text);
  }
  @media (pointer: coarse) {
    .fv-cta,
    .fv-alt,
    .fv-more {
      min-height: 44px;
    }
  }
</style>
