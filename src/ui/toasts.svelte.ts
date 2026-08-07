import { now, type Milliseconds, type EpochMs } from '../time.js';

export const ToastKind = { Error: 'error', Info: 'info', Success: 'success' } as const;
export type ToastKind = (typeof ToastKind)[keyof typeof ToastKind];
export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

const DEFAULT_TTL = 6_000 as Milliseconds;
const ERROR_TTL = 9_000 as Milliseconds;
const INFO_TTL = 6_000 as Milliseconds;
const SUCCESS_TTL = 4_000 as Milliseconds;

export function createToasts() {
  let items = $state<Toast[]>([]);
  let seq = 0;
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const deadlines = new Map<number, EpochMs>();
  const remaining = new Map<number, Milliseconds>();
  // group widens the dedupe key beyond an exact repeat, so related-but-differently-worded toasts swap in place.
  const slots = new Map<number, string>();

  function schedule(id: number, ttl: Milliseconds): void {
    if (ttl <= 0) return;
    deadlines.set(id, (now() + ttl) as EpochMs);
    timers.set(id, setTimeout(() => dismiss(id), ttl));
  }

  function dismiss(id: number): void {
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.delete(id);
    deadlines.delete(id);
    remaining.delete(id);
    slots.delete(id);
    items = items.filter((t) => t.id !== id);
  }

  function pause(id: number): void {
    const deadline = deadlines.get(id);
    if (deadline === undefined) return;
    clearTimeout(timers.get(id));
    timers.delete(id);
    deadlines.delete(id);
    remaining.set(id, Math.max(0, deadline - now()) as Milliseconds);
  }

  function resume(id: number): void {
    const ms = remaining.get(id);
    if (ms === undefined) return;
    remaining.delete(id);
    if (ms > 0) schedule(id, ms);
    else dismiss(id);
  }

  function push(kind: ToastKind, text: string, ttl: Milliseconds = DEFAULT_TTL, group?: string): number {
    const slot = group ?? `${kind} ${text}`;
    const existingId = [...slots].find(([, s]) => s === slot)?.[0];
    if (existingId !== undefined) {
      clearTimeout(timers.get(existingId));
      remaining.delete(existingId);
      items = items.map((t) => (t.id === existingId ? { id: t.id, kind, text } : t));
      schedule(existingId, ttl);
      return existingId;
    }
    const id = ++seq;
    slots.set(id, slot);
    items = [...items, { id, kind, text }];
    schedule(id, ttl);
    return id;
  }

  return {
    get items() {
      return items;
    },
    push,
    dismiss,
    pause,
    resume,
    error: (text: string, ttl: Milliseconds = ERROR_TTL, group?: string) => push(ToastKind.Error, text, ttl, group),
    info: (text: string, ttl: Milliseconds = INFO_TTL, group?: string) => push(ToastKind.Info, text, ttl, group),
    success: (text: string, ttl: Milliseconds = SUCCESS_TTL, group?: string) =>
      push(ToastKind.Success, text, ttl, group),
  };
}

export type Toasts = ReturnType<typeof createToasts>;
