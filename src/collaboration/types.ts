import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

export interface Collab {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  destroy(): void;
}

export type CollabConnect = (room: string) => Collab;
