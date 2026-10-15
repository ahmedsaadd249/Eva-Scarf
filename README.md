# Eva Scarf: online store for Sudanese tarhas

An Arabic-first (with English) online store for Eva Scarf. Customers register, save their
delivery address, add tarhas to their cart and order with cash on delivery. The owner manages
orders, products, prices, discounts, stock and delivery fees from a dashboard. Emails go out at
every step.

**Live setup:** the app runs on **Vercel**, the data lives in **Supabase** (a Postgres database you
can browse in its Table Editor, plus Storage for product photos), and emails are sent through
**Brevo**. The code is kept on **GitHub**; every push deploys automatically.

---

## Deploying (GitHub → Supabase → Brevo → Vercel)

You need four free accounts. Do them in this order; each step lists exactly what to copy.

### 1. GitHub: where the code lives
1. Sign up at <https://github.com> (free).
2. Create a **private** repository named `eva-scarf` (no README, no .gitignore: the project has its own).
3. Push the code (from this folder):
   ```bash
   gh auth login                       # once; or use the GitHub Desktop app
   git remote add origin https://github.com/<your-username>/eva-scarf.git
   git push -u origin main
   ```

### 2. Supabase: the database and photo storage
1. Sign up at <https://supabase.com> and click **New project**.
   - Name: `eva-scarf` · Region: **Central EU (Frankfurt)** (closest to Egypt) · choose a strong **database password** and keep it.
2. When the project is ready, collect three values:
   - **DATABASE_URL**: click **Connect** (top bar) → **Transaction pooler** → copy the URI
     (it looks like `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`)
     and put your database password in place of `[YOUR-PASSWORD]`.
   - **SUPABASE_URL**: Project Settings → **API** → Project URL (`https://xxxx.supabase.co`).
   - **SUPABASE_SERVICE_ROLE_KEY**: Project Settings → **API** → `service_role` secret. Keep it private.
3. Put the three values in your local `.env`, then create the tables, the photo bucket and the owner account:
   ```bash
   npm run db:setup
   ```
4. Move the store's current data (products, photos, neighborhoods and fees, accounts) from this computer into Supabase:
   ```bash
   npm run migrate:sqlite -- --replace
   ```
   (Only needed once. `--replace` empties the Supabase tables first.)

**Reading the data:** in Supabase, open **Table Editor**. `orders`, `order_items`, `users`, `products`,
`zones` (neighborhoods and fees) and the rest are all there; you can view, filter, export to CSV and
edit rows. Photos are under **Storage → product-images**. The tables are locked against Supabase's
public API (row level security), so only the store's server can read or change them.

### 3. Brevo: sending the emails
1. Sign up at <https://www.brevo.com> (free plan: 300 emails/day).
2. Add and verify your sender address: **Senders, domains & dedicated IPs → Senders → Add a sender**, then confirm the code Brevo emails you.
3. **Settings → SMTP & API → SMTP** tab: note the **login** (like `1234567@smtp-brevo.com`) and click **Generate a new SMTP key**.
4. Check it from this computer: add the values to `.env` (see `.env.example`), then
   `npm run test-email -- you@example.com`.

For the best inbox placement, later add your own domain in Brevo (it walks you through the DNS
records) and send from an address on that domain rather than a Gmail address.

