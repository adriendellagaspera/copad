import { describe, it, expect } from 'vitest';
import type { CursorColor } from './types.js';
import {
  parsePeerAwarenessState,
  parseRoomName,
  parseIceServersResponse,
  parseKeyFingerprint,
  parseDisplayName,
  parseStoredColor,
} from './parse.js';

describe('parsePeerAwarenessState — fallback behaviour', () => {
  it('returns safe defaults for null', () => {
    const result = parsePeerAwarenessState(null);
    expect(result.user.name).toBe('Anonymous');
    expect(result.user.color).toBe('#888888');
    expect(result.role).toBe('writer');
    expect(result.canPersist).toBe(false);
  });

  it('returns safe defaults for undefined', () => {
    const result = parsePeerAwarenessState(undefined);
    expect(result.user.name).toBe('Anonymous');
    expect(result.user.color).toBe('#888888');
    expect(result.role).toBe('writer');
    expect(result.canPersist).toBe(false);
  });

  it('returns safe defaults for an empty object', () => {
    const result = parsePeerAwarenessState({});
    expect(result.user.name).toBe('Anonymous');
    expect(result.user.color).toBe('#888888');
    expect(result.role).toBe('writer');
    expect(result.canPersist).toBe(false);
  });
});

describe('parsePeerAwarenessState — valid input passes through', () => {
  it('passes through a fully valid PeerAwarenessState', () => {
    const input = {
      user: { name: 'Alice', color: '#e11d48' },
      role: 'writer',
      canPersist: false,
    };
    const result = parsePeerAwarenessState(input);
    expect(result.user.name).toBe('Alice');
    expect(result.user.color).toBe('#e11d48');
    expect(result.role).toBe('writer');
    expect(result.canPersist).toBe(false);
  });

  it('preserves canPersist: true', () => {
    const input = {
      user: { name: 'Bob', color: '#00aaff' },
      role: 'writer',
      canPersist: true,
    };
    expect(parsePeerAwarenessState(input).canPersist).toBe(true);
  });

  it('preserves role: reader', () => {
    const input = {
      user: { name: 'Charlie', color: '#123456' },
      role: 'reader',
      canPersist: false,
    };
    expect(parsePeerAwarenessState(input).role).toBe('reader');
  });

  it('valid 6-digit lowercase hex color passes through', () => {
    const input = { user: { name: 'Dave', color: '#a1b2c3' }, role: 'writer', canPersist: false };
    expect(parsePeerAwarenessState(input).user.color).toBe('#a1b2c3');
  });

  it('valid 6-digit uppercase hex color passes through', () => {
    const input = { user: { name: 'Eve', color: '#AABBCC' }, role: 'writer', canPersist: false };
    expect(parsePeerAwarenessState(input).user.color).toBe('#AABBCC');
  });

  it('preserves browserId when present', () => {
    const input = {
      user: { name: 'Frank', color: '#00aaff' },
      role: 'writer',
      canPersist: false,
      browserId: 'abc123',
    };
    expect(parsePeerAwarenessState(input).browserId).toBe('abc123');
  });

  it('omits browserId when absent', () => {
    const input = { user: { name: 'Grace', color: '#00aaff' }, role: 'writer', canPersist: false };
    expect(parsePeerAwarenessState(input).browserId).toBeUndefined();
  });
});

describe('parsePeerAwarenessState — partial input', () => {
  it('name passes through but color falls back when color is absent', () => {
    const input = { user: { name: 'Frank' } };
    const result = parsePeerAwarenessState(input);
    expect(result.user.name).toBe('Frank');
    expect(result.user.color).toBe('#888888');
  });

  it('color passes through but name falls back when name is absent', () => {
    const input = { user: { color: '#abcdef' } };
    const result = parsePeerAwarenessState(input);
    expect(result.user.name).toBe('Anonymous');
    expect(result.user.color).toBe('#abcdef');
  });
});

describe('parsePeerAwarenessState — wrong types', () => {
  it('falls back when name is a number', () => {
    const input = { user: { name: 42, color: '#123456' }, role: 'writer', canPersist: false };
    expect(parsePeerAwarenessState(input).user.name).toBe('Anonymous');
  });

  it('falls back when color is not a hex string', () => {
    const input = { user: { name: 'Grace', color: 12345 }, role: 'writer', canPersist: false };
    expect(parsePeerAwarenessState(input).user.color).toBe('#888888');
  });

  it('falls back when both name and color are wrong types', () => {
    const input = { user: { name: true, color: [] }, role: 'writer', canPersist: false };
    const result = parsePeerAwarenessState(input);
    expect(result.user.name).toBe('Anonymous');
    expect(result.user.color).toBe('#888888');
  });
});

describe('parsePeerAwarenessState — color hex validation', () => {
  it('falls back for named color "red"', () => {
    const input = { user: { name: 'Hank', color: 'red' } };
    expect(parsePeerAwarenessState(input).user.color).toBe('#888888');
  });

  it('falls back for invalid hex "#ZZZZZZ"', () => {
    const input = { user: { name: 'Iris', color: '#ZZZZZZ' } };
    expect(parsePeerAwarenessState(input).user.color).toBe('#888888');
  });

  it('falls back for short hex "#12345" (5 digits)', () => {
    const input = { user: { name: 'Jack', color: '#12345' } };
    expect(parsePeerAwarenessState(input).user.color).toBe('#888888');
  });

  it('falls back for 3-digit shorthand hex "#abc"', () => {
    const input = { user: { name: 'Kate', color: '#abc' } };
    expect(parsePeerAwarenessState(input).user.color).toBe('#888888');
  });

  it('falls back for 8-digit hex "#a1b2c3d4"', () => {
    const input = { user: { name: 'Leo', color: '#a1b2c3d4' } };
    expect(parsePeerAwarenessState(input).user.color).toBe('#888888');
  });
});

