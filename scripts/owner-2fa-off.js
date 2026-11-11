// If the owner can't receive sign-in codes any more (no access to that inbox), switch the second step off:
//   npm run owner:2fa-off
// Uses DATABASE_URL from .env (the live database). Then sign in with the password at /admin/login and set
// up a new inbox in Dashboard → Settings.
import { closeDb, run } from '../src/lib/db.js';

const { changes } = await run("UPDATE users SET otp_email = NULL WHERE role = 'admin' AND otp_email IS NOT NULL");
console.log(changes
  ? 'Sign-in codes switched off for the owner. Sign in with the password, then set up a new inbox in Settings.'
  : 'Nothing to do: sign-in codes were not switched on.');
await closeDb();
