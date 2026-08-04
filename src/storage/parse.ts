import type { Filename } from './types.js';
import { ClassifiedWriteError, WriteFailureKind } from './writeOutcome.js';
import type { GitHubRepo, GitHubBranch, GitHubFileSha } from './github.js';
import type { DropboxToken, DropboxAppKey } from './dropbox.js';
import type { WebDavBaseUrl, WebDavAuthHeader } from './webdav.js';
import type { PCloudToken, PCloudApiHost, PCloudClientId } from './pcloud.js';
import type { GitLabProject, GitLabBranch, GitLabHost } from './gitlab.js';
import type {
  S3Endpoint,
  S3Bucket,
  S3Region,
  S3KeyPrefix,
  S3AccessKeyId,
  S3SecretAccessKey,
} from './s3.js';
import type { GraphUserId, GraphSiteId, SharePointToken, SharePointFolder } from './sharepoint.js';
import type { GDriveFileId, GDriveToken, GDriveClientId } from './gdrive.js';
import type { OneDriveToken, OneDriveClientId } from './onedrive.js';
import { GITHUB_DEFAULT_BRANCH, GITLAB_DEFAULT_BRANCH, GITLAB_DEFAULT_HOST, S3_PREFIX, SHAREPOINT_FOLDER } from './constants.js';

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

/** pCloud fails inside an HTTP 200, so only a `fileids` entry proves a stored file. */
export interface PCloudUploadResponse {
  result: number;
  error?: string;
  fileids: number[];
}

export interface S3Conf {
  endpoint: S3Endpoint;
  bucket: S3Bucket;
  region: S3Region;
  prefix: S3KeyPrefix;
  accessKeyId: S3AccessKeyId;
  secretAccessKey: S3SecretAccessKey;
}

/** `siteId` null ⇒ the user's OneDrive; set ⇒ that SharePoint site's default drive. */
export interface SharePointConf {
  token: SharePointToken;
  siteId: GraphSiteId | null;
  folder: SharePointFolder;
}

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
    // Validated at the OAuth callback; JSON round-trips the brand.
    return { token: token as PCloudToken, host: host as PCloudApiHost };
  } catch {
    return null;
  }
}

export function parseS3Conf(raw: string | null): S3Conf | null {
  try {
    if (!raw) return null;
    const obj: unknown = JSON.parse(raw);
    if (typeof obj !== 'object' || obj === null) return null;
    const { endpoint, bucket, region, prefix, accessKeyId, secretAccessKey } =
      obj as Record<string, unknown>;
    if (
      typeof endpoint !== 'string' || typeof bucket !== 'string' ||
      typeof region !== 'string' || typeof prefix !== 'string' ||
      typeof accessKeyId !== 'string' || typeof secretAccessKey !== 'string'
    ) return null;
    // Validated at login(); JSON round-trips the brand.
    return {
      endpoint: endpoint as S3Endpoint,
      bucket: bucket as S3Bucket,
      region: region as S3Region,
      prefix: prefix as S3KeyPrefix,
      accessKeyId: accessKeyId as S3AccessKeyId,
      secretAccessKey: secretAccessKey as S3SecretAccessKey,
    };
  } catch {
    return null;
  }
}

export function parseSharePointConf(raw: string | null): SharePointConf | null {
  try {
    if (!raw) return null;
    const obj: unknown = JSON.parse(raw);
    if (typeof obj !== 'object' || obj === null) return null;
    const { token, siteId, folder } = obj as Record<string, unknown>;
    if (typeof token !== 'string') return null;
    return {
      token: token as SharePointToken,
      siteId: typeof siteId === 'string' ? (siteId as GraphSiteId) : null,
      folder: parseSharePointFolder(typeof folder === 'string' ? folder : ''),
    };
  } catch {
    return null;
  }
}

export function parseSharePointFolder(raw: string): SharePointFolder {
  const trimmed = raw.trim();
  return (trimmed || SHAREPOINT_FOLDER) as SharePointFolder;
}

export function parseGitHubValidated(raw: string | null): boolean {
  return raw !== null;
}