describe('parsePeerAwarenessState — role handling', () => {
  it('coerces unknown role strings to "writer"', () => {
    const input = { user: { name: 'Mo', color: '#000000' }, role: 'admin', canPersist: false };
    expect(parsePeerAwarenessState(input).role).toBe('writer');
  });

  it('coerces numeric role to "writer"', () => {
    const input = { user: { name: 'Ned', color: '#000000' }, role: 1, canPersist: false };
    expect(parsePeerAwarenessState(input).role).toBe('writer');
  });

  it('preserves "reader" role', () => {
    const input = { user: { name: 'Ora', color: '#000000' }, role: 'reader', canPersist: false };
    expect(parsePeerAwarenessState(input).role).toBe('reader');
  });

  it('coerces "writer" string to "writer"', () => {
    const input = { user: { name: 'Pat', color: '#000000' }, role: 'writer', canPersist: false };
    expect(parsePeerAwarenessState(input).role).toBe('writer');
  });
});

describe('parseRoomName', () => {
  it('trims and brands a non-empty name', () => {
    expect(parseRoomName('  Team Notes  ')).toBe('Team Notes');
  });

  it('returns null for empty / whitespace / null', () => {
    expect(parseRoomName('')).toBeNull();
    expect(parseRoomName('   ')).toBeNull();
    expect(parseRoomName(null)).toBeNull();
  });
});

describe('parseDisplayName', () => {
  it('trims and brands a non-empty name', () => {
    expect(parseDisplayName('  Ada  ')).toBe('Ada');
  });

  it('falls back to FALLBACK_NAME for empty / whitespace / null', () => {
    expect(parseDisplayName('')).toBe('Anonymous');
    expect(parseDisplayName('   ')).toBe('Anonymous');
    expect(parseDisplayName(null)).toBe('Anonymous');
  });
});

describe('parseStoredColor', () => {
  const PALETTE = ['#e11d48', '#7c3aed', '#0891b2'] as CursorColor[];

  it('passes through a value present in the current palette', () => {
    expect(parseStoredColor('#7c3aed', PALETTE, () => PALETTE[0])).toBe('#7c3aed');
  });

  it('falls back to pickDefault() for null, empty, or a colour outside the palette', () => {
    expect(parseStoredColor(null, PALETTE, () => PALETTE[0])).toBe(PALETTE[0]);
    expect(parseStoredColor('', PALETTE, () => PALETTE[0])).toBe(PALETTE[0]);
    expect(parseStoredColor('#ffffff', PALETTE, () => PALETTE[0])).toBe(PALETTE[0]);
  });
});

describe('parseIceServersResponse', () => {
  it('parses the Cloudflare shape (mixed stun/turn urls + creds)', () => {
    const raw = {
      iceServers: [
        {
          urls: [
            'stun:stun.cloudflare.com:3478',
            'turn:turn.cloudflare.com:3478?transport=udp',
            'turns:turn.cloudflare.com:5349?transport=tcp',
          ],
          username: 'abc',
          credential: 'xyz',
        },
      ],
    };
    expect(parseIceServersResponse(raw)).toEqual([
      {
        urls: [
          'stun:stun.cloudflare.com:3478',
          'turn:turn.cloudflare.com:3478?transport=udp',
          'turns:turn.cloudflare.com:5349?transport=tcp',
        ],
        username: 'abc',
        credential: 'xyz',
      },
    ]);
  });

  it('accepts a single url string and omits absent creds', () => {
    expect(parseIceServersResponse({ iceServers: [{ urls: 'stun:s.example:3478' }] })).toEqual([
      { urls: ['stun:s.example:3478'] },
    ]);
  });

  it('drops invalid urls and entries with no valid url', () => {
    const raw = {
      iceServers: [
        { urls: ['not-a-url', 'turn:relay.example:3478'] },
        { urls: ['http://nope.example'] },
        { urls: [] },
        { username: 'x' },
      ],
    };
    expect(parseIceServersResponse(raw)).toEqual([{ urls: ['turn:relay.example:3478'] }]);
  });

  it('returns [] for malformed / missing shapes', () => {
    expect(parseIceServersResponse(null)).toEqual([]);
    expect(parseIceServersResponse(undefined)).toEqual([]);
    expect(parseIceServersResponse('nope')).toEqual([]);
    expect(parseIceServersResponse({})).toEqual([]);
    expect(parseIceServersResponse({ iceServers: 'x' })).toEqual([]);
    expect(parseIceServersResponse({ iceServers: [null, 42, 'str'] })).toEqual([]);
  });

  it('ignores non-string username/credential', () => {
    const raw = { iceServers: [{ urls: ['turn:r.example:3478'], username: 5, credential: {} }] };
    expect(parseIceServersResponse(raw)).toEqual([{ urls: ['turn:r.example:3478'] }]);
  });
});

describe('parseKeyFingerprint', () => {
  const hex64 = 'a'.repeat(64);

  it('accepts a 64-char lowercase hex digest', () => {
    expect(parseKeyFingerprint(hex64)).toBe(hex64);
  });

  it('rejects null, wrong length, and non-hex', () => {
    expect(parseKeyFingerprint(null)).toBeNull();
    expect(parseKeyFingerprint('')).toBeNull();
    expect(parseKeyFingerprint('abc')).toBeNull();
    expect(parseKeyFingerprint('g'.repeat(64))).toBeNull();
    expect(parseKeyFingerprint('A'.repeat(64))).toBeNull(); // uppercase isn't our format
  });
});
