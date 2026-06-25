import type { Storage, CredentialField, SessionCredentials, DocContent, StorageAccess } from './types.js';

const STORAGE_KEY = 'storage.github';
const API = 'https://api.github.com';

// Persisted between sessions; SHA is updated after each load/save so the next
// PUT can supply the current blob SHA (GitHub requires it for updates).
interface GitHubConf {
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
  readonly path: string;
  readonly branch: string;
  readonly sha: string | null;
}

function conf(): GitHubConf | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GitHubConf) : null;
  } catch {
    return null;
  }
}

function persistConf(c: GitHubConf): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
}

// GitHub's Contents API returns base64 with embedded newlines; strip them before
// decoding. TextDecoder/TextEncoder handle arbitrary Unicode cleanly.
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

// Response shapes at the GitHub API IO boundary.
interface GitHubFileResponse {
  readonly content: string;
  readonly sha: string;
}

interface GitHubPutResponse {
  readonly content: { readonly sha: string };
}

interface GitHubRepoResponse {
  readonly permissions?: { readonly admin?: boolean; readonly push?: boolean };
}

interface GitHubPutBody {
  readonly message: string;
  readonly content: string;
  readonly branch: string;
  readonly sha?: string;
}

const credentialFields: CredentialField[] = [
  { name: 'token', label: 'Personal access token', type: 'password', placeholder: 'ghp_…' },
  { name: 'owner', label: 'Owner', placeholder: 'your-username' },
  { name: 'repo', label: 'Repository', placeholder: 'my-repo' },
  { name: 'path', label: 'File path', placeholder: 'notes/copad.md' },
  { name: 'branch', label: 'Branch', placeholder: 'main' },
];

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
}

export function githubStorage(): Storage {
  return {
    id: 'github',
    label: 'GitHub',
    blurb: 'Saves to a file in a GitHub repo — stays human-readable and committable.',
    credentialFields,

    isAuthenticated: () => !!conf(),

    contentFormat: 'text',

    async connect(creds: SessionCredentials = {}) {
      const { token = '', owner = '', repo = '', path = '', branch = 'main' } = creds;
      if (!token.trim() || !owner.trim() || !repo.trim() || !path.trim()) {
        throw new Error('Token, owner, repository and file path are required');
      }

      const repoRes = await fetch(`${API}/repos/${owner}/${repo}`, {
        headers: authHeaders(token),
      });
      if (repoRes.status === 401) throw new Error('GitHub: invalid token');
      if (repoRes.status === 404) throw new Error(`GitHub: repository ${owner}/${repo} not found`);
      if (!repoRes.ok) throw new Error(`GitHub connect failed: ${repoRes.status}`);

      // Grab the file's SHA upfront if the file already exists.
      const effectiveBranch = branch.trim() || 'main';
      const fileRes = await fetch(
        `${API}/repos/${owner}/${repo}/contents/${path}?ref=${effectiveBranch}`,
        { headers: authHeaders(token) }
      );
      const sha = fileRes.ok
        ? (await fileRes.json() as GitHubFileResponse).sha
        : null;

      persistConf({ token, owner, repo, path, branch: effectiveBranch, sha });
    },

    disconnect() {
      localStorage.removeItem(STORAGE_KEY);
    },

    async load(): Promise<DocContent | null> {
      const c = conf();
      if (!c) throw new Error('GitHub: not connected');

      const res = await fetch(
        `${API}/repos/${c.owner}/${c.repo}/contents/${c.path}?ref=${c.branch}`,
        { headers: authHeaders(c.token) }
      );

      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GitHub load failed: ${res.status}`);

      const data = await res.json() as GitHubFileResponse;
      persistConf({ ...c, sha: data.sha });
      return { format: 'text', text: decodeContent(data.content) };
    },

    async save(content: DocContent): Promise<void> {
      if (content.format !== 'text') throw new Error('GitHub storage expects text content');
      const c = conf();
      if (!c) throw new Error('GitHub: not connected');

      const body: GitHubPutBody = {
        message: 'copad: autosave',
        content: encodeContent(content.text),
        branch: c.branch,
        ...(c.sha ? { sha: c.sha } : {}),
      };

      const res = await fetch(
        `${API}/repos/${c.owner}/${c.repo}/contents/${c.path}`,
        {
          method: 'PUT',
          headers: { ...authHeaders(c.token), 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) throw new Error(`GitHub save failed: ${res.status}`);
      const data = await res.json() as GitHubPutResponse;
      persistConf({ ...c, sha: data.content.sha });
    },

    async access(): Promise<StorageAccess> {
      const c = conf();
      if (!c) throw new Error('GitHub: not connected');

      const res = await fetch(`${API}/repos/${c.owner}/${c.repo}`, {
        headers: authHeaders(c.token),
      });
      if (!res.ok) return 'read';

      const data = await res.json() as GitHubRepoResponse;
      if (data.permissions?.admin) return 'owner';
      if (data.permissions?.push) return 'write';
      return 'read';
    },
  };
}
