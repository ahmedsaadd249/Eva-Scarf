// npm run test-email -- you@example.com [ar|en]
// Sends one real email through the SMTP settings in .env to check they work.
import { emailError, normalizeEmail } from '../public/js/validation.js';
import { isSmtpConfigured } from '../src/mailer.js';
import { sendTestEmail } from '../src/emails.js';
import { closeDb } from '../src/db.js';

const to = normalizeEmail(process.argv[2]);
const lang = process.argv[3] === 'en' ? 'en' : 'ar';

if (emailError(to)) {
  console.error('Usage: npm run test-email -- you@example.com [ar|en]');
  process.exit(1);
}
if (!isSmtpConfigured()) {
  console.log('SMTP_HOST / SMTP_USER / SMTP_PASS are not set in .env, so the email will be saved to ./outbox instead.');
}

const ok = await sendTestEmail(to, lang);
if (!ok) console.log('Sending failed; see the error above.');
else if (isSmtpConfigured()) console.log(`Sent a test email to ${to}. Check the inbox (and the spam folder).`);
else console.log('Saved to ./outbox (not sent). Add the Brevo SMTP settings to .env to send for real.');
await closeDb(); // otherwise the open database keeps the script running
process.exitCode = ok ? 0 : 1;
