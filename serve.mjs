// Entry point: `node serve.mjs` serves the store at http://localhost:3000
import { app } from './src/app.js';
import { config } from './src/config.js';
import { isSmtpConfigured } from './src/mailer.js';

app.listen(config.port, () => {
  console.log(`Eva Scarf running at ${config.baseUrl}`);
  if (!isSmtpConfigured()) console.log('SMTP is not configured: emails are saved to ./outbox instead of being sent.');
});
