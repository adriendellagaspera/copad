import type { Storage, DocContent } from './types.js';
import type { StorageAuth } from './auth.js';
import { configStore } from './config.js';
import { filenameStore } from './filename.js';
import { extensionOf } from '../format/types.js';

const API = 'https://api.github.com';
const VALIDATED_KEY = 'storage.github.validated';

const fileName = filenameStore('github', 'notes.md');

const cfg = configStore('github', [
  {
    name: 'repo',
    label: 'Repository',
    placeholder: 'owner/repo',
    help: 'GitHub repository to save files in (e.g. alice/my-notes).',
    env: import.meta.env.VITE_GITHUB_REPO as string | undefined,
  },
  {
    name: 'branch',
    label: 'Branch',
    placeholder: 'main',
    help: 'Branch to commit to. Leave empty for the default branch (main).',
    env: import.meta.env.VITE_GITHUB_BRANCH as string | undefined,
  },
  {
    name: 'token',
    label: 'Personal Access Token',
    type: 'password' as const,
    placeholder: 'ghp_…',
    help: 'A fine-grained PAT with Contents: Read and write, or a classic token with the repo scope.',
    env: import.meta.env.VITE_GITHUB_TOKEN as string | undefined,
  },
]);

function apiHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** GitHub always requires base64. Chunked to stay within stack limits on large files. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function githubStorage(): { auth: StorageAuth; storage: Storage } {
  const token = (): string => cfg.config('token');
  const repo = (): string => cfg.config('repo');
  const branch = (): string => cfg.config('branch') || 'main';

  // Current file's SHA — required by GitHub to update an existing file.
  let fileSha: string | null = null;
  // Guard against concurrent in-flight commits.
  let committing = false;

  const validated = (): boolean => !!localStorage.getItem(VALIDATED_KEY);
  const setValidated = (v: boolean): void => {
    if (v) localStorage.setItem(VALIDATED_KEY, '1');
    else localStorage.removeItem(VALIDATED_KEY);
  };

  // Changing the repo or token invalidates a prior Connect — force re-validation.
  function setConfig(name: string, value: string): void {
    if (name === 'token' || name === 'repo') setValidated(false);
    cfg.setConfig(name, value);
  }

  async function commitFile(content: DocContent): Promise<void> {
    const tok = token();
    const r = repo();
    if (!tok) throw new Error('GitHub: not connected');
    if (!r) throw new Error('GitHub: no repository configured');

    const bytes =
      content.format === 'text'
        ? new TextEncoder().encode(content.text)
        : content.bytes;
    const path = fileName.get();

    const body: Record<string, unknown> = {
      message: `Update ${path}`,
      content: bytesToBase64(bytes),
      branch: branch(),
    };
    if (fileSha) body.sha = fileSha;

    const res = await fetch(`${API}/repos/${r}/contents/${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers: { ...apiHeaders(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new Error(`GitHub save failed: ${String(err.message ?? res.status)}`);
    }

    const data = (await res.json()) as { content: { sha: string } };
    fileSha = data.content.sha;
  }

  const auth: StorageAuth = {
    // Token is env-managed (always valid) or was explicitly validated via login().
    isAuthenticated: () =>
      (cfg.configLocked('token') && !!token() && !!repo()) ||
      (validated() && !!token() && !!repo()),

    async login() {
      const tok = token();
      if (!tok || !repo()) {
        throw new Error('Fill in the repository and token in Settings first.');
      }
      const res = await fetch(`${API}/user`, { headers: apiHeaders(tok) });
      if (res.status === 401) {
        throw new Error('Invalid token — check it has Contents read and write access.');
      }
      if (!res.ok) throw new Error(`GitHub auth check failed: ${res.status}`);
      setValidated(true);
    },

    logout() {
      setValidated(false);
      fileSha = null;
    },

    configFields: cfg.fields,
    // Expose the 'main' default for branch so the UI shows the effective value.
    config: (name) => (name === 'branch' ? branch() : cfg.config(name)),
    setConfig,
    configLocked: cfg.configLocked,
    // Only repo and token are required; branch defaults to main.
    configured: () => !!token() && !!repo(),
  };

  const storage: Storage = {
    id: 'github',
    label: 'GitHub',
    blurb:
      'Commits files to a GitHub repository — great as a version-controlled knowledge base.',

    filename: () => fileName.get(),
    setFilename: fileName.set,

    get contentFormat(): DocContent['format'] {
      return extensionOf(fileName.get()) === '.yjs' ? 'binary' : 'text';
    },

    async load(): Promise<DocContent | null> {
      const tok = token();
      const r = repo();
      if (!tok) throw new Error('GitHub: not connected');
      if (!r) throw new Error('GitHub: no repository configured');

      const path = fileName.get();
      const res = await fetch(
        `${API}/repos/${r}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch())}`,
        { headers: apiHeaders(tok) },
      );

      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GitHub load failed: ${res.status}`);

      const data = (await res.json()) as { content: string; sha: string };
      fileSha = data.sha;

      // GitHub always returns base64; strip the newlines it inserts every 60 chars.
      const raw = atob(data.content.replace(/\n/g, ''));
      const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));

      if (storage.contentFormat === 'text') {
        return { format: 'text', text: new TextDecoder().decode(bytes) };
      }
      return { format: 'binary', bytes };
    },

    async save(content: DocContent): Promise<void> {
      if (committing) return;
      committing = true;
      try {
        await commitFile(content);
      } finally {
        committing = false;
      }
    },
  };

  return { auth, storage };
}
