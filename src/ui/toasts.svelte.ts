/* Toast store — replaces silent console.warn for user-visible errors.
 * createToasts() returns a plain rune-backed object (no class). */

export const ToastKind = { Error: 'error', Info: 'info', Success: 'success' } as const;
export type ToastKind = (typeof ToastKind)[keyof typeof ToastKind];
export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

export function createToasts() {
  let items = $state<Toast[]>([]);
  let seq = 0;
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  function dismiss(id: number): void {
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.delete(id);
    items = items.filter((t) => t.id !== id);
  }

  function push(kind: ToastKind, text: string, ttl = 6000): number {
    // Refresh an identical toast already on screen instead of stacking a
    // duplicate — repeatedly clicking "Copy link" (or a debounced autosave
    // error firing again) shouldn't pile up the same message N times.
    const existing = items.find((t) => t.kind === kind && t.text === text);
    if (existing) {
      clearTimeout(timers.get(existing.id));
      if (ttl > 0) timers.set(existing.id, setTimeout(() => dismiss(existing.id), ttl));
      return existing.id;
    }
    const id = ++seq;
    items = [...items, { id, kind, text }];
    if (ttl > 0) timers.set(id, setTimeout(() => dismiss(id), ttl));
    return id;
  }

  return {
    get items() {
      return items;
    },
    push,
    dismiss,
    error: (text: string, ttl = 9000) => push(ToastKind.Error, text, ttl),
    info: (text: string, ttl = 6000) => push(ToastKind.Info, text, ttl),
    success: (text: string, ttl = 4000) => push(ToastKind.Success, text, ttl),
  };
}

export type Toasts = ReturnType<typeof createToasts>;
