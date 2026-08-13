/**
 * DOM builders for y-prosemirror's `yCursorPlugin` — a caret + name tag per
 * present peer, and a highlight over their live selection. Idle peers fade
 * progressively via a `--presence-fade` custom property (0 = just active, 1 =
 * fully idle) that `editor.css` turns into opacity — SOTA (Figma) dims a
 * stale cursor rather than removing it; only leaving the room does that.
 */

import type { DecorationAttrs } from 'prosemirror-view';
import type { PeerUser, CursorColor, ClientId } from '../../collaboration/types.js';
import { parseClientId } from '../../collaboration/parse.js';
import { fadeTier, type PresenceActivity } from '../../collaboration/presenceActivity.js';

/** Tags a rendered cursor/selection element with its owning clientId so
 *  `refreshPresenceFade` can find and re-fade it without going through
 *  y-prosemirror's decoration recompute (see that function's doc comment
 *  for why recompute alone doesn't work here). Also what `jumpToPresence`
 *  below scrolls to when a peer is picked from the presence bar. */
export const PRESENCE_ATTR = 'data-presence-client';

export function remoteCursorBuilder(activity: PresenceActivity) {
  return (user: PeerUser, rawClientId: number): HTMLElement => {
    const clientId = parseClientId(rawClientId);
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
  return (user: PeerUser, rawClientId: number): DecorationAttrs => {
    const clientId = parseClientId(rawClientId);
    return {
      style: `background-color: ${user.color}70; --presence-fade: ${fadeTier(activity.idleMs(clientId)).toFixed(2)}`,
      class: 'ProseMirror-yjs-selection',
      [PRESENCE_ATTR]: String(clientId),
    };
  };
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
    const raw = Number(el.getAttribute(PRESENCE_ATTR));
    if (Number.isNaN(raw)) return;
    el.style.setProperty('--presence-fade', fadeTier(activity.idleMs(parseClientId(raw))).toFixed(2));
  });
}

/** How close to the viewport's right edge (px) still counts as "would clip"
 *  — a small margin rather than an exact 0, so the flip happens just before
 *  the tag visibly touches the edge. */
const EDGE_MARGIN_PX = 8;

/**
 * Flips a rendered cursor's name tag to hug the caret's right side instead of
 * its left when the tag's default (left-anchored) position would run past
 * the viewport's right edge — the concrete overflow a peer's tag hits when
 * their caret sits near a narrow (mobile) screen's edge and `jumpToPresence`
 * scrolls/flashes it into view. Re-evaluated on every call (not just once)
 * since the caret's on-screen position can shift between jumps as the
 * document is edited.
 */
function clampCursorTag(cursor: HTMLElement): void {
  const tag = cursor.querySelector('div');
  if (!tag) return;
  cursor.classList.remove('presence-tag-right');
  const rect = tag.getBoundingClientRect();
  if (rect.right > window.innerWidth - EDGE_MARGIN_PX) {
    cursor.classList.add('presence-tag-right');
  }
}

/** How long the flash highlight (below) stays on the DOM before it's removed,
 *  in ms — must match the `presence-jump-flash` CSS animation's duration. */
const JUMP_FLASH_MS = 1200;

/** Pending removal timer per flashed element, so a re-trigger while one is
 *  still in flight cancels the stale timer instead of leaving two timers
 *  racing to touch the same element's class (see `flashOnce`). Keyed by
 *  element, not clientId, since the cursor widget's DOM node is reused
 *  (stable key) but a selection span isn't — a WeakMap lets stale entries
 *  for since-replaced spans get collected instead of leaking. */
const flashTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/**
 * (Re)plays the flash animation on one element, correct even if it's already
 * mid-flash from a previous, rapid click on the same peer.
 *
 * Re-adding a class that's already present is a no-op in the DOM — the CSS
 * animation does not restart — so repeatedly clicking the same peer within
 * one flash's ~1.2s lifetime used to leave the second click's flash silently
 * dropped (or, worse, the *first* click's stale removal timer could fire
 * mid-way through a *later* click's animation and yank the class off early).
 * Forcing a reflow between remove and re-add guarantees the animation always
 * restarts from frame 0, and clearing any previous timer before scheduling a
 * new one guarantees exactly one removal ever fires per element.
 */
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

/**
 * Scrolls a peer's rendered cursor into view and briefly flashes it (plus
 * their live selection highlight, if any) in the peer's own colour — the
 * presence bar's "where is this person" action (Figma-style jump to a
 * collaborator), invoked by clicking their avatar. A no-op if the peer has no
 * decoration currently rendered (e.g. they just left).
 *
 * The cursor widget (`.ProseMirror-yjs-cursor`) is the scroll target, never
 * the selection highlight: y-prosemirror always renders exactly one cursor
 * widget per present peer regardless of whether they have a selection (see
 * `createDecorations` in y-prosemirror's cursor plugin — the widget sits at
 * `head` unconditionally), whereas the selection highlight can be split
 * across several small, sometimes near-empty spans when it crosses a block
 * boundary. Picking the first of those as the scroll anchor was unreliable —
 * `getBoundingClientRect()` on a degenerate span can land the scroll in the
 * wrong place, which is what made this look broken while a peer had an
 * active selection instead of a bare caret.
 */
export function jumpToPresence(root: Element, clientId: ClientId, color?: CursorColor): void {
  const cursor = root.querySelector<HTMLElement>(`.ProseMirror-yjs-cursor[${PRESENCE_ATTR}="${clientId}"]`);
  const selection = root.querySelectorAll<HTMLElement>(`.ProseMirror-yjs-selection[${PRESENCE_ATTR}="${clientId}"]`);
  const target = cursor ?? selection[0];
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (cursor) clampCursorTag(cursor);
  const flashed = cursor ? [cursor, ...selection] : Array.from(selection);
  flashed.forEach((el) => flashOnce(el, color));
}
