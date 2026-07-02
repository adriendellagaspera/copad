import { describe, it, expect } from 'vitest';
import { persistTargetKey, isPersistLeader } from './leader.js';
import type { BrowserId } from './browserId.js';
import type { PersistTarget, PeerAwarenessState } from './types.js';
import type { StorageId, Filename } from '../storage/types.js';
import { SessionRole } from './types.js';

const INSTALL_A = 'browser-a' as BrowserId;
const INSTALL_B = 'browser-b' as BrowserId;
const DROPBOX = 'dropbox' as StorageId;
const GITHUB = 'github' as StorageId;
const DOC = 'document.yjs' as Filename;

function persister(target: PersistTarget | undefined, canPersist = true): PeerAwarenessState {
  return {
    user: { name: 'x' as never, color: '#000000' as never },
    role: SessionRole.Writer,
    canPersist,
    ...(target ? { persistTarget: target } : {}),
  };
}

describe('persistTargetKey', () => {
  it('is deterministic for the same inputs', () => {
    expect(persistTargetKey(INSTALL_A, DROPBOX, DOC)).toBe(persistTargetKey(INSTALL_A, DROPBOX, DOC));
  });

  it('differs for different browsers (two accounts → distinct files)', () => {
    expect(persistTargetKey(INSTALL_A, DROPBOX, DOC)).not.toBe(persistTargetKey(INSTALL_B, DROPBOX, DOC));
  });

  it('differs for different backends', () => {
    expect(persistTargetKey(INSTALL_A, DROPBOX, DOC)).not.toBe(persistTargetKey(INSTALL_A, GITHUB, DOC));
  });

  it('differs for different filenames', () => {
    expect(persistTargetKey(INSTALL_A, DROPBOX, DOC)).not.toBe(
      persistTargetKey(INSTALL_A, DROPBOX, 'other.md' as Filename),
    );
  });
});

describe('isPersistLeader', () => {
  const T = persistTargetKey(INSTALL_A, DROPBOX, DOC);
  const U = persistTargetKey(INSTALL_B, GITHUB, DOC);

  it('is not a leader when not persisting (no target)', () => {
    expect(isPersistLeader(5, undefined, new Map([[5, persister(undefined, false)]]))).toBe(false);
  });

  it('is the leader when alone on its target', () => {
    expect(isPersistLeader(5, T, new Map([[5, persister(T)]]))).toBe(true);
  });

  it('the lowest clientID leads among peers sharing a target', () => {
    const states = new Map([[3, persister(T)], [5, persister(T)]]);
    expect(isPersistLeader(3, T, states)).toBe(true);
    expect(isPersistLeader(5, T, states)).toBe(false);
  });

  it('peers on distinct targets each lead their own (no starving)', () => {
    const states = new Map([[3, persister(U)], [5, persister(T)]]);
    // clientID 5 has a *higher* id but a different target than 3 → still leads T.
    expect(isPersistLeader(5, T, states)).toBe(true);
    expect(isPersistLeader(3, U, states)).toBe(true);
  });

  it('ignores peers that share the target but cannot persist', () => {
    const states = new Map([[3, persister(T, false)], [5, persister(T)]]);
    expect(isPersistLeader(5, T, states)).toBe(true);
  });

  it('leads even if self is not yet reflected in the states map', () => {
    expect(isPersistLeader(5, T, new Map())).toBe(true);
  });
});
