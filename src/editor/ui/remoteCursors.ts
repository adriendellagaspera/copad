/**
 * DOM builders for y-prosemirror's `yCursorPlugin` — a caret + name tag per
 * present peer, and a highlight over their live selection. Idle peers fade
 * progressively via a `--presence-fade` custom property (0 = just active, 1 =
 * fully idle) that `editor.css` turns into opacity — SOTA (Figma) dims a
 * stale cursor rather than removing it; only leaving the room does that.
 */

import type { DecorationAttrs } from 'prosemirror-view';
import type { PeerUser } from '../../collaboration/types.js';
import { fadeTier, type PresenceActivity } from '../../collaboration/presenceActivity.js';

/** Tags a rendered cursor/selection element with its owning clientId so
 *  `refreshPresenceFade` can find and re-fade it without going through
 *  y-prosemirror's decoration recompute (see that function's doc comment
 *  for why recompute alone doesn't work here). Also what `jumpToPresence`
 *  below scrolls to when a peer is picked from the presence bar. */
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

/**
 * Re-evaluates idle fade for every rendered remote cursor/selection element
 * under `root`, mutating `--presence-fade` in place.
 *
 * y-prosemirror's cursor widget is keyed by clientId, and ProseMirror reuses
 * a keyed widget's existing DOM node across decoration recomputes instead of
 * calling `toDOM` again (it's how the caret avoids being torn down and
 * rebuilt on every doc edit). That means forcing a decoration recompute on a
 * timer would never actually re-run `remoteCursorBuilder` for an already-
 * rendered, otherwise-untouched peer — so a parked cursor's fade would never
 * progress. Mutating the existing element directly, on a timer, is what
 * makes the fade move while idle.
 */
export function refreshPresenceFade(root: Element, activity: PresenceActivity): void {
  root.querySelectorAll<HTMLElement>(`[${PRESENCE_ATTR}]`).forEach((el) => {
    const clientId = Number(el.getAttribute(PRESENCE_ATTR));
    if (Number.isNaN(clientId)) return;
    el.style.setProperty('--presence-fade', fadeTier(activity.idleMs(clientId)).toFixed(2));
  });
}

/** How long the flash highlight (below) stays on the DOM before it's removed,
 *  in ms — must match the `presence-jump-flash` CSS animation's duration. */
const JUMP_FLASH_MS = 900;

/**
 * Scrolls a peer's rendered cursor/selection into view and briefly flashes it
 * — the presence bar's "where is this person" action (Figma-style jump to a
 * collaborator), invoked by clicking their avatar. A no-op if the peer has no
 * decoration currently rendered (e.g. they just left).
 */
export function jumpToPresence(root: Element, clientId: number): void {
  const els = root.querySelectorAll<HTMLElement>(`[${PRESENCE_ATTR}="${clientId}"]`);
  if (els.length === 0) return;
  els[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  els.forEach((el) => {
    el.classList.add('presence-jump-flash');
    setTimeout(() => el.classList.remove('presence-jump-flash'), JUMP_FLASH_MS);
  });
}
