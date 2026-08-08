import { describe, it, expect } from 'vitest';
import { meetingLinkFingerprint, deriveMeetingRoom } from './meetingLink.js';

describe('meetingLinkFingerprint', () => {
  it('returns null for non-URL input', () => {
    expect(meetingLinkFingerprint('not a link')).toBeNull();
    expect(meetingLinkFingerprint('')).toBeNull();
  });

  it('is stable for an identical link', () => {
    const link = 'https://zoom.us/j/1234567890?pwd=abc';
    expect(meetingLinkFingerprint(link)).toBe(meetingLinkFingerprint(link));
  });

  it('is case-insensitive on the host but not the path/query', () => {
    const a = meetingLinkFingerprint('https://ZOOM.us/j/1234567890?pwd=AbC');
    const b = meetingLinkFingerprint('https://zoom.us/j/1234567890?pwd=AbC');
    expect(a).toBe(b);
    expect(meetingLinkFingerprint('https://zoom.us/j/1234567890?pwd=abc')).not.toBe(a);
  });

  it('ignores scheme and a trailing slash', () => {
    const a = meetingLinkFingerprint('http://meet.google.com/abc-defg-hij');
    const b = meetingLinkFingerprint('https://meet.google.com/abc-defg-hij/');
    expect(a).toBe(b);
  });

  it('drops tracking params but keeps meeting-identifying ones', () => {
    const withTracking = meetingLinkFingerprint(
      'https://zoom.us/j/1234567890?pwd=abc&utm_source=calendar&authuser=1',
    );
    const clean = meetingLinkFingerprint('https://zoom.us/j/1234567890?pwd=abc');
    expect(withTracking).toBe(clean);
  });

  it('is insensitive to query param order', () => {
    const a = meetingLinkFingerprint('https://zoom.us/j/1234567890?a=1&b=2');
    const b = meetingLinkFingerprint('https://zoom.us/j/1234567890?b=2&a=1');
    expect(a).toBe(b);
  });

  it('unwraps an Outlook Safe Links redirect to the real link', () => {
    const real = 'https://us02web.zoom.us/j/1234567890?pwd=abc';
    const wrapped = `https://nam.safelinks.protection.outlook.com/?url=${encodeURIComponent(real)}&data=x`;
    expect(meetingLinkFingerprint(wrapped)).toBe(meetingLinkFingerprint(real));
  });

  it('distinguishes different meetings', () => {
    const a = meetingLinkFingerprint('https://zoom.us/j/1111111111?pwd=abc');
    const b = meetingLinkFingerprint('https://zoom.us/j/2222222222?pwd=abc');
    expect(a).not.toBe(b);
  });
});

describe('deriveMeetingRoom', () => {
  it('derives the same room and key for the same link', async () => {
    const link = 'https://teams.microsoft.com/l/meetup-join/abc123';
    const first = await deriveMeetingRoom(link);
    const second = await deriveMeetingRoom(link);
    expect(first).not.toBeNull();
    expect(first).toEqual(second);
  });

  it('derives different rooms for different links', async () => {
    const a = await deriveMeetingRoom('https://zoom.us/j/1111111111?pwd=abc');
    const b = await deriveMeetingRoom('https://zoom.us/j/2222222222?pwd=abc');
    expect(a?.room).not.toBe(b?.room);
    expect(a?.key).not.toBe(b?.key);
  });

  it('room and key are distinct from each other', async () => {
    const result = await deriveMeetingRoom('https://meet.google.com/abc-defg-hij');
    expect(result?.room).not.toBe(result?.key);
  });

  it('returns null for a non-URL', async () => {
    expect(await deriveMeetingRoom('not a link')).toBeNull();
  });
});
