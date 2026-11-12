// The browser scripts as every page loads them (src/views/partials/scripts.ejs): each module public/js/app.js
// imports up front, directly or through another module, needs a modulepreload link there, so the browser
// fetches them all together with app.js instead of one level of imports after another.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
// `import { a } from './x.js'` or `import './x.js'` at the start of a line; not import('./x.js'), which
// fetches a page-only feature later.
const STATIC_IMPORT = /^\s*import\s+(?:[\w$*{},\s]+\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm;

/** The addresses (/js/…) of the modules `file` imports up front, and of the ones they import. */
function staticImports(file, found = new Set()) {
  for (const [, specifier] of fs.readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
    const target = path.resolve(path.dirname(file), specifier);
    const url = `/${path.relative(PUBLIC, target).split(path.sep).join('/')}`;
    if (found.has(url)) continue;
    found.add(url);
    staticImports(target, found);
  }
  return found;
}

test('every module app.js imports up front has a modulepreload link, and no other module does', () => {
  const partial = fs.readFileSync(path.join(ROOT, 'src', 'views', 'partials', 'scripts.ejs'), 'utf8');
  const preloaded = [...partial.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]);
  const imported = staticImports(path.join(PUBLIC, 'js', 'app.js'));
  assert.deepEqual([...preloaded].sort(), [...imported].sort());
  assert.equal(new Set(preloaded).size, preloaded.length, 'a module is listed twice');
});
