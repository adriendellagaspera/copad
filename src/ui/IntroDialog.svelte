<script lang="ts">
  import Dialog from './Dialog.svelte';

  let {
    open,
    onclose,
  }: {
    open: boolean;
    onclose: () => void;
  } = $props();
</script>

<Dialog {open} {onclose} title="How Copad sharing works">
  <p class="intro-lead">
    Copad connects collaborators <strong>peer-to-peer</strong>, in real time. There's no
    central server holding your document — edits flow directly between the browsers that
    are open on a room right now.
  </p>

  <div class="intro-point">
    <span class="intro-icon" aria-hidden="true">🟢</span>
    <div>
      <h3>Editing together, live</h3>
      <p>When you and a collaborator have the room open at the same time, you see each
        other's changes instantly.</p>
    </div>
  </div>

  <div class="intro-point">
    <span class="intro-icon" aria-hidden="true">⏳</span>
    <div>
      <h3>Editing at different times</h3>
      <p>If you write while <strong>no one else is connected</strong>, then close the tab,
        a collaborator opening the room later <strong>won't see your changes</strong>. With
        nobody online to sync from, there's nothing to hand over. Your own edits do come
        back when you reopen the room on the same device.</p>
    </div>
  </div>

  <p class="intro-foot">
    Want changes to persist and sync even when you're not online together? Connect the
    room to a shared storage backend (GitHub, Dropbox, …) from <strong>Settings</strong> —
    it becomes the room's durable, shared memory.
  </p>

  <div class="intro-actions">
    <button class="primary" onclick={onclose}>Got it</button>
  </div>
</Dialog>

<style>
  .intro-lead {
    margin: 0 0 var(--sp-4);
    color: var(--text);
    font-size: var(--fs-300);
    line-height: 1.5;
  }
  .intro-point {
    display: flex;
    gap: var(--sp-3);
    margin-bottom: var(--sp-4);
  }
  .intro-icon {
    flex-shrink: 0;
    font-size: 1.25rem;
    line-height: 1.3;
  }
  .intro-point h3 {
    margin: 0 0 var(--sp-1);
    font-size: var(--fs-400);
    font-weight: 600;
  }
  .intro-point p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-300);
    line-height: 1.5;
  }
  .intro-foot {
    margin: 0 0 var(--sp-4);
    padding-top: var(--sp-4);
    border-top: 1px solid var(--border, var(--surface-3));
    color: var(--text-muted);
    font-size: var(--fs-300);
    line-height: 1.5;
  }
  .intro-actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
