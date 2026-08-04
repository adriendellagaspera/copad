/**
 * Widens `Storage.save()`'s contract (`docs/contract.md` §3.2) beyond "threw / didn't
 * throw" — a resolved promise alone doesn't mean the bytes arrived. `WriteReceipt` lets
 * an adapter say what actually happened; `void` (today's behaviour for unmigrated
 * adapters) still means "presumed landing", so the widening is purely additive.
 */

export const WriteLanding = { Landed: 'landed', Skipped: 'skipped' } as const;
export type WriteLanding = (typeof WriteLanding)[keyof typeof WriteLanding];

/** Why a save resolved without writing anything. */
export const WriteSkip = { Coalesced: 'coalesced' } as const;
export type WriteSkip = (typeof WriteSkip)[keyof typeof WriteSkip];

export type WriteReceipt =
  | { readonly landing: typeof WriteLanding.Landed }
  | { readonly landing: typeof WriteLanding.Skipped; readonly why: WriteSkip };

export function landed(): WriteReceipt {
  return { landing: WriteLanding.Landed };
}

export function skipped(why: WriteSkip): WriteReceipt {
  return { landing: WriteLanding.Skipped, why };
}

/**
 * Why a save failed, coarse enough to decide whether it should ever lock the
 * durability branch (`persistHealth.ts`) — never *how* to render it.
 * - `Denied` / `Missing` / `Rejected` — terminal: the world told us no.
 * - `Contended` / `Transient` — may resolve on its own; a streak, not one failure, counts.
 * - `Unknown` — an unmigrated or unclassifiable error; never locks by itself.
 */
export const WriteFailureKind = {
  Denied: 'denied',
  Missing: 'missing',
  Rejected: 'rejected',
  Contended: 'contended',
  Transient: 'transient',
  Unknown: 'unknown',
} as const;
export type WriteFailureKind = (typeof WriteFailureKind)[keyof typeof WriteFailureKind];

/** Thrown by an adapter instead of a bare `Error` so `parseWriteFailure()` (`storage/parse.ts`)
 *  has a single, reliable narrowing site instead of guessing from a message string. */
export class ClassifiedWriteError extends Error {
  readonly kind: WriteFailureKind;
  constructor(kind: WriteFailureKind, message: string) {
    super(message);
    this.name = 'ClassifiedWriteError';
    this.kind = kind;
  }
}

export function writeFailure(kind: WriteFailureKind, message: string): ClassifiedWriteError {
  return new ClassifiedWriteError(kind, message);
}

/** Generic REST status → {@link WriteFailureKind}, shared by the HTTP-backed adapters
 *  (GitHub, GitLab, Google Drive). Each still layers its own semantics on top (e.g.
 *  GitHub's 409 sha conflict) before falling back to this. */
export function classifyHttpStatus(status: number): WriteFailureKind {
  if (status === 401 || status === 403) return WriteFailureKind.Denied;
  if (status === 404) return WriteFailureKind.Missing;
  if (status === 409 || status === 423 || status === 400) return WriteFailureKind.Contended;
  if (status === 429 || status >= 500) return WriteFailureKind.Transient;
  return WriteFailureKind.Unknown;
}
