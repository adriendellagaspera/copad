// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startSignalingKeepalive } from './signalingKeepalive.js';
import { SIGNALING_KEEPALIVE_MS } from './constants.js';
import type { SignalingUrl } from './types.js';

const mockFetch = vi.fn((_url: string, _opts?: RequestInit) => Promise.resolve(new Response('okay')));
vi.stubGlobal('fetch', mockFetch);

/** Override the read-only visibilityState so a test can simulate a hidden tab. */
const setVisibility = (state: 'visible' | 'hidden'): void => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
};

const urls = (...u: string[]): SignalingUrl[] => u as SignalingUrl[];
const fetchedUrls = (): string[] => mockFetch.mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.useFakeTimers();
  mockFetch.mockClear();
  setVisibility('visible');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startSignalingKeepalive', () => {
  it('pings immediately on start, then once per interval', () => {
    const stop = startSignalingKeepalive(urls('wss://sig.example'));
    expect(mockFetch).toHaveBeenCalledTimes(1); // immediate wake-up ping

    vi.advanceTimersByTime(SIGNALING_KEEPALIVE_MS);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(SIGNALING_KEEPALIVE_MS);
    expect(mockFetch).toHaveBeenCalledTimes(3);

    stop();
  });

  it('converts ws→http and wss→https', () => {
    const stop = startSignalingKeepalive(urls('wss://secure.example', 'ws://plain.example'));
    expect(fetchedUrls()).toEqual(['https://secure.example/', 'http://plain.example/']);
    stop();
  });

  it('drops invalid URLs and is a no-op when none are valid', () => {
    const stop = startSignalingKeepalive(urls('not a url'));
    expect(mockFetch).not.toHaveBeenCalled();

    // The returned stop is still callable and clears nothing harmlessly.
    vi.advanceTimersByTime(SIGNALING_KEEPALIVE_MS * 3);
    expect(mockFetch).not.toHaveBeenCalled();
    stop();
  });

  it('skips pinging while the tab is hidden', () => {
    const stop = startSignalingKeepalive(urls('wss://sig.example'));
    expect(mockFetch).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    vi.advanceTimersByTime(SIGNALING_KEEPALIVE_MS);
    expect(mockFetch).toHaveBeenCalledTimes(1); // hidden → no ping

    setVisibility('visible');
    vi.advanceTimersByTime(SIGNALING_KEEPALIVE_MS);
    expect(mockFetch).toHaveBeenCalledTimes(2); // visible again → resumes
    stop();
  });

  it('stop() cancels further pings', () => {
    const stop = startSignalingKeepalive(urls('wss://sig.example'));
    expect(mockFetch).toHaveBeenCalledTimes(1);

    stop();
    vi.advanceTimersByTime(SIGNALING_KEEPALIVE_MS * 5);
    expect(mockFetch).toHaveBeenCalledTimes(1); // no pings after stop
  });
});
