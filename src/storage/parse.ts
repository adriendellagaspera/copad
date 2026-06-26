/**
 * IO-boundary parse functions for the storage vertical.
 * Each function is the single cast/narrowing site for its boundary —
 * callers always receive typed domain values, never raw unknowns.
 */

import type { Filename } from './types.js';
import type { GitHubRepo, GitHubBranch, GitHubFileSha } from './github.js';

// ── Stored-session shapes (owned here, imported by adapters) ──────────────────

export interface WebDavConf {
  baseUrl: string;
  auth: string;
}

export interface PCloudSession {
  token: string;
  host: string;
}

export interface PCloudFileLinkResponse {
  result: number;
  hosts: string[];
  path: string;
}

// ── localStorage + JSON.parse boundaries ─────────────────────────────────────

export function parseWebDavConf(raw: string | null): WebDavConf | null {
  try {
    if (!raw) return null;
    const obj: unknown = JSON.parse(raw);
    if (typeof obj !== 'object' || obj === null) return null;
    const { baseUrl, auth } = obj as Record<string, unknown>;
    if (typeof baseUrl !== 'string' || typeof auth !== 'string') return null;
    return { baseUrl, auth };
  } catch {
    return null;
  }
}

export function parsePCloudSession(raw: string | null): PCloudSession | null {
  try {
    if (!raw) return null;
    const obj: unknown = JSON.parse(raw);
    if (typeof obj !== 'object' || obj === null) return null;
    const { token, host } = obj as Record<string, unknown>;
    if (typeof token !== 'string' || typeof host !== 'string') return null;
    return { token, host };
  } catch {
    return null;
  }
}

/** Whether the user has completed a successful GitHub token validation. */
export function parseGitHubValidated(raw: string | null): boolean {
  return raw !== null;
}

/** Parse a filename from localStorage, falling back to the given default. */
export function parseFilename(raw: string | null, fallback: Filename): Filename {
  const trimmed = (raw ?? '').trim();
  return trimmed ? (trimmed as Filename) : fallback;
}

// ── Fetch API JSON response boundaries ────────────────────────────────────────

export function parsePCloudFileLinkResponse(raw: unknown): PCloudFileLinkResponse {
  if (typeof raw !== 'object' || raw === null)
    throw new Error('Unexpected pCloud file link response');
  const obj = raw as Record<string, unknown>;
  const { result, hosts, path } = obj;
  if (typeof result !== 'number' || !Array.isArray(hosts) || typeof path !== 'string')
    throw new Error('pCloud file link response malformed');
  return { result, hosts: hosts.filter((h): h is string => typeof h === 'string'), path };
}

export function parseDropboxTokenResponse(raw: unknown): { access_token: string } {
  if (typeof raw !== 'object' || raw === null)
    throw new Error('Unexpected Dropbox token response');
  const { access_token } = raw as Record<string, unknown>;
  if (typeof access_token !== 'string')
    throw new Error('Dropbox token response missing access_token');
  return { access_token };
}

export function parseGitHubErrorBody(raw: unknown): Record<string, unknown> {
  return (typeof raw === 'object' && raw !== null) ? raw as Record<string, unknown> : {};
}

export function parseGitHubCommitResponse(raw: unknown): { content: { sha: GitHubFileSha } } {
  if (typeof raw !== 'object' || raw === null)
    throw new Error('Unexpected GitHub commit response');
  const content = (raw as Record<string, unknown>)['content'];
  if (typeof content !== 'object' || content === null)
    throw new Error('GitHub commit response missing content');
  const sha = (content as Record<string, unknown>)['sha'];
  if (typeof sha !== 'string') throw new Error('GitHub commit response missing sha');
  return { content: { sha: sha as GitHubFileSha } };
}

export function parseGitHubLoadResponse(raw: unknown): { content: string; sha: GitHubFileSha } {
  if (typeof raw !== 'object' || raw === null)
    throw new Error('Unexpected GitHub load response');
  const obj = raw as Record<string, unknown>;
  const { content, sha } = obj;
  if (typeof content !== 'string' || typeof sha !== 'string')
    throw new Error('GitHub load response malformed');
  return { content, sha: sha as GitHubFileSha };
}

// ── postMessage boundary ──────────────────────────────────────────────────────

/** Extract the OAuth authorization code from a postMessage event payload. */
export function parseOAuthCode(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;
  if (obj['type'] !== 'oauth-code') return null;
  const code = obj['code'];
  return typeof code === 'string' ? code : null;
}

// ── GitHub config parsers ─────────────────────────────────────────────────────

/** Accepts `owner/repo` — rejects empty strings, bare names, and multi-segment paths. */
export function parseRepo(raw: string): GitHubRepo | null {
  const s = raw.trim();
  return /^[^/\s]+\/[^/\s]+$/.test(s) ? (s as GitHubRepo) : null;
}

/** Always succeeds — returns `'main'` when the input is empty. */
export function parseBranch(raw: string): GitHubBranch {
  return (raw.trim() || 'main') as GitHubBranch;
}
