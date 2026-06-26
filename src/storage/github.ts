import type { Storage, DocContent, StorageId, StorageAvailability, Filename } from './types.js';
import type { StorageAuth } from './auth.js';
import { configStore } from './config.js';
import { filenameStore } from './filename.js';
import { extensionOf } from '../format/types.js';

const API = 'https://api.github.com';
const VALIDATED_KEY = 'storage.github.validated';

// ── Branded types ─────────────────────────────────────────────────────────────

/** A Personal Access Token verified against the GitHub API. */
export type GitHubToken = string & { readonly _brand: 'GitHubToken' };

/** A validated `owner/repo` repository reference. */
export type GitHubRepo = string & { readonly _brand: 'GitHubRepo' };

/** A normalised branch name — always has a value (defaults to `'main'`). */
export type GitHubBranch = string & { readonly _brand: 'GitHubBranch' };

/** A file SHA returned by the GitHub Contents API, required to update an existing file. */
export type GitHubFileSha = string & { readonly _brand: 'GitHubFileSha' };

// ── Parse functions (single point of validation per type) ─────────────────────

/** Accepts `owner/repo` — rejects empty strings, bare names, and multi-segment paths. */
function parseRepo(raw: string): GitHubRepo | null {
  const s = raw.trim();
  return /^[^/\s]+\/[^/\s]+$/.test(s) ? (s as GitHubRepo) : null;
}

/** Always succeeds — returns `'main'` when the input is empty. */
function parseBranch(raw: string): GitHubBranch {
  return (raw.trim() || 'main') as GitHubBranch;
}

// ── Config ────────────────────────────────────────────────────────────────────

const fileName = filenameStore('github' as StorageId, 'notes.md' as Filename);

const cfg = configStore('github' as StorageId, [
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function apiHeaders(token: GitHubToken): Record<string, string> {
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

// ── Factory ───────────────────────────────────────────────────────────────────

export function githubStorage(): { auth: StorageAuth; storage: Storage } {
  // Current file's SHA — required by GitHub to update an existing file.
  let fileSha: GitHubFileSha | null = null;
  // Guard against concurrent in-flight commits.
  let committing = false;

  // ── Credential resolvers (parse at the config boundary) ───────────────────

  function resolvedRepo(): GitHubRepo | null {
    return parseRepo(cfg.config('repo'));
  }

  function resolvedToken(): GitHubToken | null {
    const raw = cfg.config('token').trim();
    if (!raw) return null;
    // Env-managed tokens are deployment-trusted; user-entered tokens require a
    // successful login() (GET /user validation) before they are branded.
    if (cfg.configLocked('token')) return raw as GitHubToken;
    if (!localStorage.getItem(VALIDATED_KEY)) return null;
    return raw as GitHubToken;
  }

  function resolvedBranch(): GitHubBranch {
    return parseBranch(cfg.config('branch'));
  }

  // ── Commit helper ─────────────────────────────────────────────────────────

  async function commitFile(
    tok: GitHubToken,
    repo: GitHubRepo,
    branch: GitHubBranch,
    content: DocContent,
  ): Promise<void> {
    const bytes =
      content.format === 'text'
        ? new TextEncoder().encode(content.text)
        : content.bytes;
    const path = fileName.get();

    const body: Record<string, unknown> = {
      message: `Update ${path}`,
      content: bytesToBase64(bytes),
      branch,
    };
    if (fileSha) body.sha = fileSha;

    const res = await fetch(`${API}/repos/${repo}/contents/${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers: { ...apiHeaders(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new Error(`GitHub save failed: ${String(err.message ?? res.status)}`);
    }

    const data = (await res.json()) as { content: { sha: string } };
    fileSha = data.content.sha as GitHubFileSha;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  function setConfig(name: string, value: string): void {
    // Changing repo or token invalidates a prior Connect — force re-validation.
    if (name === 'token' || name === 'repo') localStorage.removeItem(VALIDATED_KEY);
    cfg.setConfig(name, value);
  }

  const auth: StorageAuth = {
    isAuthenticated: () => resolvedToken() !== null && resolvedRepo() !== null,

    async login() {
      const rawToken = cfg.config('token').trim();
      const repo = resolvedRepo();
      if (!rawToken || !repo) {
        throw new Error('Fill in the repository and token in Settings first.');
      }
      // Use the raw string here — we are the validation step; GitHubToken is
      // only produced after a successful response.
      const res = await fetch(`${API}/user`, {
        headers: {
          Authorization: `Bearer ${rawToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (res.status === 401) {
        throw new Error('Invalid token — check it has Contents read and write access.');
      }
      if (!res.ok) throw new Error(`GitHub auth check failed: ${res.status}`);
      localStorage.setItem(VALIDATED_KEY, '1');
    },

    logout() {
      localStorage.removeItem(VALIDATED_KEY);
      fileSha = null;
    },

    configFields: cfg.fields,
    // Expose the 'main' default for branch so the Settings UI shows the effective value.
    config: (name) => (name === 'branch' ? resolvedBranch() : cfg.config(name)),
    setConfig,
    configLocked: cfg.configLocked,
    // repo must be present and valid-format; branch defaults to main (always valid).
    configured: () => resolvedRepo() !== null && cfg.config('token').trim().length > 0,
  };

  // ── Storage ───────────────────────────────────────────────────────────────

  const storage: Storage = {
    id: 'github' as StorageId,
    label: 'GitHub',
    availability: { ok: true } as StorageAvailability,
    blurb:
      'Commits files to a GitHub repository — great as a version-controlled knowledge base.',

    filename: () => fileName.get(),
    setFilename: fileName.set,

    get contentFormat(): DocContent['format'] {
      return extensionOf(fileName.get()) === '.yjs' ? 'binary' : 'text';
    },

    async load(): Promise<DocContent | null> {
      const tok = resolvedToken();
      const repo = resolvedRepo();
      if (!tok) throw new Error('GitHub: not connected');
      if (!repo) throw new Error('GitHub: repository not configured');

      const path = fileName.get();
      const branch = resolvedBranch();
      const res = await fetch(
        `${API}/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
        { headers: apiHeaders(tok) },
      );

      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GitHub load failed: ${res.status}`);

      const data = (await res.json()) as { content: string; sha: string };
      fileSha = data.sha as GitHubFileSha;

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
      const tok = resolvedToken();
      const repo = resolvedRepo();
      if (!tok) throw new Error('GitHub: not connected');
      if (!repo) throw new Error('GitHub: repository not configured');
      committing = true;
      try {
        await commitFile(tok, repo, resolvedBranch(), content);
      } finally {
        committing = false;
      }
    },
  };

  return { auth, storage };
}
