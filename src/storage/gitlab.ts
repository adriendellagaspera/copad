import type { DocContent, Filename, Storage, StorageLabel } from './types.js';
import { DocFormat, InputType, StorageAccess } from './types.js';
import type { StorageAuth } from './auth.js';
import { configStore } from './config.js';
import { filenameStore } from './filename.js';
import { extensionOf } from '../format/types.js';
import { localStore } from '../persistence/local.js';
import type { RoomId } from '../collaboration/types.js';
import { landed, skipped, writeFailure, classifyHttpStatus, WriteSkip, WriteFailureKind, type WriteReceipt } from './writeOutcome.js';
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

const validated = localStore<boolean>(
  GITLAB_VALIDATED_KEY,
  parseGitLabValidated,
  (on) => (on ? '1' : null),
);

export type GitLabToken = string & { readonly _brand: 'GitLabToken' };
export type GitLabProject = string & { readonly _brand: 'GitLabProject' };
export type GitLabHost = string & { readonly _brand: 'GitLabHost' };
export type GitLabBranch = string & { readonly _brand: 'GitLabBranch' };

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

function apiHeaders(token: GitLabToken): Record<string, string> {
  return { 'PRIVATE-TOKEN': token };
}

function apiBase(host: GitLabHost): string {
  return `${host}${GITLAB_API_PATH}`;
}

function filesUrl(host: GitLabHost, project: GitLabProject, path: Filename): string {
  return `${apiBase(host)}/projects/${encodeURIComponent(project)}/repository/files/${encodeURIComponent(path)}`;
}

// Chunked: a single String.fromCharCode(...bytes) overflows the stack on large files.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

// GitLab's base64 carries newlines every 60 chars.
function base64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64.replace(/\n/g, ''));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function gitlabStorage(room: RoomId): { auth: StorageAuth; storage: Storage } {
  const fileName = filenameStore(STORAGE_ID.gitlab, room, GITLAB_DEFAULT_FILENAME);
  // GitLab splits create/update across POST/PUT; null = not yet known.
  let fileExists: boolean | null = null;
  let committing = false;

  function resolvedProject(): GitLabProject | null {
    return parseProject(cfg.config('project'));
  }

  function resolvedToken(): GitLabToken | null {
    const raw = cfg.config('token').trim();
    if (!raw) return null;
    // Env-managed tokens are deployment-trusted; user-entered ones need login() first.
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

    if (!res.ok) {
      fileExists = null;
      throw writeFailure(classifyHttpStatus(res.status), `GitLab save failed: ${res.status}`);
    }
    fileExists = true;
  }

  function setConfig(name: string, value: string): void {
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
      // Raw string on purpose: this call is what brands the token.
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
    // Settings shows the effective host/branch, not the empty raw values.
    config: (name) =>
      name === 'branch' ? resolvedBranch()
      : name === 'host' ? resolvedHost()
      : cfg.config(name),
    setConfig,
    configLocked: cfg.configLocked,
    configured: () => resolvedProject() !== null && cfg.config('token').trim().length > 0,
  };

  const storage: Storage = {
    id: STORAGE_ID.gitlab,
    label: 'GitLab' as StorageLabel,
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

    async save(content: DocContent): Promise<WriteReceipt> {
      if (committing) return skipped(WriteSkip.Coalesced);
      const tok = resolvedToken();
      const project = resolvedProject();
      if (!tok) throw writeFailure(WriteFailureKind.Denied, 'GitLab: not connected');
      if (!project) throw writeFailure(WriteFailureKind.Missing, 'GitLab: project not configured');
      committing = true;
      try {
        await commitFile(tok, resolvedHost(), project, resolvedBranch(), content);
        return landed();
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

      // GitLab access levels: 50 = Owner, 30 = Developer.
      const level = parseGitLabAccessLevel(await res.json());
      if (level >= 50) return StorageAccess.Owner;
      if (level >= 30) return StorageAccess.Write;
      return StorageAccess.Read;
    },
  };

  return { auth, storage };
}
