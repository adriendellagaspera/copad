// Enforces the handful of AGENTS.md rules that are mechanically checkable — see
// AGENTS.md's checklist for which rules stay human-reviewed and why (some have
// legitimate exceptions in this codebase that a blind regex would false-positive on).
//
// Deliberately NOT adopting `tseslint.configs.recommended` / `eslint-plugin-svelte`'s
// `flat/recommended` rule sets — those are a separate, much larger initiative (a
// general style baseline) than "gate the specific rules AGENTS.md already states".
// Only the parser wiring (`base` configs) is pulled in; every rule below is one this
// file adds on purpose.
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

const ADAPTER_IMPORT_REGEX =
  'storage/(dropbox|pcloud|webdav|github|gitlab|s3|sharepoint|gdrive|onedrive|local)\\.js$';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'deploy/**', 'e2e/**'] },

  tseslint.configs.base,
  ...svelte.configs['flat/base'],

  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },

  {
    // eslint-plugin-svelte also routes `.svelte.ts` rune modules through
    // svelte-eslint-parser; both need to know the real TS parser underneath.
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },

  {
    files: ['src/**/*.{ts,svelte}'],
    rules: {
      // AGENTS.md "Type system rules": no `any`.
      '@typescript-eslint/no-explicit-any': 'error',

      // AGENTS.md "Naming conventions": factory functions, not `class Foo implements Bar`.
      // `class X extends Error` stays legal — subclassing a built-in is the idiomatic
      // way to get real stack traces / `instanceof`, not the OO pattern this bans.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ClassDeclaration[implements.length > 0]',
          message: 'AGENTS.md: use a factory function returning a plain object, not a class implementing a port.',
        },
        {
          selector: 'ClassExpression[implements.length > 0]',
          message: 'AGENTS.md: use a factory function returning a plain object, not a class implementing a port.',
        },
      ],
    },
  },

  {
    // AGENTS.md "IO boundary rules": only src/persistence/local.ts touches localStorage.
    files: ['src/**/*.{ts,svelte}'],
    ignores: ['src/persistence/local.ts', 'src/**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'AGENTS.md: bind a key via localStore<T>() in src/persistence/local.ts instead.' },
      ],
    },
  },

  {
    // AGENTS.md "Hexagonal architecture rules": the domain never imports a concrete adapter.
    files: ['src/Editor.svelte', 'src/format/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ regex: ADAPTER_IMPORT_REGEX, message: 'AGENTS.md: import only the Storage port, never a concrete adapter.' }] },
      ],
    },
  },
);
