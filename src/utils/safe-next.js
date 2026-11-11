/**
 * Only allow redirects to paths on this site: starts with one "/", and no spaces, control characters
 * or backslashes anywhere (browsers drop tabs and newlines, so "/\t/evil.com" would become "//evil.com").
 */
export function safeNext(next, fallback = '/') {
  return typeof next === 'string' && /^\/(?![/\\])[^\x00-\x20\x7f\\]*$/.test(next) ? next : fallback;
}
