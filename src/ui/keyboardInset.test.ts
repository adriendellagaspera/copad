import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeVisualViewport extends EventTarget {
  height: number;
  offsetTop: number;
}

interface FrameHarness {
  readonly viewport: FakeVisualViewport;
  readonly frames: Map<number, FrameRequestCallback>;
  runFrames(): void;
}

function installViewportHarness(): FrameHarness {
  let nextFrameId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const viewport = Object.assign(new EventTarget(), {
    height: 664,
    offsetTop: 0,
  }) as FakeVisualViewport;

  vi.stubGlobal('document', {
    documentElement: { clientHeight: 664 },
  });
  vi.stubGlobal('window', {
    visualViewport: viewport,
    requestAnimationFrame(callback: FrameRequestCallback) {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id: number) {
      frames.delete(id);
    },
  });

  return {
    viewport,
    frames,
    runFrames() {
      const pending = [...frames.entries()];
      frames.clear();
      for (const [id, callback] of pending) callback(id);
    },
  };
}

describe('keyboardInset', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads visual viewport geometry on the animation frame after the event', async () => {
    const harness = installViewportHarness();
    const { keyboardInset } = await import('./keyboardInset.svelte.js');

    harness.runFrames();
    expect(keyboardInset.px).toBe(0);

    // WebKit can dispatch resize before height/offsetTop expose the new geometry.
    harness.viewport.dispatchEvent(new Event('resize'));
    harness.viewport.height = 364;
    harness.viewport.offsetTop = 96;

    expect(keyboardInset.px).toBe(0);
    harness.runFrames();
    expect(keyboardInset.px).toBe(204);
  });

  it('coalesces viewport event bursts into the latest geometry', async () => {
    const harness = installViewportHarness();
    const { keyboardInset } = await import('./keyboardInset.svelte.js');

    harness.runFrames();

    harness.viewport.dispatchEvent(new Event('resize'));
    harness.viewport.height = 420;
    harness.viewport.dispatchEvent(new Event('scroll'));
    harness.viewport.height = 364;
    harness.viewport.offsetTop = 96;

    expect(harness.frames.size).toBe(1);
    harness.runFrames();
    expect(keyboardInset.px).toBe(204);
  });

  it('collapses safely when browser globals are unavailable', async () => {
    const { keyboardInset, collapseKeyboardInset } = await import('./keyboardInset.svelte.js');

    expect(() => collapseKeyboardInset()).not.toThrow();
    expect(keyboardInset.px).toBe(0);
  });

  it('cancels a pending viewport measurement when blur collapses the inset', async () => {
    const harness = installViewportHarness();
    const { keyboardInset, collapseKeyboardInset } = await import('./keyboardInset.svelte.js');

    harness.viewport.height = 364;
    harness.viewport.offsetTop = 96;
    harness.runFrames();
    expect(keyboardInset.px).toBe(204);

    harness.viewport.dispatchEvent(new Event('resize'));
    harness.viewport.height = 664;
    harness.viewport.offsetTop = 0;
    expect(harness.frames.size).toBe(1);

    collapseKeyboardInset();

    expect(keyboardInset.px).toBe(0);
    expect(harness.frames.size).toBe(0);
  });
});
