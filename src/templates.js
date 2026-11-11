// Page and email templates (EJS), for both Node and Cloudflare Workers.
// EJS turns each template into a JavaScript function with `new Function`. Cloudflare allows that only
// while a Worker starts up, never while it answers a request, so there every template is compiled once
// at startup (compileAllTemplates) and requests only call the compiled functions. Node does the same
// in production; in development it compiles on each render, so template edits show up without a restart.
//
// Templates are named by their path under src/ without .ejs: 'views/shop/home', 'emails/_layout'.
// include('icon') and include('../partials/icon') resolve from the including template's folder, as
// before. EJS looks an include up in its cache (ejs.cache) under the name our `includer` returns, and
// compileAllTemplates fills that cache, so an include never reads or compiles a file during a request.
import path from 'node:path';
import ejs from 'ejs';
import { config } from './config.js';
import { fileExists, hasEmbeddedFiles, listFiles, readText } from './platform.js';

const TEMPLATE_DIRS = ['src/views', 'src/emails'];
const compiled = new Map();

const fileOf = (name) => `src/${name}.ejs`;
const cacheKey = (name) => `/templates/${name}.ejs`; // the same on every platform, unlike real file paths

function resolveInclude(from, target) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(from), String(target).replace(/\.ejs$/, '')));
}

function compile(name) {
  const fn = ejs.compile(readText(fileOf(name)), {
    // No `filename`: with one, EJS checks the disk for every include before asking our includer.
    compileDebug: !config.isProd, // template line numbers in errors while developing
    cache: true, // includes come from ejs.cache…
    includer: (target) => {
      const included = resolveInclude(name, target);
      templateFn(included); // …so make sure it's there (or fail clearly if it doesn't exist)
      return { filename: cacheKey(included) };
    },
  });
  // Errors name the template, through includes too: "views/shop/home > views/partials/icon: …".
  const named = (data) => {
    try {
      return fn(data);
    } catch (err) {
      if (err instanceof Error) {
        err.message = `${name}${err.inTemplate ? ' > ' : ': '}${err.message}`;
        err.inTemplate = true;
      }
      throw err;
    }
  };
  ejs.cache.set(cacheKey(name), named);
  return named;
}

/** Compile every template now. The Cloudflare Worker calls this at startup. */
export function compileAllTemplates() {
  for (const dir of TEMPLATE_DIRS) {
    for (const file of listFiles(dir, '.ejs')) {
      const name = file.slice('src/'.length, -'.ejs'.length);
      compiled.set(name, compile(name));
    }
  }
  return compiled.size;
}

export function hasTemplate(name) {
  return hasEmbeddedFiles() ? compiled.has(name) : fileExists(fileOf(name));
}

function templateFn(name) {
  if (hasEmbeddedFiles()) {
    const fn = compiled.get(name);
    if (!fn) throw new Error(`Template not found: ${name}`); // compiling now isn't allowed on Cloudflare
    return fn;
  }
  if (!config.isProd) return compile(name);
  if (!compiled.has(name)) compiled.set(name, compile(name));
  return compiled.get(name);
}

/** Render a template (see the naming above) with `data`. */
export function renderTemplate(name, data = {}) {
  return templateFn(name)(data);
}

/**
 * Express view class (app.set('view', TemplateView)): looks views up by name instead of on disk and
 * renders them with renderTemplate. 'shop/home' is the template 'views/shop/home'.
 */
export class TemplateView {
  constructor(name) {
    this.name = name;
    const template = `views/${String(name).replace(/\.ejs$/, '').replace(/^\/+/, '')}`;
    this.path = hasTemplate(template) ? template : undefined; // Express reports "Failed to lookup view" if unset
  }

  render(options, callback) {
    let html;
    try {
      html = renderTemplate(this.path, options);
    } catch (err) {
      process.nextTick(callback, err);
      return;
    }
    process.nextTick(callback, null, html);
  }
}