### 4. Vercel: hosting the site
1. Sign up at <https://vercel.com> **with your GitHub account**.
2. **Add New → Project**, pick the `eva-scarf` repository, leave the build settings as they are.
3. Before clicking Deploy, open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | from Supabase (step 2) |
   | `SUPABASE_URL` | from Supabase |
   | `SUPABASE_SERVICE_ROLE_KEY` | from Supabase |
   | `SESSION_SECRET` | a long random string (e.g. from <https://1password.com/password-generator>, 40+ characters) |
   | `SMTP_HOST` | `smtp-relay.brevo.com` |
   | `SMTP_PORT` | `587` |
   | `SMTP_USER` | Brevo SMTP login |
   | `SMTP_PASS` | Brevo SMTP key |
   | `MAIL_FROM` | `Eva Scarf <your-verified-sender@example.com>` |
   | `BASE_URL` | your site address, e.g. `https://eva-scarf.vercel.app` (or your own domain later) |

4. Click **Deploy**. When it's done, open the site and sign in at `/account/login` with the owner account.
5. Later changes: push to GitHub and Vercel redeploys automatically.

**Plan note:** Vercel's free Hobby plan is for non-commercial use. A store that sells products should be
on **Vercel Pro** under their terms. Supabase and Brevo free plans are enough to start; Supabase pauses
free projects only after a week with no activity at all.

**Own domain:** Vercel → Project → Settings → Domains → add `evascarf.com` (or similar) and follow the DNS
instructions; then update `BASE_URL`.

---

## Run it locally

Requires **Node.js 22.13 or newer** (24 recommended). Without `DATABASE_URL`, the store uses a built-in
local database (an embedded Postgres in `data/pglite`): nothing else to install.

```bash
npm install
cp .env.example .env      # then edit .env: set ADMIN_EMAIL and ADMIN_PASSWORD
npm run seed              # creates the owner account (add -- --samples for 14 demo tarhas)
npm start                 # http://localhost:3000
```

The owner signs in at `/account/login` and lands on the dashboard at `/admin`.
Scripts (`seed`, `import-collection`, `migrate:sqlite`) use the same database as the server; for the
local database, stop the server first (it can only be open in one program at a time).

## What customers can do

| Step | Details |
|---|---|
| Create an account | Name, email (must be a valid address with `@` and a domain), and a strong password: 8+ characters with upper and lower case, a number and a symbol. Checked live in the browser and again on the server. |
| Welcome email | Sent immediately after registering. |
| Profile | City and neighborhood chosen from the delivery list, then street, building number and apartment number (all required); a primary and a second phone number (both required, and they must differ). Arabic-Indic digits are accepted. |
| Cart | Totals are calculated on the server: subtotal, discount, delivery fee (set by the neighborhood saved in the customer's account), total. Quantities can't exceed stock. |
| Checkout | Cash on delivery. Stock is taken in one transaction, so two customers can't buy the last piece. |
| Order confirmation email | Order number, every item **with its photo embedded in the email**, totals, address. |
| Status emails | An email for each change: Processing → Shipped → Delivered. The Delivered email asks the customer to rate the order (1–5 stars + comment). |
| My orders | Order history with a status timeline. |
| Forgot password | Emailed reset link, valid for one hour. Resetting signs the account out everywhere else. |

## What the owner can do (`/admin`)

- **Overview:** orders per status, revenue from delivered orders, cash still to collect, average rating, low stock, latest orders.
- **Orders:** filter by status, search by order number, name, phone or neighborhood. Each order shows the customer name, email, both phones, the full address (city, neighborhood, street, building, apartment), the items with photos and prices, the status history and the rating. One click changes the status and emails the customer.
- **Products:** add/edit with an optional Arabic + English name (a tarha can have no name), description, photos (resized in the browser before upload), price, discount % and stock. Prices, discounts, stock and visibility can also be edited straight from the product list. **Bulk discount:** apply or remove a % for selected products or for everything. **Delete:** products that were never ordered are deleted; products in past orders are archived (hidden) so order history stays intact, and can be restored.
- **Delivery:** neighborhoods grouped by city, each with its own delivery fee. A neighborhood with no fee is hidden from customers; 0 means free delivery. Add or delete neighborhoods here.
- **Settings:** a contact email shown in the footer. The page also shows whether email sending is connected and the latest emails sent.

## Emails

Until SMTP is configured, every email is **saved to `./outbox`** instead of being sent: a `.html` file
to open in a browser and a `.eml` file (the real message, with images embedded) for Outlook or
Windows Mail. On Vercel, configure Brevo (step 3 above), since there is no outbox folder to look in.

## Adding photos in bulk

Drop photos into `Collection/` and run `npm run import-collection`. Each photo becomes a hidden draft
product (a sub-folder becomes one product with several photos), uploaded to Supabase Storage when it's
configured. Then open **Products → Hidden** to price and publish them. Already-imported files are skipped.

## Tests

```bash
npm test         # unit tests: validation rules, pricing, orders (incl. two customers racing for the last piece)
npm run e2e      # full browser run of every workflow (needs ADMIN_EMAIL/ADMIN_PASSWORD in .env)
```

Both use a throwaway in-memory database, so they never touch real orders or products. `npm run e2e`
registers a customer, fills the profile, orders, then signs in as the owner, ships and delivers the
order, rates it, prices a neighborhood, and adds/edits/discounts/deletes a product. Screenshots of
each step are saved in `temporary screenshots/`.

## Project layout

```
api/index.js              Vercel entry point (hands every request to the Express app)
serve.mjs                 local entry point (port 3000)
vercel.json               Vercel routing and the files bundled with the app
src/app.js                Express setup: security headers, sessions, CSRF, language, routes
src/routes/               shop, cart, checkout, account, rating, admin
src/views/                EJS pages (layouts/, partials/, shop/, account/, admin/)
src/emails/               email templates (Arabic + English)
src/locales/              ar.json, en.json: all text on the site and in emails
src/db.js, schema.sql     Postgres (Supabase in production, embedded locally)
src/storage.js            product photos (Supabase Storage in production, uploads/ locally)
src/pricing.js            the only place prices and totals are calculated
public/js/validation.js   validation rules shared by the browser and the server
scripts/                  db:setup, migration, e2e test, collection import, test email
```

Security: passwords hashed with scrypt; CSRF tokens on every form; rate-limited sign-in, sign-up and
reset; session cookies are httpOnly, SameSite and Secure in production; all SQL is parameterised;
uploads are checked by content, not just file name; the dashboard is restricted to the owner role on
the server; database tables are closed to Supabase's public API.

The pages use the Tailwind CDN script, as required by the project's design rules. It works in
production but logs a console notice; switching to a Tailwind CLI build later is a contained change.
