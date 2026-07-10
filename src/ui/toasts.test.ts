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

  it('refreshes an identical toast instead of stacking a duplicate', () => {
    const t = createToasts();
    const firstId = t.success('Invite link copied to clipboard', 1000);
    expect(t.items).toHaveLength(1);
    vi.advanceTimersByTime(700);
    const secondId = t.success('Invite link copied to clipboard', 1000);
    expect(secondId).toBe(firstId);
    expect(t.items).toHaveLength(1);
    // The timer was reset on the second push, so it should survive past the
    // first push's original 1000ms deadline.
    vi.advanceTimersByTime(700);
    expect(t.items).toHaveLength(1);
    vi.advanceTimersByTime(300);
    expect(t.items).toHaveLength(0);
  });

  it('does not dedupe toasts with different text or kind', () => {
    const t = createToasts();
    t.success('a', 0);
    t.success('b', 0);
    t.info('a', 0);
    expect(t.items).toHaveLength(3);
  });

  it('replaces a differently-worded toast sharing an explicit group', () => {
    const t = createToasts();
    const firstId = t.success('Invite link copied to clipboard', 0, 'share-copy');
    expect(t.items).toHaveLength(1);
    const secondId = t.success('View-only link copied to clipboard', 0, 'share-copy');
    expect(secondId).toBe(firstId);
    expect(t.items).toHaveLength(1);
    expect(t.items[0].text).toBe('View-only link copied to clipboard');
  });

  it('does not group toasts with no group across different text', () => {
    const t = createToasts();
    t.success('Invite link copied to clipboard', 0);
    t.success('View-only link copied to clipboard', 0);
    expect(t.items).toHaveLength(2);
  });

  it('pause() stops the countdown until resume()', () => {
    const t = createToasts();
    const id = t.error('boom', 1000);
    vi.advanceTimersByTime(600);
    t.pause(id);
    // Well past the original 1000ms deadline — still alive because paused.
    vi.advanceTimersByTime(2000);
    expect(t.items).toHaveLength(1);
    t.resume(id);
    // Only the ~400ms remaining from the pause point should be left.
    vi.advanceTimersByTime(399);
    expect(t.items).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(t.items).toHaveLength(0);
  });

  it('resume() re-arms the exact remaining duration, ignoring time spent paused', () => {
    const t = createToasts();
    const id = t.error('boom', 100);
    t.pause(id); // 100ms remaining, frozen
    vi.advanceTimersByTime(10_000); // time passing while paused doesn't count
    expect(t.items).toHaveLength(1);
    t.resume(id);
    vi.advanceTimersByTime(99);
    expect(t.items).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(t.items).toHaveLength(0);
  });

  it('pause()/resume() are no-ops on an unknown or non-expiring toast', () => {
    const t = createToasts();
    const id = t.error('boom', 0); // ttl 0 → never scheduled
    t.pause(id);
    t.resume(id);
    expect(t.items).toHaveLength(1);
    t.pause(999); // never existed
    t.resume(999);
  });
});
