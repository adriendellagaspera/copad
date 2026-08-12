// Why a resolved save() isn't proof of durability: docs/contract.md §3.2.

export const WriteLanding = { Landed: 'landed', Skipped: 'skipped' } as const;
export type WriteLanding = (typeof WriteLanding)[keyof typeof WriteLanding];

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

// Which kinds lock the durability branch: `LOCKING_KINDS` in persistHealth.ts.
export const WriteFailureKind = {
  Denied: 'denied',
  Missing: 'missing',
  Rejected: 'rejected',
  Contended: 'contended',
  Transient: 'transient',
  Unknown: 'unknown',
} as const;
export type WriteFailureKind = (typeof WriteFailureKind)[keyof typeof WriteFailureKind];

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

export function classifyHttpStatus(status: number): WriteFailureKind {
  if (status === 401 || status === 403) return WriteFailureKind.Denied;
  if (status === 404) return WriteFailureKind.Missing;
  if (status === 409 || status === 423 || status === 400) return WriteFailureKind.Contended;
  if (status === 429 || status >= 500) return WriteFailureKind.Transient;
  return WriteFailureKind.Unknown;
}
