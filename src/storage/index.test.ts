import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RoomId } from '../collaboration/types.js';

const TEST_ROOM = 'document' as RoomId;

// Minimal localStorage shim — several adapters read config at factory init.
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
};
vi.stubGlobal('localStorage', localStorageMock);

beforeEach(() => {
  localStorageMock.clear();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('backends()', () => {
  it('offers only filesystem and webdav by default, with dropbox, pcloud, github, gitlab, s3, sharepoint, gdrive, and onedrive disabled', async () => {
    const { backends } = await import('./index.js');
    const ids = backends(TEST_ROOM).map(b => b.storage.id).sort();
    expect(ids).toEqual(['local', 'webdav']);
  });

  it('VITE_ENABLE_GITLAB=true surfaces gitlab once it is ready to test outside prod', async () => {
    vi.stubEnv('VITE_ENABLE_GITLAB', 'true');
    const { backends } = await import('./index.js');
    const ids = backends(TEST_ROOM).map(b => b.storage.id);
    expect(ids).toContain('gitlab');
  });

  it('VITE_ENABLE_S3=true surfaces s3 once it is ready to test outside prod', async () => {
    vi.stubEnv('VITE_ENABLE_S3', 'true');
    const { backends } = await import('./index.js');
    const ids = backends(TEST_ROOM).map(b => b.storage.id);
    expect(ids).toContain('s3');
  });

  it('VITE_ENABLE_SHAREPOINT=true surfaces sharepoint once it is ready to test outside prod', async () => {
    vi.stubEnv('VITE_ENABLE_SHAREPOINT', 'true');
    const { backends } = await import('./index.js');
    const ids = backends(TEST_ROOM).map(b => b.storage.id);
    expect(ids).toContain('sharepoint');
  });

  it('VITE_ENABLE_GDRIVE=true surfaces gdrive once it is ready to test outside prod', async () => {
    vi.stubEnv('VITE_ENABLE_GDRIVE', 'true');
    const { backends } = await import('./index.js');
    const ids = backends(TEST_ROOM).map(b => b.storage.id);
    expect(ids).toContain('gdrive');
  });

  it('VITE_ENABLE_ONEDRIVE=true surfaces onedrive once it is ready to test outside prod', async () => {
    vi.stubEnv('VITE_ENABLE_ONEDRIVE', 'true');
    const { backends } = await import('./index.js');
    const ids = backends(TEST_ROOM).map(b => b.storage.id);
    expect(ids).toContain('onedrive');
  });

  it('hides a backend disabled via VITE_ENABLE_<ID>, leaving the rest untouched', async () => {
    vi.stubEnv('VITE_ENABLE_WEBDAV', 'false');
    const { backends } = await import('./index.js');
    const ids = backends(TEST_ROOM).map(b => b.storage.id);
    expect(ids).not.toContain('webdav');
    expect(ids).toContain('local');
    expect(ids).toHaveLength(1);
  });

  it('an explicit VITE_ENABLE_<ID>=true keeps a backend visible', async () => {
    vi.stubEnv('VITE_ENABLE_PCLOUD', 'true');
    const { backends } = await import('./index.js');
    const ids = backends(TEST_ROOM).map(b => b.storage.id);
    expect(ids).toContain('pcloud');
  });
});
