import type { ConfigField, StorageId } from './types.js';
import { localStore, type StorageKey } from '../persistence/local.js';
import { backendKey, type ConfigFieldName } from './constants.js';

export interface ConfigSpec extends ConfigField {
  /** Build-time value (VITE_* env var). Present ⇒ the field is locked. */
  env?: string;
}

export interface ConfigStore {
  fields: ConfigField[];
  config(name: string): string;
  setConfig(name: string, value: string): void;
  configLocked(name: string): boolean;
  configured(): boolean;
}

// Resolution order per field: env var → saved value.
export function configStore(id: StorageId, specs: ConfigSpec[]): ConfigStore {
  const spec = (name: string) => specs.find(s => s.name === name);
  // The one boundary where an adapter-defined field name becomes a storage key.
  const key = (name: string): StorageKey => backendKey(id, name as ConfigFieldName);
  const envOf = (name: string) => spec(name)?.env || '';
  const saved = (name: string) =>
    localStore<string>(key(name), (raw) => raw ?? '', (v) => v || null);
  const value = (name: string) => envOf(name) || saved(name).read();

  return {
    fields: specs.map(({ env: _env, ...field }) => field),

    config: value,

    setConfig(name, raw) {
      if (envOf(name)) return;
      saved(name).write(raw.trim());
    },

    configLocked: name => !!envOf(name),

    configured: () => specs.every(s => !!value(s.name)),
  };
}
