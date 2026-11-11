import { all, run } from '../lib/db.js';

export const logSent = (to, type) => run("INSERT INTO email_log (to_addr, type, status) VALUES (?, ?, 'sent')", [to, type]);

export const logFailed = (to, type, error) => run(
  "INSERT INTO email_log (to_addr, type, status, error) VALUES (?, ?, 'failed', ?)",
  [to, type, error],
);

export const listLatest = (limit) => all('SELECT * FROM email_log ORDER BY id DESC LIMIT ?', [limit]);
