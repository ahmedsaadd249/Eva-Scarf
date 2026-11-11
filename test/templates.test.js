// Templates the way the Cloudflare Worker uses them: files from the bundle made at build time
// (scripts/build-worker-files.mjs), every template compiled once at startup, nothing read from disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { collectFiles } from '../scripts/build-worker-files.mjs';
import { useEmbeddedFiles } from '../src/lib/platform.js';
import { compileAllTemplates, hasTemplate, renderTemplate } from '../src/lib/templates.js';

const bundle = collectFiles();
const templateFiles = Object.keys(bundle.text).filter((k) => k.endsWith('.ejs'));
const icon = { name: 'trash', cls: 'h-4 w-4' };

// Rendered from disk first (the Node path), to compare with the bundle below.
const iconFromDisk = renderTemplate('views/partials/icon', icon);

// Two small templates to check how include() passes data.
const extra = {
  'src/views/test-only/outer.ejs': "<%= a %>|<%= b ?? 'no b' %>|<%- include('../test-only/inner', { b: 2 }) %>|<%= '<i>' %>",
  'src/views/test-only/inner.ejs': '<%= a %>-<%= b %>',
};
useEmbeddedFiles({ text: { ...bundle.text, ...extra }, binary: bundle.binary });
const count = compileAllTemplates();

test('the bundle has every page and email template, the translations and the email logo', () => {
  assert.ok(templateFiles.some((k) => k === 'src/views/shop/home.ejs'));
  assert.ok(templateFiles.some((k) => k === 'src/emails/_layout.ejs'));
  assert.ok('src/locales/ar.json' in bundle.text && 'src/locales/en.json' in bundle.text);
  assert.ok(bundle.binary['public/brand/email-monogram.png'].length > 100);
});

test('every template compiles at startup', () => {
  assert.equal(count, templateFiles.length + Object.keys(extra).length);
});

test('every include() points at a bundled template', () => {
  for (const file of templateFiles) {
    const name = file.slice('src/'.length, -'.ejs'.length);
    for (const [, target] of bundle.text[file].matchAll(/include\(\s*['"]([^'"]+)['"]/g)) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), target));
      assert.ok(hasTemplate(resolved), `${file} includes '${target}', which is not bundled`);
    }
  }
});

test('a bundled template renders the same as from disk', () => {
  assert.equal(renderTemplate('views/partials/icon', icon), iconFromDisk);
  assert.match(iconFromDisk, /<svg/);
});

test('include() sees the caller\'s data plus its own, and output is escaped', () => {
  assert.equal(renderTemplate('views/test-only/outer', { a: 1, b: undefined }), "1|no b|1-2|&lt;i&gt;");
});

test('a template missing from the bundle is an error, not compiled on the fly', () => {
  assert.equal(hasTemplate('views/nope'), false);
  assert.throws(() => renderTemplate('views/nope', {}), /Template not found: views\/nope/);
});
