import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createToasts } from './toasts.svelte.js';

describe('toast store', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pushes and dismisses by id', () => {
    const t = createToasts();
    const id = t.push('info', 'hi', 0); // ttl 0 → no auto-dismiss
    expect(t.items).toHaveLength(1);
    expect(t.items[0]).toMatchObject({ kind: 'info', text: 'hi' });
    t.dismiss(id);
    expect(t.items).toHaveLength(0);
  });

  it('auto-expires after its ttl', () => {
    const t = createToasts();
    t.push('error', 'boom', 1000);
    expect(t.items).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(t.items).toHaveLength(0);
  });

  it('helpers set the right kind', () => {
    const t = createToasts();
    t.error('e', 0);
    t.success('s', 0);
    t.info('i', 0);
    expect(t.items.map((x) => x.kind)).toEqual(['error', 'success', 'info']);
  });
});