export function parseGitLabValidated(raw: string | null): boolean {
  return raw !== null;
}

export function parseFilename(raw: string | null, fallback: Filename): Filename {
  const trimmed = (raw ?? '').trim();
  return trimmed ? (trimmed as Filename) : fallback;
}

export function parsePCloudFileLinkResponse(raw: unknown): PCloudFileLinkResponse {
  if (typeof raw !== 'object' || raw === null)
    throw new Error('Unexpected pCloud file link response');
  const obj = raw as Record<string, unknown>;
  const { result, hosts, path } = obj;
  if (typeof result !== 'number' || !Array.isArray(hosts) || typeof path !== 'string')
    throw new Error('pCloud file link response malformed');
  return { result, hosts: hosts.filter((h): h is string => typeof h === 'string'), path };
}

export function parsePCloudUploadResponse(raw: unknown): PCloudUploadResponse {
  if (typeof raw !== 'object' || raw === null)
    throw new Error('Unexpected pCloud upload response');
  const obj = raw as Record<string, unknown>;
  const { result, error, fileids } = obj;
  if (typeof result !== 'number') throw new Error('pCloud upload response malformed');
  return {
    result,
    ...(typeof error === 'string' ? { error } : {}),
    fileids: Array.isArray(fileids) ? fileids.filter((f): f is number => typeof f === 'number') : [],
  };
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

export function parseGitLabFileContent(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null)
    throw new Error('Unexpected GitLab file response');
  const content = (raw as Record<string, unknown>)['content'];
  if (typeof content !== 'string') throw new Error('GitLab file response missing content');
  return content;
}

/** GitLab's effective access is the max of project- and group-level access. */
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

function rawGraphId(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null)
    throw new Error('Unexpected Graph response');
  const id = (raw as Record<string, unknown>)['id'];
  if (typeof id !== 'string') throw new Error('Graph response missing id');
  return id;
}

export function parseGraphUserId(raw: unknown): GraphUserId {
  return rawGraphId(raw) as GraphUserId;
}

export function parseGraphSiteId(raw: unknown): GraphSiteId {
  return rawGraphId(raw) as GraphSiteId;
}

export function parseGraphOwnerId(raw: unknown): GraphUserId | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const createdBy = (raw as Record<string, unknown>)['createdBy'];
  if (typeof createdBy !== 'object' || createdBy === null) return null;
  const user = (createdBy as Record<string, unknown>)['user'];
  if (typeof user !== 'object' || user === null) return null;
  const id = (user as Record<string, unknown>)['id'];
  return typeof id === 'string' ? (id as GraphUserId) : null;
}

export function parseGDriveTokenResponse(raw: unknown): { access_token: GDriveToken } {
  if (typeof raw !== 'object' || raw === null)
    throw new Error('Unexpected Google Drive token response');
  const { access_token } = raw as Record<string, unknown>;
  if (typeof access_token !== 'string')
    throw new Error('Google Drive token response missing access_token');
  return { access_token: access_token as GDriveToken };
}

export function parseGDriveFileList(raw: unknown): GDriveFileId | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const files = (raw as Record<string, unknown>)['files'];
  if (!Array.isArray(files) || files.length === 0) return null;
  const first = files[0];
  const id = typeof first === 'object' && first !== null
    ? (first as Record<string, unknown>)['id']
    : undefined;
  return typeof id === 'string' ? (id as GDriveFileId) : null;
}

export function parseGDriveCreatedFile(raw: unknown): GDriveFileId {
  if (typeof raw !== 'object' || raw === null)
    throw new Error('Unexpected Google Drive file response');
  const id = (raw as Record<string, unknown>)['id'];
  if (typeof id !== 'string') throw new Error('Google Drive file response missing id');
  return id as GDriveFileId;
}

export function parseGDriveCanEdit(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const caps = (raw as Record<string, unknown>)['capabilities'];
  if (typeof caps !== 'object' || caps === null) return false;
  return (caps as Record<string, unknown>)['canEdit'] === true;
}

export function parseGDriveClientId(raw: string): GDriveClientId | null {
  const s = raw.trim();
  return s ? (s as GDriveClientId) : null;
}

