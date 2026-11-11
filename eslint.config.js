// ESLint (npm run lint): ESLint's recommended rules, which catch likely mistakes (unused variables, undefined
// names, unreachable code…). How the code is laid out is Prettier's job (.prettierrc), not ESLint's.
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    // Generated at build time (node_modules is skipped by ESLint itself).
    ignores: ['worker/files.generated.js', '.wrangler/'],
  },
  js.configs.recommended,
  {
    // `const { a, ...rest } = obj` is how the code leaves keys out of an object: `a` is unused on purpose.
    rules: { 'no-unused-vars': ['error', { ignoreRestSiblings: true }] },
  },
  {
    // The server, scripts, tests and the Cloudflare Worker (which runs with Node's APIs, nodejs_compat).
    files: ['**/*.{js,mjs,cjs}'],
    ignores: ['public/js/**'],
    languageOptions: { globals: globals.node },
  },
  {
    // The browser's scripts, except validation.js: the server imports it too, so it may use neither side's globals.
    files: ['public/js/**/*.js'],
    ignores: ['public/js/validation.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    // The browser test: the functions it hands to page.evaluate(), $eval() and waitForFunction() run in the page.
    files: ['scripts/e2e.mjs'],
    languageOptions: { globals: globals.browser },
  },
];
