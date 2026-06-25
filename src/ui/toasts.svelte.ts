/* Toast store — replaces silent console.warn for user-visible errors.
 * createToasts() returns a plain rune-backed object (no class). */

export type ToastKind = 'error' | 'info' | 'success';
export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

export function createToasts() {
  let items = $state<Toast[]>([]);
  let seq = 0;

  function dismiss(id: number): void {
    items = items.filter((t) => t.id !== id);
  }

  function push(kind: ToastKind, text: string, ttl = 6000): number {
    const id = ++seq;
    items = [...items, { id, kind, text }];
    if (ttl > 0) setTimeout(() => dismiss(id), ttl);
    return id;
  }

  return {
    get items() {
      return items;
    },
    push,
    dismiss,
    error: (text: string, ttl = 9000) => push('error', text, ttl),
    info: (text: string, ttl = 6000) => push('info', text, ttl),
    success: (text: string, ttl = 4000) => push('success', text, ttl),
  };
}

export type Toasts = ReturnType<typeof createToasts>;