export function parseOneDriveTokenResponse(raw: unknown): { access_token: OneDriveToken } {
  if (typeof raw !== 'object' || raw === null)
    throw new Error('Unexpected OneDrive token response');
  const { access_token } = raw as Record<string, unknown>;
  if (typeof access_token !== 'string')
    throw new Error('OneDrive token response missing access_token');
  return { access_token: access_token as OneDriveToken };
}

export function parseOneDriveClientId(raw: string): OneDriveClientId | null {
  const s = raw.trim();
  return s ? (s as OneDriveClientId) : null;
}

export function parseOAuthCode(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;
  if (obj['type'] !== 'oauth-code') return null;
  const code = obj['code'];
  return typeof code === 'string' ? code : null;
}

/** `owner/repo` exactly — unlike GitLab, extra path segments are rejected. */
export function parseRepo(raw: string): GitHubRepo | null {
  const s = raw.trim();
  return /^[^/\s]+\/[^/\s]+$/.test(s) ? (s as GitHubRepo) : null;
}

export function parseBranch(raw: string): GitHubBranch {
  return (raw.trim() || GITHUB_DEFAULT_BRANCH) as GitHubBranch;
}

export function parseDropboxAppKey(raw: string): DropboxAppKey | null {
  const s = raw.trim();
  return s ? (s as DropboxAppKey) : null;
}

export function parsePCloudClientId(raw: string): PCloudClientId | null {
  const trimmed = raw.trim();
  return trimmed ? (trimmed as PCloudClientId) : null;
}

/** `namespace/project`, subgroups allowed (`group/subgroup/project`). */
export function parseProject(raw: string): GitLabProject | null {
  const s = raw.trim();
  return /^[^/\s]+(?:\/[^/\s]+)+$/.test(s) ? (s as GitLabProject) : null;
}

export function parseGitLabHost(raw: string): GitLabHost {
  return ((raw.trim() || GITLAB_DEFAULT_HOST).replace(/\/$/, '')) as GitLabHost;
}

export function parseGitLabBranch(raw: string): GitLabBranch {
  return (raw.trim() || GITLAB_DEFAULT_BRANCH) as GitLabBranch;
}

export function parseS3Endpoint(raw: string): S3Endpoint | null {
  const s = raw.trim();
  return s ? (s as S3Endpoint) : null;
}

export function parseS3Bucket(raw: string): S3Bucket | null {
  const s = raw.trim();
  return s ? (s as S3Bucket) : null;
}

export function parseS3Region(raw: string): S3Region | null {
  const s = raw.trim();
  return s ? (s as S3Region) : null;
}

export function parseS3AccessKeyId(raw: string): S3AccessKeyId | null {
  const s = raw.trim();
  return s ? (s as S3AccessKeyId) : null;
}

export function parseS3SecretAccessKey(raw: string): S3SecretAccessKey | null {
  const s = raw.trim();
  return s ? (s as S3SecretAccessKey) : null;
}

export function parseS3KeyPrefix(raw: string): S3KeyPrefix {
  return (raw.trim() || S3_PREFIX) as S3KeyPrefix;
}

/** Single narrowing site for an unknown `save()` rejection → {@link WriteFailureKind}
 *  (`docs/contract.md` §3.2). A migrated adapter throws {@link ClassifiedWriteError};
 *  an unmigrated one throws a bare `Error` or a DOM exception, which falls back to a
 *  best-effort guess from `DOMException.name` and finally `Unknown` — never locks on
 *  ignorance (persistHealth.ts). */
export function parseWriteFailure(err: unknown): WriteFailureKind {
  if (err instanceof ClassifiedWriteError) return err.kind;
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
        return WriteFailureKind.Denied;
      case 'NotFoundError':
        return WriteFailureKind.Missing;
      case 'NoModificationAllowedError':
      case 'QuotaExceededError':
        return WriteFailureKind.Rejected;
      default:
        return WriteFailureKind.Unknown;
    }
  }
  return WriteFailureKind.Unknown;
}
