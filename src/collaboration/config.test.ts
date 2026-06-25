import { describe, it, expect } from 'vitest';
import { resolveSignaling } from './config.js';

const https = { protocol: 'https:', hostname: 'app.example.com' };
const localhttp = { protocol: 'http:', hostname: 'localhost' };

describe('resolveSignaling', () => {
  it('defaults to the local dev server on a local host', () => {
    const r = resolveSignaling(undefined, localhttp);
    expect(r.servers).toEqual(['ws://localhost:4444']);
    expect(r.warning).toBeUndefined();
  });

  it('warns and configures no servers when unset on a deployed origin', () => {
    const r = resolveSignaling(undefined, https);
    expect(r.servers).toEqual([]);
    expect(r.warning).toMatch(/VITE_SIGNALING_URL/);
  });

  it('warns when every configured server is insecure ws:// on https', () => {
    const r = resolveSignaling('ws://localhost:4444', https);
    expect(r.servers).toEqual(['ws://localhost:4444']);
    expect(r.warning).toMatch(/mixed content/i);
  });

  it('warns about the insecure subset when only some servers are ws://', () => {
    const r = resolveSignaling('wss://sig.example, ws://nope', https);
    expect(r.servers).toEqual(['wss://sig.example', 'ws://nope']);
    expect(r.warning).toMatch(/ws:\/\/nope/);
  });

  it('accepts a wss:// server on https without warning', () => {
    const r = resolveSignaling('wss://sig.example', https);
    expect(r.servers).toEqual(['wss://sig.example']);
    expect(r.warning).toBeUndefined();
  });

  it('trims and splits a comma-separated list', () => {
    const r = resolveSignaling(' wss://a ,, wss://b ', https);
    expect(r.servers).toEqual(['wss://a', 'wss://b']);
  });
});
