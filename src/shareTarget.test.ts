import { describe, expect, it } from 'vitest';
import { parseSharedNavigation } from './shareTarget.js';

describe('parseSharedNavigation', () => {
  it('returns none when no share-target params are present', () => {
    expect(parseSharedNavigation('')).toEqual({ kind: 'none' });
    expect(parseSharedNavigation('?room=abc')).toEqual({ kind: 'none' });
  });

  it('returns none for arbitrary shared text with no Copad link', () => {
    const search = '?text=' + encodeURIComponent('Hey, check this out!');
    expect(parseSharedNavigation(search)).toEqual({ kind: 'none' });
  });

  it('returns none for a foreign link', () => {
    const search = '?url=' + encodeURIComponent('https://example.com/page');
    expect(parseSharedNavigation(search)).toEqual({ kind: 'none' });
  });

  it('extracts room and key from a shared Copad link in the url field', () => {
    const link = 'https://copad.example/?room=my-room#k=my-key';
    const search = '?url=' + encodeURIComponent(link);
    expect(parseSharedNavigation(search)).toEqual({ kind: 'room', room: 'my-room', key: 'my-key' });
  });

  it('extracts a room-only link (no key) embedded in shared text', () => {
    const link = 'https://copad.example/?room=plain-room';
    const search = '?text=' + encodeURIComponent(`Join me: ${link}`);
    expect(parseSharedNavigation(search)).toEqual({ kind: 'room', room: 'plain-room', key: null });
  });

  it('prefers the url field over text when both are present', () => {
    const search =
      '?url=' +
      encodeURIComponent('https://copad.example/?room=from-url') +
      '&text=' +
      encodeURIComponent('https://copad.example/?room=from-text');
    expect(parseSharedNavigation(search)).toEqual({ kind: 'room', room: 'from-url', key: null });
  });
});
