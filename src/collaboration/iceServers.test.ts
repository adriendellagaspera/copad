import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchIceServers } from './iceServers.js';
import type { IceServersUrl } from './types.js';

const URL = 'https://ice.example/creds' as IceServersUrl;

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubFetch = (fn: typeof fetch) => vi.stubGlobal('fetch', fn);

describe('fetchIceServers', () => {
  it('returns parsed servers on a successful response', async () => {
    stubFetch(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            iceServers: [
              { urls: ['turn:relay.example:3478'], username: 'u', credential: 'c' },
            ],
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch,
    );
    await expect(fetchIceServers(URL)).resolves.toEqual([
      { urls: ['turn:relay.example:3478'], username: 'u', credential: 'c' },
    ]);
  });

  it('returns [] on a non-2xx response', async () => {
    stubFetch(vi.fn(async () => new Response('nope', { status: 502 })) as unknown as typeof fetch);
    await expect(fetchIceServers(URL)).resolves.toEqual([]);
  });

  it('returns [] when the body is not valid JSON', async () => {
    stubFetch(vi.fn(async () => new Response('<<not json>>', { status: 200 })) as unknown as typeof fetch);
    await expect(fetchIceServers(URL)).resolves.toEqual([]);
  });

  it('returns [] when fetch throws (network error / timeout)', async () => {
    stubFetch(vi.fn(async () => { throw new Error('boom'); }) as unknown as typeof fetch);
    await expect(fetchIceServers(URL)).resolves.toEqual([]);
  });

  it('passes an abort signal so a hung request is bounded', async () => {
    const spy = vi.fn(async (_url: string, opts?: RequestInit) => {
      expect(opts?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ iceServers: [] }), { status: 200 });
    });
    stubFetch(spy as unknown as typeof fetch);
    await fetchIceServers(URL);
    expect(spy).toHaveBeenCalledOnce();
  });
});
