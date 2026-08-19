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

// `storage/` or a same-directory `./` sibling, never a bare `(^|/)`: a sibling import from
// *inside* src/storage/ itself (`./pcloud.js`) carries no `storage/` path segment, only a caller
// from outside it does (`../storage/pcloud.js`) — but a bare `(^|/)name.js$` also matches
// `../persistence/local.js`, an unrelated file that happens to share the adapter name `local`
// (src/storage/local.ts, the File System Access adapter) with src/persistence/local.ts (the
// localStorage helper). `^\./` anchors the sibling form to "this exact directory", which
// `../persistence/...` (leading `..`) never satisfies.
const ADAPTER_IMPORT_REGEX =
  '(storage/|^\\./)(dropbox|pcloud|webdav|github|gitlab|s3|sharepoint|gdrive|onedrive|local)\\.js$';
const COLLAB_ADAPTER_IMPORT_REGEX = '^y-web(rtc|socket)$';

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
    // AGENTS.md "Hexagonal architecture rules": the domain never imports a concrete adapter — a
    // storage backend, or the y-webrtc/y-websocket transport underneath a Collab adapter. Covers
    // src/collaboration/ and src/storage/ themselves too, not just their callers: a cross-adapter
    // import (or a "support" file in either directory reaching around its own port) is the same
    // violation. src/storage/index.ts and the two Collab adapter files are the composition points
    // that legitimately construct every concrete backend, so they're the exemption, not the
    // domain. src/storage/parse.ts imports every backend's response-shape types (`import type`
    // only, zero runtime coupling) to parse IO-boundary JSON per AGENTS.md's own IO-boundary
    // rules — the one deliberate, narrow carve-out, mirroring reconcile-rs's std::net value-type
    // exception in check-domain-purity.sh.
    files: ['src/Editor.svelte', 'src/format/**/*.ts', 'src/collaboration/**/*.ts', 'src/storage/**/*.ts'],
    ignores: [
      'src/storage/index.ts',
      'src/storage/parse.ts',
      'src/collaboration/webrtc.ts',
      'src/collaboration/websocket.ts',
      'src/**/*.test.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: ADAPTER_IMPORT_REGEX, message: 'AGENTS.md: import only the Storage port, never a concrete adapter.' },
            { regex: COLLAB_ADAPTER_IMPORT_REGEX, message: 'AGENTS.md: import only the Collab port, never y-webrtc/y-websocket directly.' },
          ],
        },
      ],
    },
  },

  {
    // AGENTS.md "Type system rules": these files brand timing values as
    // Milliseconds/EpochMs (src/time.ts) instead of bare numbers — only
    // now() may call Date.now() directly, so every timestamp is branded at
    // one boundary. Scoped to the files that have adopted the convention so
    // far, not app-wide yet.
    files: [
      'src/collaboration/**/*.ts',
      'src/storage/**/*.ts',
      'src/ui/toasts.svelte.ts',
      'src/Editor.svelte',
      'src/App.svelte',
    ],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Use now() from src/time.ts instead of Date.now(), so the result is EpochMs-branded.',
        },
      ],
    },
  },

  {
    // AGENTS.md "Comments": ultra-concise, one line wherever possible. Checks
    // physical comment lines only, not code — this codebase's dense markup
    // and SVG data routinely exceed 120 chars on purpose, comments should not.
    files: ['src/**/*.{ts,svelte}'],
    plugins: {
      local: {
        rules: {
          'comment-max-len': {
            create(context) {
              const sourceCode = context.sourceCode ?? context.getSourceCode();
              return {
                Program() {
                  for (const comment of sourceCode.getAllComments()) {
                    for (let line = comment.loc.start.line; line <= comment.loc.end.line; line += 1) {
                      if ((sourceCode.lines[line - 1] ?? '').length > 120) {
                        context.report({
                          loc: { line, column: 0 },
                          message: 'AGENTS.md: comment line over 120 chars — shorten it, don\'t wrap it.',
                        });
                      }
                    }
                  }
                },
              };
            },
          },
        },
      },
    },
    rules: { 'local/comment-max-len': 'error' },
  },
);
