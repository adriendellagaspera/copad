import type { ConfigField } from './types.js';
import { readString, writeString, removeKey } from '../localStore.js';

/**
 * A single configuration field plus its build-time default. When `env` is set
 * (an operator configured it via a VITE_* variable) the field is *locked*: the
 * value can't be edited at runtime and is treated as managed by the deployment.
 */
export interface ConfigSpec extends ConfigField {
  /** Build-time value (env var). Present ⇒ the field is locked. */
  env?: string;
}

/**
 * The slice of {@link Storage} that deals with one-time, operator/user-level
 * configuration (OAuth app keys and the like) — distinct from per-session
 * authentication. Persisted in `localStorage` under `storage.<id>.<name>`.
 */
export interface ConfigStore {
  fields: ConfigField[];
  config(name: string): string;
  setConfig(name: string, value: string): void;
  configLocked(name: string): boolean;
  configured(): boolean;
}

/**
 * Build a {@link ConfigStore} for a backend. Resolution order per field is
 * env var → saved value, matching the historic resolution chains in the
 * adapters (so values saved by the old credential form keep working).
 */
export function configStore(id: string, specs: ConfigSpec[]): ConfigStore {
  const spec = (name: string) => specs.find(s => s.name === name);
  const key = (name: string) => `storage.${id}.${name}`;
  const envOf = (name: string) => spec(name)?.env || '';
  const value = (name: string) => envOf(name) || readString(key(name)) || '';

  return {
    // Strip `env` from the public field descriptors — it's an implementation detail.
    fields: specs.map(({ env: _env, ...field }) => field),

    config: value,

    setConfig(name, raw) {
      if (envOf(name)) return; // locked by the deployment — ignore writes
      const trimmed = raw.trim();
      if (trimmed) writeString(key(name), trimmed);
      else removeKey(key(name));
    },

    configLocked: name => !!envOf(name),

    configured: () => specs.every(s => !!value(s.name)),
  };
}
