// `--presence-fade` (0 = just active, 1 = fully idle) is turned into opacity by editor.css: an idle peer dims rather than disappears; only leaving the room removes their cursor.

import type { DecorationAttrs } from 'prosemirror-view';
import type { PeerUser, CursorColor } from '../../collaboration/types.js';
import { fadeTier, type PresenceActivity } from '../../collaboration/presenceActivity.js';

export const PRESENCE_ATTR = 'data-presence-client';

export function remoteCursorBuilder(activity: PresenceActivity) {
  return (user: PeerUser, clientId: number): HTMLElement => {
    const cursor = document.createElement('span');
    cursor.classList.add('ProseMirror-yjs-cursor');
    cursor.setAttribute(PRESENCE_ATTR, String(clientId));
    cursor.style.borderColor = user.color;
    cursor.style.setProperty('--presence-fade', fadeTier(activity.idleMs(clientId)).toFixed(2));
    const userDiv = document.createElement('div');
    userDiv.style.backgroundColor = user.color;
    userDiv.textContent = user.name;
    cursor.append(document.createTextNode('⁠'), userDiv, document.createTextNode('⁠'));
    return cursor;
  };
}

export function remoteSelectionBuilder(activity: PresenceActivity) {
  return (user: PeerUser, clientId: number): DecorationAttrs => ({
    style: `background-color: ${user.color}70; --presence-fade: ${fadeTier(activity.idleMs(clientId)).toFixed(2)}`,
    class: 'ProseMirror-yjs-selection',
    [PRESENCE_ATTR]: String(clientId),
  });
}

// ProseMirror reuses a keyed cursor widget's DOM node across decoration recomputes instead of calling toDOM again, so forcing a recompute on a timer would never re-run remoteCursorBuilder for an untouched peer — this mutates the existing element directly instead.
export function refreshPresenceFade(root: Element, activity: PresenceActivity): void {
  root.querySelectorAll<HTMLElement>(`[${PRESENCE_ATTR}]`).forEach((el) => {
    const clientId = Number(el.getAttribute(PRESENCE_ATTR));
    if (Number.isNaN(clientId)) return;
    el.style.setProperty('--presence-fade', fadeTier(activity.idleMs(clientId)).toFixed(2));
  });
}

const EDGE_MARGIN_PX = 8;

function clampCursorTag(cursor: HTMLElement): void {
  const tag = cursor.querySelector('div');
  if (!tag) return;
  cursor.classList.remove('presence-tag-right');
  const rect = tag.getBoundingClientRect();
  if (rect.right > window.innerWidth - EDGE_MARGIN_PX) {
    cursor.classList.add('presence-tag-right');
  }
}

// Must match the presence-jump-flash CSS animation's duration.
const JUMP_FLASH_MS = 1200;

// Keyed by element, not clientId: a selection span isn't reused like the cursor widget, so a WeakMap lets stale entries for replaced spans get collected.
const flashTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

// Re-adding an already-present class is a DOM no-op (animation doesn't restart), so rapid re-clicks would drop the flash or let a stale removal timer yank the class mid-animation; forcing a reflow and clearing any pending timer fixes both.
function flashOnce(el: HTMLElement, color: CursorColor | undefined): void {
  if (color) el.style.setProperty('--jump-color', color);
  const pending = flashTimers.get(el);
  if (pending !== undefined) clearTimeout(pending);
  el.classList.remove('presence-jump-flash');
  void el.offsetWidth; // force layout so the class below is seen as a fresh add, not a no-op
  el.classList.add('presence-jump-flash');
  flashTimers.set(
    el,
    setTimeout(() => {
      el.classList.remove('presence-jump-flash');
      flashTimers.delete(el);
    }, JUMP_FLASH_MS)
  );
}

// The cursor widget, not the selection highlight, is the scroll target: y-prosemirror renders exactly one cursor widget per peer, but a selection can split into several small/near-empty spans whose getBoundingClientRect() is an unreliable scroll anchor.
export function jumpToPresence(root: Element, clientId: number, color?: CursorColor): void {
  const cursor = root.querySelector<HTMLElement>(`.ProseMirror-yjs-cursor[${PRESENCE_ATTR}="${clientId}"]`);
  const selection = root.querySelectorAll<HTMLElement>(`.ProseMirror-yjs-selection[${PRESENCE_ATTR}="${clientId}"]`);
  const target = cursor ?? selection[0];
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (cursor) clampCursorTag(cursor);
  const flashed = cursor ? [cursor, ...selection] : Array.from(selection);
  flashed.forEach((el) => flashOnce(el, color));
}
