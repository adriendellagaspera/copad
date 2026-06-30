/**
 * Editor language + spellcheck preferences — browser-aware, persisted.
 * Language defaults to 'auto' (follows navigator.language); users can override
 * with any BCP-47 tag. Spellcheck defaults on and is independent of language.
 */

import { localStore } from '../persistence/local.js';
import { nsKey } from '../config.js';

/** 'auto' defers to navigator.language; any other value is a BCP-47 tag. */
export type LanguageChoice = string;
export const LANGUAGE_AUTO: LanguageChoice = 'auto';

function parseLanguageChoice(raw: string | null): LanguageChoice {
  const s = raw?.trim();
  return s && s.length > 0 ? s : LANGUAGE_AUTO;
}

function parseSpellcheck(raw: string | null): boolean {
  return raw === null ? true : raw === 'true';
}

const languageStore = localStore<LanguageChoice>(
  nsKey('language'),
  parseLanguageChoice,
  (v) => (v === LANGUAGE_AUTO ? null : v),
);

const spellcheckStore = localStore<boolean>(
  nsKey('spellcheck'),
  parseSpellcheck,
  String,
);

export function createLanguage() {
  let choice = $state<LanguageChoice>(languageStore.read());
  let spellcheck = $state(spellcheckStore.read());

  // 'auto' resolves to the browser locale at runtime — no reactivity needed
  // because navigator.language is fixed for the page lifetime.
  const resolved = $derived<string>(choice === LANGUAGE_AUTO ? navigator.language : choice);

  function setChoice(next: LanguageChoice): void {
    choice = next;
    languageStore.write(next);
  }

  function setSpellcheck(on: boolean): void {
    spellcheck = on;
    spellcheckStore.write(on);
  }

  return {
    get choice() { return choice; },
    get resolved() { return resolved; },
    get spellcheck() { return spellcheck; },
    setChoice,
    setSpellcheck,
  };
}

export type Language = ReturnType<typeof createLanguage>;
