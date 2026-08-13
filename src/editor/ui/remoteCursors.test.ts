// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PRESENCE_ATTR, jumpToPresence } from './remoteCursors.js';
import { parseClientId } from '../../collaboration/parse.js';
import type { CursorColor } from '../../collaboration/types.js';

const CLIENT_ID = parseClientId(7);
const COLOR = '#ff0000' as CursorColor;

function cursorEl(clientId: number): HTMLElement {
  const el = document.createElement('span');
  el.classList.add('ProseMirror-yjs-cursor');
  el.setAttribute(PRESENCE_ATTR, String(clientId));
  return el;
}

function selectionEl(clientId: number): HTMLElement {
  const el = document.createElement('span');
  el.classList.add('ProseMirror-yjs-selection');
  el.setAttribute(PRESENCE_ATTR, String(clientId));
  return el;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('jumpToPresence', () => {
  it('is a no-op when the peer has no rendered decoration', () => {
    const root = document.createElement('div');
    root.appendChild(cursorEl(CLIENT_ID + 1));
    expect(() => jumpToPresence(root, CLIENT_ID, COLOR)).not.toThrow();
    expect(root.querySelector('.presence-jump-flash')).toBeNull();
  });

  it('flashes the cursor widget when the peer has only a caret', () => {
    const root = document.createElement('div');
    const cursor = cursorEl(CLIENT_ID);
    root.appendChild(cursor);
    jumpToPresence(root, CLIENT_ID, COLOR);
    expect(cursor.classList.contains('presence-jump-flash')).toBe(true);
    expect(cursor.style.getPropertyValue('--jump-color')).toBe(COLOR);
  });

  it('scrolls to the cursor widget, not a selection span, when the peer has a selection', () => {
    const root = document.createElement('div');
    const cursor = cursorEl(CLIENT_ID);
    const selection = selectionEl(CLIENT_ID);
    root.appendChild(selection); // selection span precedes the cursor in doc order
    root.appendChild(cursor);
    const cursorScroll = vi.spyOn(cursor, 'scrollIntoView');
    const selectionScroll = vi.spyOn(selection, 'scrollIntoView');
    jumpToPresence(root, CLIENT_ID, COLOR);
    expect(cursorScroll).toHaveBeenCalledTimes(1);
    expect(selectionScroll).not.toHaveBeenCalled();
    expect(cursor.classList.contains('presence-jump-flash')).toBe(true);
    expect(selection.classList.contains('presence-jump-flash')).toBe(true);
  });

  it('falls back to the selection span as the scroll target when there is no cursor widget', () => {
    const root = document.createElement('div');
    const selection = selectionEl(CLIENT_ID);
    root.appendChild(selection);
    const selectionScroll = vi.spyOn(selection, 'scrollIntoView');
    jumpToPresence(root, CLIENT_ID, COLOR);
    expect(selectionScroll).toHaveBeenCalledTimes(1);
    expect(selection.classList.contains('presence-jump-flash')).toBe(true);
  });

  it('removes the flash class after the animation window elapses', () => {
    const root = document.createElement('div');
    const cursor = cursorEl(CLIENT_ID);
    root.appendChild(cursor);
    jumpToPresence(root, CLIENT_ID, COLOR);
    expect(cursor.classList.contains('presence-jump-flash')).toBe(true);
    vi.advanceTimersByTime(1200);
    expect(cursor.classList.contains('presence-jump-flash')).toBe(false);
  });

  // Re-adding a class already present is a DOM no-op, so the CSS animation never restarts.
  it('restarts the flash — and its removal timer — on a rapid repeat click of the same peer', () => {
    const root = document.createElement('div');
    const cursor = cursorEl(CLIENT_ID);
    root.appendChild(cursor);
    const removeSpy = vi.spyOn(cursor.classList, 'remove');
    const addSpy = vi.spyOn(cursor.classList, 'add');

    jumpToPresence(root, CLIENT_ID, COLOR); // t=0
    expect(cursor.classList.contains('presence-jump-flash')).toBe(true);

    vi.advanceTimersByTime(500); // t=500, still mid-flash
    removeSpy.mockClear();
    addSpy.mockClear();
    jumpToPresence(root, CLIENT_ID, COLOR); // second, rapid click
    expect(removeSpy).toHaveBeenCalledWith('presence-jump-flash');
    expect(addSpy).toHaveBeenCalledWith('presence-jump-flash');
    expect(cursor.classList.contains('presence-jump-flash')).toBe(true);

    // The first click's t=1200 timer must have been cancelled by the second click.
    vi.advanceTimersByTime(700); // t=1200
    expect(cursor.classList.contains('presence-jump-flash')).toBe(true);

    vi.advanceTimersByTime(500); // t=1700
    expect(cursor.classList.contains('presence-jump-flash')).toBe(false);
  });

  it('flashes independently per element across a burst of clicks on different peers', () => {
    const root = document.createElement('div');
    const a = cursorEl(1);
    const b = cursorEl(2);
    root.appendChild(a);
    root.appendChild(b);
    jumpToPresence(root, parseClientId(1), COLOR);
    jumpToPresence(root, parseClientId(2), COLOR);
    expect(a.classList.contains('presence-jump-flash')).toBe(true);
    expect(b.classList.contains('presence-jump-flash')).toBe(true);
    vi.advanceTimersByTime(1200);
    expect(a.classList.contains('presence-jump-flash')).toBe(false);
    expect(b.classList.contains('presence-jump-flash')).toBe(false);
  });
});
