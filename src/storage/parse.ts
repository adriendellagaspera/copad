/**
 * IO-boundary parse functions for the storage vertical.
 * Each function is the single cast/narrowing site for its boundary —
 * callers always receive typed domain values, never raw unknowns.
 */

import type { Filename } from './types.js';
import type { GitHubRepo, GitHubBranch, GitHubFileSha } from './github.js';
import type { DropboxToken, DropboxAppKey } from './dropbox.js';
import type { WebDavBaseUrl, WebDavAuthHeader } from './webdav.js';
import type { PCloudToken, PCloudApiHost, PCloudClientId } from './pcloud.js';
import type { GitLabProject, GitLabBranch, GitLabHost } from './gitlab.js';
import { GITHUB_DEFAULT_BRANCH, GITLAB_DEFAULT_BRANCH, GITLAB_DEFAULT_HOST } from './constants.js';

// ── Stored-session shapes (owned here, imported by adapters) ──────────────────

export interface WebDavConf {
  baseUrl: WebDavBaseUrl;
  auth: WebDavAuthHeader;
}

export interface PCloudSession {
  token: PCloudToken;
  host: PCloudApiHost;
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
    return { baseUrl: baseUrl as WebDavBaseUrl, auth: auth as WebDavAuthHeader };
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
    // Already validated once at the OAuth callback boundary — cast on this
    // round-trip read from JSON.
    return { token: token as PCloudToken, host: host as PCloudApiHost };
  } catch {
    return null;
  }
}

/** Whether the user has completed a successful GitHub token validation. */
export function parseGitHubValidated(raw: string | null): boolean {
  return raw !== null;
}

/** Whether the user has completed a successful GitLab token validation. */
export function parseGitLabValidated(raw: string | null): boolean {
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

export function parseDropboxTokenResponse(raw: unknown): { access_token: DropboxToken } {
  if (typeof raw !== 'object' || raw === null)
    throw new Error('Unexpected Dropbox token response');
  const { access_token } = raw as Record<string, unknown>;
  if (typeof access_token !== 'string')
    throw new Error('Dropbox token response missing access_token');
  return { access_token: access_token as DropboxToken };
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

// ── GitLab API JSON boundaries ────────────────────────────────────────────────

/** Base64 `content` from a Repository Files API response. */
export function parseGitLabFileContent(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null)
    throw new Error('Unexpected GitLab file response');
  const content = (raw as Record<string, unknown>)['content'];
  if (typeof content !== 'string') throw new Error('GitLab file response missing content');
  return content;
}

/** The effective access level from a project response — the max of the user's
 *  project- and group-level access. 0 when absent. */
export function parseGitLabAccessLevel(raw: unknown): number {
  if (typeof raw !== 'object' || raw === null) return 0;
  const perms = (raw as Record<string, unknown>)['permissions'];
  if (typeof perms !== 'object' || perms === null) return 0;
  const p = perms as Record<string, unknown>;
  const level = (block: unknown): number => {
    if (typeof block !== 'object' || block === null) return 0;
    const lvl = (block as Record<string, unknown>)['access_level'];
    return typeof lvl === 'number' ? lvl : 0;
  };
  return Math.max(level(p['project_access']), level(p['group_access']));
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

/** Always succeeds — returns the default branch when the input is empty. */
export function parseBranch(raw: string): GitHubBranch {
  return (raw.trim() || GITHUB_DEFAULT_BRANCH) as GitHubBranch;
}

// ── Dropbox config parsers ─────────────────────────────────────────────────────

/** Trim a configured Dropbox app key — empty ⇒ not configured. */
export function parseDropboxAppKey(raw: string): DropboxAppKey | null {
  const s = raw.trim();
  return s ? (s as DropboxAppKey) : null;
}

// ── pCloud config parsers ──────────────────────────────────────────────────────

/** Trims and brands a Client ID from Settings; null when empty (not yet configured). */
export function parsePCloudClientId(raw: string): PCloudClientId | null {
  const trimmed = raw.trim();
  return trimmed ? (trimmed as PCloudClientId) : null;
}

// ── GitLab config parsers ─────────────────────────────────────────────────────

/** Accepts `namespace/project` (subgroups allowed: `group/subgroup/project`).
 *  Rejects empty strings and bare single-segment names. */
export function parseProject(raw: string): GitLabProject | null {
  const s = raw.trim();
  return /^[^/\s]+(?:\/[^/\s]+)+$/.test(s) ? (s as GitLabProject) : null;
}

/** Normalises the instance host (strips a trailing slash), defaulting to gitlab.com. */
export function parseGitLabHost(raw: string): GitLabHost {
  return ((raw.trim() || GITLAB_DEFAULT_HOST).replace(/\/$/, '')) as GitLabHost;
}

/** Always succeeds — returns the default branch when the input is empty. */
export function parseGitLabBranch(raw: string): GitLabBranch {
  return (raw.trim() || GITLAB_DEFAULT_BRANCH) as GitLabBranch;
}
