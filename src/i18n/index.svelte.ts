/**
 * Svelte context-based i18n. Call provideI18n(language) once in App.svelte;
 * every child component calls useI18n() to get a reactive translation handle.
 */

import { setContext, getContext } from 'svelte';
import type { Language } from '../ui/language.svelte.js';
import { en, type Messages } from './en.js';
import { fr } from './fr.js';

export type { Messages };

const I18N_KEY = Symbol('i18n');

const LOCALES: Record<string, Messages> = { en, fr };

function resolveLocale(tag: string): string {
  const primary = tag.split('-')[0].toLowerCase();
  return primary in LOCALES ? primary : 'en';
}

export type I18n = {
  readonly t: Messages;
};

export function provideI18n(language: Language): I18n {
  const t = $derived(LOCALES[resolveLocale(language.resolved)] ?? en);
  const i18n: I18n = { get t() { return t; } };
  setContext(I18N_KEY, i18n);
  return i18n;
}

export function useI18n(): I18n {
  return getContext<I18n>(I18N_KEY);
}
