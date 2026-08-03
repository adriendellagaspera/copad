import { describe, it, expect, vi } from 'vitest';

vi.stubGlobal('crypto', { randomUUID: () => 'aaaa-bbbb-cccc-dddd' });

const { newRoomId } = await import('./roomId.js');

describe('newRoomId', () => {
  it('draws from crypto.randomUUID, not Math.random', () => {
    expect(newRoomId()).toBe('aaaa-bbbb-cccc-dddd');
  });
});
