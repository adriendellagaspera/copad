import { localStore } from '../persistence/local.js';
import type { SpellcheckEnabled } from './types.js';
import { nsKey } from '../config.js';

export type LanguageChoice = string & { readonly _brand: 'LanguageChoice' };
export const LANGUAGE_AUTO = 'auto' as LanguageChoice;

export function parseLanguageChoice(raw: string | null): LanguageChoice {
  const s = raw?.trim();
  return s && s.length > 0 ? (s as LanguageChoice) : LANGUAGE_AUTO;
}

function parseSpellcheck(raw: string | null): SpellcheckEnabled {
  return (raw === null ? true : raw === 'true') as SpellcheckEnabled;
}

const languageStore = localStore<LanguageChoice>(
  nsKey('language'),
  parseLanguageChoice,
  (v) => (v === LANGUAGE_AUTO ? null : v),
);

const spellcheckStore = localStore<SpellcheckEnabled>(
  nsKey('spellcheck'),
  parseSpellcheck,
  String,
);

export function createLanguage() {
  let choice = $state<LanguageChoice>(languageStore.read());
  let spellcheck = $state(spellcheckStore.read());

  // navigator.language is fixed for the page lifetime, so it needs no reactivity.
  const resolved = $derived<string>(choice === LANGUAGE_AUTO ? navigator.language : choice);

  function setChoice(next: LanguageChoice): void {
    choice = next;
    languageStore.write(next);
  }

  function setSpellcheck(on: SpellcheckEnabled): void {
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
