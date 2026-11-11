// Change the store owner's sign-in email and password, on the database DATABASE_URL points to (the live one),
// from ADMIN_EMAIL and ADMIN_PASSWORD in .env. The owner types the password into .env themselves, so it never
// appears in a chat, a command or a file that goes to GitHub, and this script never prints it.
//   npm run owner:set
// Signs the owner out everywhere, so the next sign-in uses the new details.
import { closeDb, get, run } from '../src/lib/db.js';
import { endOtherSessions, hashPassword } from '../src/services/auth.js';
import { emailError, normalizeEmail, passwordError } from '../public/js/validation.js';

const email = normalizeEmail(process.env.ADMIN_EMAIL);
const password = process.env.ADMIN_PASSWORD || '';
const owner = await get("SELECT id, email FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
const taken = owner && !emailError(email) ? await get('SELECT id FROM users WHERE email = ? AND id <> ?', [email, owner.id]) : null;

if (!owner) {
  console.error('No owner account found.');
  process.exitCode = 1;
} else if (emailError(email)) {
  console.error('ADMIN_EMAIL in .env is not a valid email address.');
  process.exitCode = 1;
} else if (passwordError(password)) {
  console.error('ADMIN_PASSWORD in .env is too weak: use 8+ characters with an uppercase and a lowercase letter, a number and a symbol.');
  process.exitCode = 1;
} else if (taken) {
  console.error(`${email} already belongs to another account (#${taken.id}). Free that address first.`);
  process.exitCode = 1;
} else {
  await run('UPDATE users SET email = ?, password_hash = ? WHERE id = ?', [email, await hashPassword(password), owner.id]);
  await endOtherSessions(owner.id, null); // every device signs in again, with the new details
  console.log(`Owner sign-in changed: ${owner.email} -> ${email}, with the new password from .env. Signed out everywhere.`);
}
await closeDb();
