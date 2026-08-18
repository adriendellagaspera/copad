import { untrack } from 'svelte';
import { localStore } from '../persistence/local.js';
import { nsKey } from '../config.js';

// Curated system-font stacks only — no new self-hosted font files. An
// arbitrary user-supplied family/URL is the deliberately deferred, harder
// version (#357): loading, CSP and licensing all need answering first.
export const FontChoice = {
  Default: 'default',
  System: 'system',
  Serif: 'serif',
  Mono: 'mono',
} as const;
export type FontChoice = (typeof FontChoice)[keyof typeof FontChoice];

interface FontStack {
  readonly ui: string;
  readonly read: string;
}

const SYSTEM_SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const SYSTEM_SERIF = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
const SYSTEM_MONO = 'ui-monospace, "SF Mono", "JetBrains Mono", "Fira Code", monospace';

// Default mirrors tokens.css's own :root values exactly, so switching back
// to it resets the inline override rather than leaving a stale one in place.
const STACKS: Record<FontChoice, FontStack> = {
  [FontChoice.Default]: {
    ui: `"Inter", ${SYSTEM_SANS}`,
    read: `"Source Serif 4", ${SYSTEM_SERIF}`,
  },
  [FontChoice.System]: { ui: SYSTEM_SANS, read: SYSTEM_SANS },
  [FontChoice.Serif]: { ui: SYSTEM_SERIF, read: SYSTEM_SERIF },
  [FontChoice.Mono]: { ui: SYSTEM_MONO, read: SYSTEM_MONO },
};

function parseFontChoice(raw: string | null): FontChoice {
  return raw === FontChoice.System || raw === FontChoice.Serif || raw === FontChoice.Mono
    ? raw
    : FontChoice.Default;
}

const fontStore = localStore<FontChoice>(nsKey('font'), parseFontChoice, (v) => v);

// try/catch, not a `typeof document` check: matches local.ts's own SSR idiom ("SSR... throw here").
function applyFont(choice: FontChoice): void {
  try {
    const stack = STACKS[choice];
    document.documentElement.style.setProperty('--font-ui', stack.ui);
    document.documentElement.style.setProperty('--font-read', stack.read);
  } catch {
    /* SSR: no document. */
  }
}

export function createFontChoice() {
  let choice = $state<FontChoice>(fontStore.read());
  applyFont(untrack(() => choice));

  function set(next: FontChoice): void {
    choice = next;
    fontStore.write(next);
    applyFont(next);
  }

  return {
    get choice() {
      return choice;
    },
    set,
  };
}

export type FontPreference = ReturnType<typeof createFontChoice>;
