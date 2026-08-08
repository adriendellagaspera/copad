/**
 * Recent documents — rooms this browser has opened, for the header switcher.
 *
 * There is no in-place room switch (see `App.svelte`'s `room`/`newRoom`):
 * opening a different room always means a new tab, so each entry stores the
 * room's full navigable {@link RoomUrl} (including the `#k=` secret-link
 * fragment for encrypted rooms) rather than just its {@link RoomId} — that
 * fragment can't be reconstructed later from the id alone.
 *
 * Persisted under a single localStorage key (not per-backend — this list
 * tracks rooms *opened*, independent of whether any backend saves them).
 */

import type { RoomId, RoomName, RoomUrl } from './types.js';
import type { EpochMs } from '../time.js';
import { now } from '../time.js';
import { localStore, storageKey } from '../persistence/local.js';
import { parseRecentDocs } from './parse.js';

/** One recently-opened room, as shown in the recent-docs switcher. */
export interface RecentDoc {
  readonly room: RoomId;
  readonly url: RoomUrl;
  readonly lastOpened: EpochMs;
  readonly title: RoomName | null;
}

const MAX_RECENT_DOCS = 20;
const RECENT_DOCS_KEY = storageKey('recentDocs');

/** Read/write the local user's recently-opened rooms. */
export interface RecentDocs {
  /** Add or bump `room` to the front (by `lastOpened`), deduping by room. */
  record(entry: { room: RoomId; url: RoomUrl; title: RoomName | null }): void;
  /** Drop `room` from the list. */
  remove(room: RoomId): void;
  /** Every recorded room, most recently opened first. */
  all(): RecentDoc[];
}

/** Persisted recent-docs list for the local user. */
export function recentDocsStore(): RecentDocs {
  const store = localStore<RecentDoc[]>(
    RECENT_DOCS_KEY,
    parseRecentDocs,
    (docs) => (docs.length ? JSON.stringify(docs) : null),
  );
  const byRecency = (a: RecentDoc, b: RecentDoc): number => b.lastOpened - a.lastOpened;
  return {
    record: ({ room, url, title }) => {
      const docs = store.read().filter((d) => d.room !== room);
      docs.push({ room, url, title, lastOpened: now() });
      store.write(docs.sort(byRecency).slice(0, MAX_RECENT_DOCS));
    },
    remove: (room) => store.write(store.read().filter((d) => d.room !== room)),
    all: () => store.read().sort(byRecency),
  };
}
