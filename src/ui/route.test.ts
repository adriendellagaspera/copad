import { describe, it, expect } from 'vitest';
import type { RoomId } from '../collaboration/types.js';
import type { RoomCredential } from '../collaboration/roomAccess.js';
import type { PagePath } from '../collaboration/roomHistory.js';
import { RouteKind, routeFor, aboutUrl, newDocumentUrl, type PageQuery } from './route.js';

const page = '/app/' as PagePath;
const query = (s: string) => s as PageQuery;

describe('routeFor', () => {
  it('is the room when no about flag is present', () => {
    expect(routeFor(query('?room=abc'))).toEqual({ kind: RouteKind.Room });
    expect(routeFor(query(''))).toEqual({ kind: RouteKind.Room });
  });

  it('is About with or without a value on the flag', () => {
    expect(routeFor(query('?about'))).toEqual({ kind: RouteKind.About });
    expect(routeFor(query('?about='))).toEqual({ kind: RouteKind.About });
  });
});

describe('aboutUrl', () => {
  it('keeps the flag in the query, never the path', () => {
    expect(aboutUrl(page)).toBe('/app/?about=');
  });
});

describe('newDocumentUrl', () => {
  it('carries the room in the query and the key in the fragment', () => {
    expect(newDocumentUrl(page, 'r 1' as RoomId, 'k/1' as RoomCredential)).toBe(
      '/app/?room=r%201&new=1#k=k%2F1',
    );
  });
});
