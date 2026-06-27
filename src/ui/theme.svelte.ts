/* Theme store — system-aware, persisted, applied to <html data-theme>.
 * A no-flash inline script in index.html sets the initial value before paint;
 * this keeps it in sync afterwards. Functional: createTheme() returns a plain
 * rune-backed object, no class. */

import { localStore } from '../persistence/local.js';
import { nsKey } from '../config.js';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** Parse a stored theme choice — the single narrowing site, defaulting to 'system'. */
function parseThemeChoice(raw: string | null): ThemeChoice {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

// localStorage + parsing are abstracted behind this store.
const themeStore = localStore<ThemeChoice>(nsKey('theme'), parseThemeChoice, (v) => v);

export function createTheme() {
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  let choice = $state<ThemeChoice>(themeStore.read());
  let systemDark = $state(mql.matches);

  const resolved = $derived<ResolvedTheme>(
    choice === 'system' ? (systemDark ? 'dark' : 'light') : choice
  );

  function apply(theme: ResolvedTheme): void {
    document.documentElement.dataset.theme = theme;
  }

  function set(next: ThemeChoice): void {
    choice = next;
    themeStore.write(next);
    apply(next === 'system' ? (systemDark ? 'dark' : 'light') : next);
  }

  // React to OS theme changes while the user is on "system".
  mql.addEventListener('change', (e) => {
    systemDark = e.matches;
    if (choice === 'system') apply(e.matches ? 'dark' : 'light');
  });

  return {
    get choice() {
      return choice;
    },
    get resolved() {
      return resolved;
    },
    set,
    /** Flip to the opposite of whatever is currently showing. */
    toggle(): void {
      set(resolved === 'dark' ? 'light' : 'dark');
    },
  };
}

export type Theme = ReturnType<typeof createTheme>;
