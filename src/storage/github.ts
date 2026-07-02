import type { Storage, DocContent } from './types.js';
import { DocFormat, InputType } from './types.js';
import type { StorageAuth } from './auth.js';
import { configStore } from './config.js';
import { filenameStore } from './filename.js';
import { extensionOf } from '../format/types.js';
import { localStore } from '../persistence/local.js';
import {
  parseRepo,
  parseBranch,
  parseGitHubValidated,
  parseGitHubErrorBody,
  parseGitHubCommitResponse,
  parseGitHubLoadResponse,
} from './parse.js';
import {
  STORAGE_ID,
  GITHUB_API_URL,
  GITHUB_VALIDATED_KEY,
  GITHUB_DEFAULT_FILENAME,
  GITHUB_DEFAULT_BRANCH,
  BASE64_CHUNK,
} from './constants.js';

/** localStorage + parsing for the token-validated flag, abstracted behind read/write/clear. */
const validated = localStore<boolean>(
  GITHUB_VALIDATED_KEY,
  parseGitHubValidated,
  (on) => (on ? '1' : null),
);

// ── Branded types ─────────────────────────────────────────────────────────────

/** A Personal Access Token verified against the GitHub API. */
export type GitHubToken = string & { readonly _brand: 'GitHubToken' };

/** A validated `owner/repo` repository reference. */
export type GitHubRepo = string & { readonly _brand: 'GitHubRepo' };

/** A normalised branch name — always has a value (defaults to `'main'`). */
export type GitHubBranch = string & { readonly _brand: 'GitHubBranch' };

/** A file SHA returned by the GitHub Contents API, required to update an existing file. */
export type GitHubFileSha = string & { readonly _brand: 'GitHubFileSha' };

// ── Config ────────────────────────────────────────────────────────────────────

const fileName = filenameStore(STORAGE_ID.github, GITHUB_DEFAULT_FILENAME);

const cfg = configStore(STORAGE_ID.github, [
  {
    name: 'repo',
    label: 'Repository',
    placeholder: 'owner/repo',
    help: 'GitHub repository to save files in (e.g. alice/my-notes).',
    env: import.meta.env.VITE_GITHUB_REPO,
  },
  {
    name: 'branch',
    label: 'Branch',
    placeholder: GITHUB_DEFAULT_BRANCH,
    help: `Branch to commit to. Leave empty for the default branch (${GITHUB_DEFAULT_BRANCH}).`,
    env: import.meta.env.VITE_GITHUB_BRANCH,
  },
  {
    name: 'token',
    label: 'Personal Access Token',
    type: InputType.Password,
    placeholder: 'ghp_…',
    help: 'A fine-grained PAT with Contents: Read and write, or a classic token with the repo scope.',
    env: import.meta.env.VITE_GITHUB_TOKEN,
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
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
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
    if (!validated.read()) return null;
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
      content.format === DocFormat.Text
        ? new TextEncoder().encode(content.text)
        : content.bytes;
    const path = fileName.get();

    const body: Record<string, unknown> = {
      message: `Update ${path}`,
      content: bytesToBase64(bytes),
      branch,
    };
    if (fileSha) body.sha = fileSha;

    const res = await fetch(`${GITHUB_API_URL}/repos/${repo}/contents/${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers: { ...apiHeaders(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = parseGitHubErrorBody(await res.json().catch(() => ({})));
      throw new Error(`GitHub save failed: ${String(err['message'] ?? res.status)}`);
    }

    fileSha = parseGitHubCommitResponse(await res.json()).content.sha;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  function setConfig(name: string, value: string): void {
    // Changing repo or token invalidates a prior Connect — force re-validation.
    if (name === 'token' || name === 'repo') validated.clear();
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
      const res = await fetch(`${GITHUB_API_URL}/user`, {
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
      validated.write(true);
    },

    logout() {
      validated.clear();
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
    id: STORAGE_ID.github,
    label: 'GitHub',
    availability: { ok: true },
    blurb:
      'Commits files to a GitHub repository — great as a version-controlled knowledge base.',

    filename: () => fileName.get(),
    setFilename: fileName.set,
    defaultFilename: () => GITHUB_DEFAULT_FILENAME,

    get contentFormat(): DocFormat {
      return extensionOf(fileName.get()) === '.yjs' ? DocFormat.Binary : DocFormat.Text;
    },

    async load(): Promise<DocContent | null> {
      const tok = resolvedToken();
      const repo = resolvedRepo();
      if (!tok) throw new Error('GitHub: not connected');
      if (!repo) throw new Error('GitHub: repository not configured');

      const path = fileName.get();
      const branch = resolvedBranch();
      const res = await fetch(
        `${GITHUB_API_URL}/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
        { headers: apiHeaders(tok) },
      );

      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GitHub load failed: ${res.status}`);

      const data = parseGitHubLoadResponse(await res.json());
      fileSha = data.sha;

      // GitHub always returns base64; strip the newlines it inserts every 60 chars.
      const raw = atob(data.content.replace(/\n/g, ''));
      const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));

      if (storage.contentFormat === DocFormat.Text) {
        return { format: DocFormat.Text, text: new TextDecoder().decode(bytes) };
      }
      return { format: DocFormat.Binary, bytes };
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
