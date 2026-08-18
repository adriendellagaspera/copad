<script lang="ts">
  import type { Zoom } from '../../ui/zoom.svelte.js';

  let { zoom }: { zoom: Zoom } = $props();

  const percent = $derived(Math.round(zoom.factor * 100));
</script>

<div class="zoom">
  <button
    class="zoom-btn"
    onclick={zoom.decrease}
    disabled={percent <= 50}
    aria-label="Zoom out"
    title="Zoom out"
  >−</button>
  <button class="zoom-value" onclick={zoom.reset} title="Reset zoom to 100%">{percent}%</button>
  <button
    class="zoom-btn"
    onclick={zoom.increase}
    disabled={percent >= 200}
    aria-label="Zoom in"
    title="Zoom in"
  >+</button>
</div>

<style>
  .zoom {
    display: flex;
    align-items: center;
    gap: 1px;
  }
  .zoom-btn,
  .zoom-value {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 20px;
    padding: 0 0.3rem;
    border: none;
    background: transparent;
    color: var(--text-faint);
    border-radius: var(--r-sm);
    font: inherit;
    line-height: 1;
    cursor: pointer;
  }
  .zoom-btn {
    width: 20px;
    padding: 0;
  }
  .zoom-value {
    min-width: 2.6em;
    font-variant-numeric: tabular-nums;
  }
  .zoom-btn:hover:not(:disabled),
  .zoom-value:hover {
    color: var(--text-muted);
    background: var(--surface-3);
  }
  .zoom-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
