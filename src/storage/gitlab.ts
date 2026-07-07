import type { Storage, DocContent } from './types.js';
import { DocFormat, InputType, StorageAccess } from './types.js';
import type { StorageAuth } from './auth.js';
import { configStore } from './config.js';
import { filenameStore } from './filename.js';
import { extensionOf } from '../format/types.js';
import { localStore } from '../persistence/local.js';
import type { RoomId } from '../collaboration/types.js';
import {
  parseProject,
  parseGitLabHost,
  parseGitLabBranch,
  parseGitLabValidated,
  parseGitLabFileContent,
  parseGitLabAccessLevel,
} from './parse.js';
import {
  STORAGE_ID,
  GITLAB_API_PATH,
  GITLAB_DEFAULT_HOST,
  GITLAB_DEFAULT_BRANCH,
  GITLAB_DEFAULT_FILENAME,
  GITLAB_VALIDATED_KEY,
  BASE64_CHUNK,
} from './constants.js';

/** localStorage + parsing for the token-validated flag, abstracted behind read/write/clear. */
const validated = localStore<boolean>(
  GITLAB_VALIDATED_KEY,
  parseGitLabValidated,
  (on) => (on ? '1' : null),
);

// ── Branded types ─────────────────────────────────────────────────────────────

/** A Personal Access Token verified against the GitLab API. */
export type GitLabToken = string & { readonly _brand: 'GitLabToken' };

/** A validated `namespace/project` path (subgroups allowed). */
export type GitLabProject = string & { readonly _brand: 'GitLabProject' };

/** A normalised instance host, e.g. `https://gitlab.com` (no trailing slash). */
export type GitLabHost = string & { readonly _brand: 'GitLabHost' };

/** A normalised branch name — always has a value (defaults to `'main'`). */
export type GitLabBranch = string & { readonly _brand: 'GitLabBranch' };

// ── Config ────────────────────────────────────────────────────────────────────

