// The few things that differ between Node (local development, tests, scripts) and Cloudflare Workers.
// Each has a Node default; the Cloudflare entry point (worker/register.js) swaps in its own before the
// app is loaded.
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ROOT } from '../config/index.js';

// ---------- Project files (templates, translations, the email logo) ----------
// Node reads them from the project folder. A Worker has no project folder, so the build bundles them
// (scripts/build-worker-files.mjs) and the Worker registers that bundle here.
let embedded = null; // { text: { 'src/…': string }, binary: { 'public/…': base64 } }

export function useEmbeddedFiles(files) {
  embedded = files;
}

export const hasEmbeddedFiles = () => embedded !== null;

/** Contents of a project file, by its path from the project root ('src/locales/ar.json'). */
export function readText(rel) {
  if (!embedded) return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const text = embedded.text[rel];
  if (text === undefined) throw new Error(`File not bundled for the Worker: ${rel} (see scripts/build-worker-files.mjs)`);
  return text;
}

export function readBinary(rel) {
  if (!embedded) return fs.readFileSync(path.join(ROOT, rel));
  const data = embedded.binary[rel];
  if (data === undefined) throw new Error(`File not bundled for the Worker: ${rel} (see scripts/build-worker-files.mjs)`);
  return Buffer.from(data, 'base64');
}

export function fileExists(rel) {
  return embedded ? rel in embedded.text || rel in embedded.binary : fs.existsSync(path.join(ROOT, rel));
}

/** Paths (from the project root, with forward slashes) of the files under `dir` ending in `ext`. */
export function listFiles(dir, ext) {
  const names = embedded
    ? Object.keys(embedded.text).filter((k) => k.startsWith(`${dir}/`)).map((k) => k.slice(dir.length + 1))
    : fs.readdirSync(path.join(ROOT, dir), { recursive: true }).map((n) => String(n).split(path.sep).join('/'));
  return names.filter((n) => n.endsWith(ext)).map((n) => `${dir}/${n}`).sort();
}

// ---------- One request at a time ----------
/**
 * What belongs to one request on Cloudflare: its database connection and the work that has to finish
 * before that connection is closed (the response itself, emails sent in the background). Connections
 * can't be shared between requests there. On Node there is no scope and none of this is used.
 */
export class RequestScope {
  jobs = new Set();
  closers = [];

  track(promise) {
    const job = Promise.resolve(promise).catch(() => {}).finally(() => this.jobs.delete(job));
    this.jobs.add(job);
  }

  onFinish(close) {
    this.closers.push(close);
  }

  /** Wait for the response and background jobs (at most `limitMs`), then close what the request opened. */
  async finish(limitMs = 25_000) {
    const deadline = Date.now() + limitMs;
    while (this.jobs.size && Date.now() < deadline) {
      let timer;
      const timeout = new Promise((resolve) => { timer = setTimeout(resolve, deadline - Date.now()); });
      await Promise.race([Promise.allSettled([...this.jobs]), timeout]);
      clearTimeout(timer);
    }
    for (const close of this.closers.splice(0)) {
      await Promise.resolve().then(close).catch((err) => console.error('Could not close a request resource:', err.message));
    }
  }
}

export const requestScope = new AsyncLocalStorage();

/** Express middleware: on Cloudflare, the request's connection stays open until its response is done. */
export function trackResponse(req, res, next) {
  const scope = requestScope.getStore();
  if (scope) scope.track(new Promise((resolve) => {
    res.once('finish', resolve);
    res.once('close', resolve);
  }));
  next();
}

// ---------- Work that continues after the response ----------
let backgroundRunner = null;

/** How the platform keeps a request alive for background work (Cloudflare's waitUntil). */
export function setBackgroundRunner(run) {
  backgroundRunner = run;
}

/**
 * Let `promise` finish after the response has gone out (sending an email, a cleanup query).
 * Serverless platforms would otherwise freeze or stop the function as soon as the response is sent.
 */
export function keepAlive(promise) {
  requestScope.getStore()?.track(promise);
  backgroundRunner?.(promise);
  return promise;
}
