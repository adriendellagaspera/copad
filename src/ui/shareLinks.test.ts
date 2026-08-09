import { describe, it, expect } from 'vitest';
import type { RoomId } from '../collaboration/types.js';
import type { RoomCredential } from '../collaboration/roomAccess.js';
import {
  InviteRole,
  RoomSecurityKind,
  isEncrypted,
  roomSecurity,
  shareUrl,
  type AppUrl,
} from './shareLinks.js';

const app = 'https://copad.example/app/' as AppUrl;
const room = 'room-1' as RoomId;
const cred = (s: string) => s as RoomCredential;

describe('roomSecurity', () => {
  it('is None when nothing protects the room', () => {
    expect(roomSecurity({ linkKey: null, storedPassword: null, envPassword: null })).toEqual({
      kind: RoomSecurityKind.None,
    });
  });

  it('reports a deployment-wide key when only the env password is set', () => {
    const security = roomSecurity({
      linkKey: null,
      storedPassword: null,
      envPassword: cred('site-wide'),
    });
    expect(security).toEqual({ kind: RoomSecurityKind.Deployment, password: cred('site-wide') });
  });

  it('prefers a stored password over the deployment key', () => {
    const security = roomSecurity({
      linkKey: null,
      storedPassword: cred('mine'),
      envPassword: cred('site-wide'),
    });
    expect(security).toEqual({ kind: RoomSecurityKind.Password, password: cred('mine') });
  });

  it('prefers the link key over every other source', () => {
    const security = roomSecurity({
      linkKey: cred('abc'),
      storedPassword: cred('mine'),
      envPassword: cred('site-wide'),
    });
    expect(security).toEqual({ kind: RoomSecurityKind.SecretLink, key: cred('abc') });
  });

  it('treats every arm but None as encrypted', () => {
    expect(isEncrypted({ kind: RoomSecurityKind.None })).toBe(false);
    expect(isEncrypted({ kind: RoomSecurityKind.SecretLink, key: cred('a') })).toBe(true);
    expect(isEncrypted({ kind: RoomSecurityKind.Password, password: cred('a') })).toBe(true);
    expect(isEncrypted({ kind: RoomSecurityKind.Deployment, password: cred('a') })).toBe(true);
  });
});

describe('shareUrl', () => {
  it('builds a bare editor link', () => {
    expect(shareUrl(app, room, InviteRole.Editor, null)).toBe(
      'https://copad.example/app/?room=room-1',
    );
  });

  it('adds the reader role as a query param', () => {
    expect(shareUrl(app, room, InviteRole.Reader, null)).toBe(
      'https://copad.example/app/?room=room-1&role=reader',
    );
  });

  it('keeps the key in the fragment, after the role', () => {
    expect(shareUrl(app, room, InviteRole.Reader, cred('k1'))).toBe(
      'https://copad.example/app/?room=room-1&role=reader#k=k1',
    );
  });

  it('escapes room ids and keys', () => {
    expect(shareUrl(app, 'a b&c' as RoomId, InviteRole.Editor, cred('x/y z'))).toBe(
      'https://copad.example/app/?room=a%20b%26c#k=x%2Fy%20z',
    );
  });
});