const cfg = configStore(STORAGE_ID.gitlab, [
  {
    name: 'project',
    label: 'Project',
    placeholder: 'namespace/project',
    help: 'GitLab project path, e.g. alice/my-notes (subgroups allowed).',
    env: import.meta.env.VITE_GITLAB_PROJECT,
  },
  {
    name: 'host',
    label: 'Host',
    placeholder: GITLAB_DEFAULT_HOST,
    help: `Instance URL. Leave empty for ${GITLAB_DEFAULT_HOST}; set it for self-hosted GitLab.`,
    env: import.meta.env.VITE_GITLAB_HOST,
  },
  {
    name: 'branch',
    label: 'Branch',
    placeholder: GITLAB_DEFAULT_BRANCH,
    help: `Branch to commit to. Leave empty for the default branch (${GITLAB_DEFAULT_BRANCH}).`,
    env: import.meta.env.VITE_GITLAB_BRANCH,
  },
  {
    name: 'token',
    label: 'Personal Access Token',
    type: InputType.Password,
    placeholder: 'glpat-…',
    help: 'A PAT with the api (or read_repository + write_repository) scope.',
    env: import.meta.env.VITE_GITLAB_TOKEN,
  },
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function apiHeaders(token: GitLabToken): Record<string, string> {
  return { 'PRIVATE-TOKEN': token };
}

/** REST API base for the configured instance. */
function apiBase(host: GitLabHost): string {
  return `${host}${GITLAB_API_PATH}`;
}

/** Files API endpoint for the target file (project + path both URL-encoded). */
function filesUrl(host: GitLabHost, project: GitLabProject, path: string): string {
  return `${apiBase(host)}/projects/${encodeURIComponent(project)}/repository/files/${encodeURIComponent(path)}`;
}

/** Base64-encode, chunked to stay within stack limits on large files. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

/** Decode GitLab's base64 file content (it inserts newlines every 60 chars). */
function base64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64.replace(/\n/g, ''));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function gitlabStorage(room: RoomId): { auth: StorageAuth; storage: Storage } {
  const fileName = filenameStore(STORAGE_ID.gitlab, room, GITLAB_DEFAULT_FILENAME);
  // Whether the target file already exists — decides POST (create) vs PUT (update).
  // null = unknown; seeded by load() or a one-off existence check in save().
  let fileExists: boolean | null = null;
  // Guard against concurrent in-flight commits.
  let committing = false;

  // ── Credential resolvers (parse at the config boundary) ───────────────────

  function resolvedProject(): GitLabProject | null {
    return parseProject(cfg.config('project'));
  }

  function resolvedToken(): GitLabToken | null {
    const raw = cfg.config('token').trim();
    if (!raw) return null;
    // Env-managed tokens are deployment-trusted; user-entered tokens require a
    // successful login() (GET /user validation) before they are branded.
    if (cfg.configLocked('token')) return raw as GitLabToken;
    if (!validated.read()) return null;
    return raw as GitLabToken;
  }

  function resolvedHost(): GitLabHost {
    return parseGitLabHost(cfg.config('host'));
  }

  function resolvedBranch(): GitLabBranch {
    return parseGitLabBranch(cfg.config('branch'));
  }

  // ── Commit helper ─────────────────────────────────────────────────────────

  async function commitFile(
    tok: GitLabToken,
    host: GitLabHost,
    project: GitLabProject,
    branch: GitLabBranch,
    content: DocContent,
  ): Promise<void> {
    const bytes =
      content.format === DocFormat.Text
        ? new TextEncoder().encode(content.text)
        : content.bytes;
    const path = fileName.get();

    // Resolve create-vs-update if we don't yet know whether the file exists.
    if (fileExists === null) {
      const head = await fetch(
        `${filesUrl(host, project, path)}?ref=${encodeURIComponent(branch)}`,
        { headers: apiHeaders(tok) },
      );
      fileExists = head.ok;
    }

    const res = await fetch(filesUrl(host, project, path), {
      method: fileExists ? 'PUT' : 'POST',
      headers: { ...apiHeaders(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        branch,
        content: bytesToBase64(bytes),
        commit_message: `Update ${path}`,
        encoding: 'base64',
      }),
    });

    if (!res.ok) throw new Error(`GitLab save failed: ${res.status}`);
    fileExists = true;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  function setConfig(name: string, value: string): void {
    // Changing project, host, or token invalidates a prior Connect — force re-validation.
    if (name === 'token' || name === 'project' || name === 'host') validated.clear();
    cfg.setConfig(name, value);
  }

  const auth: StorageAuth = {
    isAuthenticated: () => resolvedToken() !== null && resolvedProject() !== null,

    async login() {
      const rawToken = cfg.config('token').trim();
      const project = resolvedProject();
      if (!rawToken || !project) {
        throw new Error('Fill in the project and token in Settings first.');
      }
      // Use the raw string here — we are the validation step; GitLabToken is
      // only produced after a successful response.
      const res = await fetch(`${apiBase(resolvedHost())}/user`, {
        headers: { 'PRIVATE-TOKEN': rawToken },
      });
      if (res.status === 401) {
        throw new Error('Invalid token — check it has api or write_repository scope.');
      }
      if (!res.ok) throw new Error(`GitLab auth check failed: ${res.status}`);
      validated.write(true);
    },

    logout() {
      validated.clear();
      fileExists = null;
    },

    configFields: cfg.fields,
    // Expose the effective host/branch defaults so Settings shows the real value.
    config: (name) =>
      name === 'branch' ? resolvedBranch()
      : name === 'host' ? resolvedHost()
      : cfg.config(name),
    setConfig,
    configLocked: cfg.configLocked,
    // project must be present and valid-format; host/branch default (always valid).
    configured: () => resolvedProject() !== null && cfg.config('token').trim().length > 0,
  };

  // ── Storage ───────────────────────────────────────────────────────────────

  const storage: Storage = {
    id: STORAGE_ID.gitlab,
    label: 'GitLab',
    availability: { ok: true },
    blurb:
      'Commits files to a GitLab project (gitlab.com or self-hosted) — stays human-readable and committable.',

    filename: () => fileName.get(),
    setFilename: (name) => { fileExists = null; fileName.set(name); },
    defaultFilename: () => GITLAB_DEFAULT_FILENAME,

    get contentFormat(): DocFormat {
      return extensionOf(fileName.get()) === '.yjs' ? DocFormat.Binary : DocFormat.Text;
    },

    async load(): Promise<DocContent | null> {
      const tok = resolvedToken();
      const project = resolvedProject();
      if (!tok) throw new Error('GitLab: not connected');
      if (!project) throw new Error('GitLab: project not configured');

      const branch = resolvedBranch();
      const res = await fetch(
        `${filesUrl(resolvedHost(), project, fileName.get())}?ref=${encodeURIComponent(branch)}`,
        { headers: apiHeaders(tok) },
      );

      if (res.status === 404) { fileExists = false; return null; }
      if (!res.ok) throw new Error(`GitLab load failed: ${res.status}`);

      fileExists = true;
      const bytes = base64ToBytes(parseGitLabFileContent(await res.json()));
      if (storage.contentFormat === DocFormat.Text) {
        return { format: DocFormat.Text, text: new TextDecoder().decode(bytes) };
      }
      return { format: DocFormat.Binary, bytes };
    },

    async save(content: DocContent): Promise<void> {
      if (committing) return;
      const tok = resolvedToken();
      const project = resolvedProject();
      if (!tok) throw new Error('GitLab: not connected');
      if (!project) throw new Error('GitLab: project not configured');
      committing = true;
      try {
        await commitFile(tok, resolvedHost(), project, resolvedBranch(), content);
      } finally {
        committing = false;
      }
    },

    async access(): Promise<StorageAccess> {
      const tok = resolvedToken();
      const project = resolvedProject();
      if (!tok || !project) return StorageAccess.Read;

      const res = await fetch(
        `${apiBase(resolvedHost())}/projects/${encodeURIComponent(project)}`,
        { headers: apiHeaders(tok) },
      );
      if (!res.ok) return StorageAccess.Read;

      const level = parseGitLabAccessLevel(await res.json());
      if (level >= 50) return StorageAccess.Owner;  // Owner
      if (level >= 30) return StorageAccess.Write;  // Developer / Maintainer
      return StorageAccess.Read;
    },
  };

  return { auth, storage };
}
