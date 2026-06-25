import type { Storage, CredentialField, SessionCredentials, DocContent, StorageAccess } from './types.js';

const STORAGE_KEY = 'storage.gitlab';

interface GitLabConf {
  readonly token: string;
  readonly host: string;       // e.g. 'https://gitlab.com'
  readonly project: string;    // 'namespace/project' (unencoded)
  readonly path: string;
  readonly branch: string;
  readonly fileExists: boolean;
}

function conf(): GitLabConf | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GitLabConf) : null;
  } catch {
    return null;
  }
}

function persistConf(c: GitLabConf): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
}

function encProject(project: string): string {
  return encodeURIComponent(project);
}

function encPath(path: string): string {
  return encodeURIComponent(path);
}

function decodeContent(b64: string): string {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeContent(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
  return btoa(binary);
}

// Response shapes at the GitLab API IO boundary.
interface GitLabFileResponse {
  readonly content: string;
}

interface GitLabProjectResponse {
  readonly permissions?: {
    readonly project_access?: { readonly access_level?: number };
    readonly group_access?: { readonly access_level?: number };
  };
}

interface GitLabFileMutateBody {
  readonly branch: string;
  readonly content: string;
  readonly commit_message: string;
  readonly encoding: 'base64';
}

const credentialFields: CredentialField[] = [
  { name: 'token', label: 'Personal access token', type: 'password', placeholder: 'glpat-…' },
  { name: 'host', label: 'Host', placeholder: 'https://gitlab.com' },
  { name: 'project', label: 'Project', placeholder: 'namespace/project' },
  { name: 'path', label: 'File path', placeholder: 'notes/copad.md' },
  { name: 'branch', label: 'Branch', placeholder: 'main' },
];

function authHeaders(token: string): Record<string, string> {
  return { 'PRIVATE-TOKEN': token };
}

function api(host: string): string {
  return `${host}/api/v4`;
}

export function gitlabStorage(): Storage {
  return {
    id: 'gitlab',
    label: 'GitLab',
    blurb: 'Saves to a file in a GitLab repository — stays human-readable and committable.',
    credentialFields,

    isAuthenticated: () => !!conf(),

    contentFormat: 'text',

    async connect(creds: SessionCredentials = {}) {
      const { token = '', host = '', project = '', path = '', branch = '' } = creds;
      if (!token.trim() || !project.trim() || !path.trim()) {
        throw new Error('Token, project and file path are required');
      }

      const effectiveHost = (host.trim() || 'https://gitlab.com').replace(/\/$/, '');
      const effectiveBranch = branch.trim() || 'main';

      const repoRes = await fetch(
        `${api(effectiveHost)}/projects/${encProject(project)}`,
        { headers: authHeaders(token) }
      );
      if (repoRes.status === 401) throw new Error('GitLab: invalid token');
      if (repoRes.status === 404) throw new Error(`GitLab: project ${project} not found`);
      if (!repoRes.ok) throw new Error(`GitLab connect failed: ${repoRes.status}`);

      const fileRes = await fetch(
        `${api(effectiveHost)}/projects/${encProject(project)}/repository/files/${encPath(path)}?ref=${effectiveBranch}`,
        { headers: authHeaders(token) }
      );

      persistConf({ token, host: effectiveHost, project, path, branch: effectiveBranch, fileExists: fileRes.ok });
    },

    disconnect() {
      localStorage.removeItem(STORAGE_KEY);
    },

    async load(): Promise<DocContent | null> {
      const c = conf();
      if (!c) throw new Error('GitLab: not connected');

      const res = await fetch(
        `${api(c.host)}/projects/${encProject(c.project)}/repository/files/${encPath(c.path)}?ref=${c.branch}`,
        { headers: authHeaders(c.token) }
      );

      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GitLab load failed: ${res.status}`);

      const data = await res.json() as GitLabFileResponse;
      persistConf({ ...c, fileExists: true });
      return { format: 'text', text: decodeContent(data.content) };
    },

    async save(content: DocContent): Promise<void> {
      if (content.format !== 'text') throw new Error('GitLab storage expects text content');
      const c = conf();
      if (!c) throw new Error('GitLab: not connected');

      const body: GitLabFileMutateBody = {
        branch: c.branch,
        content: encodeContent(content.text),
        commit_message: 'copad: autosave',
        encoding: 'base64',
      };

      const res = await fetch(
        `${api(c.host)}/projects/${encProject(c.project)}/repository/files/${encPath(c.path)}`,
        {
          method: c.fileExists ? 'PUT' : 'POST',
          headers: { ...authHeaders(c.token), 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) throw new Error(`GitLab save failed: ${res.status}`);
      persistConf({ ...c, fileExists: true });
    },

    async access(): Promise<StorageAccess> {
      const c = conf();
      if (!c) throw new Error('GitLab: not connected');

      const res = await fetch(
        `${api(c.host)}/projects/${encProject(c.project)}`,
        { headers: authHeaders(c.token) }
      );
      if (!res.ok) return 'read';

      const data = await res.json() as GitLabProjectResponse;
      const level =
        data.permissions?.project_access?.access_level ??
        data.permissions?.group_access?.access_level ??
        0;

      if (level >= 50) return 'owner';  // Owner
      if (level >= 30) return 'write';  // Developer / Maintainer
      return 'read';
    },
  };
}
