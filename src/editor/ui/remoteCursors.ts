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
 *  for why recompute alone doesn't work here). */
const PRESENCE_ATTR = 'data-presence-client';

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
