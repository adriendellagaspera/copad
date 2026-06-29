import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchTurnIceServers } from './turnAuth.js';
import type { TurnAuthUrl } from './types.js';

const URL = 'https://turn-auth.example/creds' as TurnAuthUrl;

function mockFetch(impl: () => Promise<Response> | Response): void {
  vi.stubGlobal('fetch', vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchTurnIceServers', () => {
  it('shapes a valid response into an IceServer list', async () => {
    mockFetch(() =>
      new Response(
        JSON.stringify({ urls: ['turns:turn.example:5349'], username: '1700000000:copad', credential: 'sig==', ttl: 600 }),
        { status: 200 },
      ),
    );
    const ice = await fetchTurnIceServers(URL);
    expect(ice).toEqual([
      { urls: ['turns:turn.example:5349'], username: '1700000000:copad', credential: 'sig==' },
    ]);
  });

  it('returns null on a non-2xx response', async () => {
    mockFetch(() => new Response('nope', { status: 500 }));
    expect(await fetchTurnIceServers(URL)).toBeNull();
  });

  it('returns null on a malformed body', async () => {
    mockFetch(() => new Response(JSON.stringify({ urls: [] }), { status: 200 }));
    expect(await fetchTurnIceServers(URL)).toBeNull();
  });

  it('returns null when fetch throws (endpoint unreachable)', async () => {
    mockFetch(() => {
      throw new Error('network down');
    });
    expect(await fetchTurnIceServers(URL)).toBeNull();
  });

  it('returns null when the body is not JSON', async () => {
    mockFetch(() => new Response('<html>offline</html>', { status: 200 }));
    expect(await fetchTurnIceServers(URL)).toBeNull();
  });
});
