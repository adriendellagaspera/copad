import { localStore } from '../persistence/local.js';
import { nsKey } from '../config.js';

export const ThemeChoice = { Light: 'light', Dark: 'dark', System: 'system' } as const;
export type ThemeChoice = (typeof ThemeChoice)[keyof typeof ThemeChoice];

export const ResolvedTheme = { Light: 'light', Dark: 'dark' } as const;
export type ResolvedTheme = (typeof ResolvedTheme)[keyof typeof ResolvedTheme];

// Mirrors --surface (tokens.css), hand-synced with index.html's no-flash script, which cannot import this module.
const THEME_COLOR: Record<ResolvedTheme, string> = {
  [ResolvedTheme.Light]: '#ffffff',
  [ResolvedTheme.Dark]: '#1e1e24',
};

function parseThemeChoice(raw: string | null): ThemeChoice {
  return raw === ThemeChoice.Light || raw === ThemeChoice.Dark || raw === ThemeChoice.System
    ? raw
    : ThemeChoice.System;
}

const themeStore = localStore<ThemeChoice>(nsKey('theme'), parseThemeChoice, (v) => v);

// try/catch, not a `typeof window` check: matches local.ts's own SSR idiom ("SSR... throw here").
function systemDarkMedia(): MediaQueryList | null {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)');
  } catch {
    return null;
  }
}

export function createTheme() {
  const mql = systemDarkMedia();
  let choice = $state<ThemeChoice>(themeStore.read());
  let systemDark = $state(mql?.matches ?? false);

  const resolved = $derived<ResolvedTheme>(
    choice === ThemeChoice.System ? (systemDark ? ResolvedTheme.Dark : ResolvedTheme.Light) : choice
  );

  function apply(theme: ResolvedTheme): void {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
  }

  function set(next: ThemeChoice): void {
    choice = next;
    themeStore.write(next);
    apply(next === ThemeChoice.System ? (systemDark ? ResolvedTheme.Dark : ResolvedTheme.Light) : next);
  }

  mql?.addEventListener('change', (e) => {
    systemDark = e.matches;
    if (choice === ThemeChoice.System) apply(e.matches ? ResolvedTheme.Dark : ResolvedTheme.Light);
  });

  return {
    get choice() {
      return choice;
    },
    get resolved() {
      return resolved;
    },
    set,
    toggle(): void {
      set(resolved === ResolvedTheme.Dark ? ThemeChoice.Light : ThemeChoice.Dark);
    },
  };
}

export type Theme = ReturnType<typeof createTheme>;
