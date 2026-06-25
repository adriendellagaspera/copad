<script lang="ts">
  let {
    name,
    color,
    size = 28,
    self = false,
  }: { name: string; color: string; size?: number; self?: boolean } = $props();

  const initials = $derived(
    ((name || 'Anonymous')
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('') || '?').toUpperCase()
  );
  const label = $derived(self ? `${name} (you)` : name);
</script>

<span
  class="avatar"
  style="--c:{color}; --s:{size}px"
  title={label}
  aria-label={label}
  role="img"
>
  {initials}
</span>

<style>
  .avatar {
    width: var(--s);
    height: var(--s);
    border-radius: var(--r-full);
    background: var(--c);
    color: #fff;
    display: inline-grid;
    place-items: center;
    font-family: var(--font-ui);
    font-size: calc(var(--s) * 0.36);
    font-weight: 600;
    line-height: 1;
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.3);
    box-shadow: 0 0 0 2px var(--surface-2);
    user-select: none;
    flex-shrink: 0;
  }
</style>
