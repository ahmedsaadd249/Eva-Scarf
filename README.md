# Eva Scarf: online store for Sudanese tarhas

An Arabic-first (with English) online store for Eva Scarf. Customers register, save their
delivery address, add tarhas to their cart and order with cash on delivery. The owner manages
orders, products, prices, discounts, stock and delivery fees from a dashboard. Emails go out at
every step.

**Live setup:** the app runs on **Cloudflare Workers** at <https://shop.evascarf.workers.dev>, the data
lives in **Supabase** (a Postgres database you can browse in its Table Editor, plus Storage for product
photos), and emails are sent through **Brevo**. The code is kept on **GitHub**; a deploy is one command
from this computer (`npm run deploy`).

---

## Deploying (GitHub → Supabase → Brevo → Cloudflare)

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
   - Name: `eva-scarf` · Region: **Europe** if you can (closest to Egypt; the default is Americas) · a **database password**
     of letters and numbers only (symbols like `#` break the address) · untick **Automatically expose new tables**,
     tick **Enable automatic RLS**.
   - This store's project is in US West (Oregon), so `wrangler.jsonc` runs the site next to it
     (`"placement": { "region": "aws:us-west-2" }`, which Cloudflare serves from Seattle). If you ever move the
     database to Europe, change that region to match (for Frankfurt: `aws:eu-central-1`).
2. When the project is ready, collect three values:
   - **DATABASE_URL**: click **Connect** (top bar) → **Transaction pooler** → copy the URI
     (it looks like `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-1-us-west-2.pooler.supabase.com:6543/postgres`)
     and put your database password in place of `[YOUR-PASSWORD]`.
   - **SUPABASE_URL**: Project Settings → **API** → Project URL (`https://xxxx.supabase.co`).
   - **SUPABASE_SERVICE_ROLE_KEY**: Project Settings → **API Keys** → **Secret keys** (starts with `sb_secret_`;
     the older `service_role` key works too). Not the publishable key. Keep it private.
3. Put the three values in your local `.env`, then create the tables, the photo bucket and the owner account:
   ```bash
   npm run db:setup
   ```
4. Move the store's current data (products, photos, neighborhoods and fees, accounts, orders) from this computer into
   Supabase. Stop the local site first, then:
   ```bash
   npm run db:copy-local
   ```
   (Only needed once; done for this store on 2026-10-19. Add `-- --replace` to overwrite data already in Supabase.
   The old `npm run migrate:sqlite` only reads the pre-Postgres file `data/eva.db`.)
   From then on this computer also uses Supabase, so the local site shows the live data. The tests always use a
   throwaway database and never touch it.

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

### 4. Cloudflare: hosting the site
The store runs as a Cloudflare **Worker** named `shop` (settings in `wrangler.jsonc`). Cloudflare runs its own
runtime rather than Node, so `worker/` adapts the same Express app: templates are bundled and compiled when the
Worker starts, and each request gets its own database connection through **Hyperdrive**.

1. Sign up at <https://dash.cloudflare.com>. In **Workers & Pages**, the account's `workers.dev` subdomain is
   `evascarf`, so the Worker `shop` is at `https://shop.evascarf.workers.dev`.
2. Log in from this folder (opens the browser; click **Allow** within 2 minutes): `npx wrangler login`
3. The database connection (done once; it holds the Supabase password, so the Worker never sees `DATABASE_URL`).
   Use Supabase's **Direct connection** (Connect → Direct: host `db.<project>.supabase.co`, port 5432, user
   `postgres`), and keep caching **off** so sessions, stock and rate limits are always fresh:
   ```bash
   npx wrangler hyperdrive create evascarf-db --caching-disabled --sslmode=require \
     --origin-host=db.<project>.supabase.co --origin-port=5432 --database=postgres \
     --origin-user=postgres --origin-password=<database password>
   ```
   Put the id it prints in `wrangler.jsonc` under `"hyperdrive"`.
4. Secrets (stored encrypted at Cloudflare, never in the code):

   | Secret | Value |
   |---|---|
   | `SESSION_SECRET` | a long random string (40+ characters) |
   | `SUPABASE_SERVICE_ROLE_KEY` | from Supabase (step 2) |
   | `SMTP_USER` | Brevo SMTP login |
   | `SMTP_PASS` | Brevo SMTP key |
   | `MAIL_FROM` | your verified Brevo sender |

   Add or change one with `npx wrangler secret put NAME` (it asks for the value). Plain settings (`BASE_URL`,
   `SUPABASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `STORE_TIMEZONE`) are under `"vars"` in `wrangler.jsonc`.
   `SMTP_PORT` must stay `587`: Cloudflare can't open Brevo's port 465.
5. Deploy: `npm run deploy` (builds the styles and the template bundle, then uploads). Watch live requests and
   errors with `npx wrangler tail shop`.
6. Later changes: run the tests, `npm run deploy`, and push to GitHub to keep the code there too.

**Plan note:** the Workers **Free** plan allows commercial use but only 10 ms of processing per request; this
store measured 6–65 ms per page (the owner's password check takes the most). If pages fail with Cloudflare
**error 1102**, move to **Workers Paid** ($5/month) in the dashboard; no code change is needed. Supabase and
Brevo free plans are enough to start; Supabase pauses free projects only after a week with no activity at all.

**Own domain (later):** add the domain to Cloudflare (or buy it there), then **Workers & Pages → shop → Settings →
Domains & Routes → Add → Custom domain**; Cloudflare issues the certificate itself. Then set `BASE_URL` in
`wrangler.jsonc` and deploy.

**Running the Worker locally** (Cloudflare's runtime on this computer; uses the live database):
create `.dev.vars` with `SESSION_SECRET=…`, `SUPABASE_SERVICE_ROLE_KEY=…` and `BASE_URL=http://localhost:8787`,
set `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` to your `DATABASE_URL` with `?sslmode=require`
added, then `npm run cf:dev`. Everyday development doesn't need this: `npm start` runs the same app on Node.

---

## Run it locally

Requires **Node.js 22.13 or newer** (24 recommended). Without `DATABASE_URL`, the store uses a built-in
local database (an embedded Postgres in `data/pglite`): nothing else to install.

```bash
npm install
cp .env.example .env      # then edit .env: set ADMIN_EMAIL and ADMIN_PASSWORD
npm run seed              # creates the owner account (add -- --samples for 14 demo tarhas)
npm start                 # builds the styles, then http://localhost:3000
```

The owner signs in at `/admin/login` and lands on the dashboard at `/admin`.
The page styles are built from the templates by Tailwind (`npm run build:css` → `public/css/tailwind.css`).
`npm start` and `npm run e2e` build them first, and `npm run deploy` builds them every time; run it yourself
after changing classes in a template if the server is already running.
Scripts (`seed`, `import-collection`, `migrate:sqlite`) use the same database as the server; for the
local database, stop the server first (it can only be open in one program at a time).

## What customers can do

| Step | Details |
|---|---|
| Sign in with an email code | No account to create and no password. At checkout (or `/account/login`) the customer types an email and gets a 6-digit code by email: valid 10 minutes, works once, stops after 5 wrong tries, one a minute and five an hour per email; stored only as a hash. The code boxes show a Pac-Man eating the digits and a green tick when it's right. The first time an email signs in, a customer is created for it. The sign-in page has four animated characters that follow the pointer and look at the email field. |
| Checkout details | On the checkout page itself: name, neighborhood (with the map), street, building, apartment and both phones, filled in from last time; the delivery fee updates as the neighborhood is chosen. |
| Welcome email | Sent once, with the first order (the first time the details are saved). |
| Profile | City and neighborhood chosen from the delivery list, then street, building number and apartment number (all required); a primary and a second phone number (both required, and they must differ). Arabic-Indic digits are accepted. Optionally, the customer pins the house on a map (search, "use my location", or drag the map under the pin, then "Confirm location"). Confirming fills in the street, building number and neighborhood from the map where it knows them (the apartment number is always typed). The point is saved with the profile and copied onto each order. |
| Cart | Totals are calculated on the server: subtotal, discount, delivery fee (from the customer's neighborhood, chosen at checkout), total. Quantities can't exceed stock. |
| Checkout | Cash on delivery. Stock is taken in one transaction, so two customers can't buy the last piece. |
| Order confirmation email | Order number, every item **with its photo embedded in the email**, totals, address. |
| Status emails | An email for each change: Processing → Shipped → Delivered. The Delivered email asks the customer to rate the order (1–5 stars + comment). |
| My orders | Order history with a status timeline. |

## What the owner can do (`/admin`)

- **Overview:** orders per status, revenue from delivered orders, cash still to collect, average rating, low stock, latest orders.
- **Orders:** filter by status, search by order number, name, phone or neighborhood. Each order shows the customer name, email, both phones, the full address (city, neighborhood, street, building, apartment), the items with photos and prices, the status history and the rating. When the customer pinned a map location, an **Open in Google Maps** button takes the courier straight to it. One click changes the status and emails the customer.
- **Products:** add/edit with an optional Arabic + English name (a tarha can have no name), description, photos (resized in the browser before upload), price, discount % and stock. Prices, discounts, stock and visibility can also be edited straight from the product list. **Bulk discount:** apply or remove a % for selected products or for everything. **Delete:** products that were never ordered are deleted; products in past orders are archived (hidden) so order history stays intact, and can be restored.
- **Offers:** store-wide deals the owner adds like products and switches on or off: free delivery when the items cost at least a set amount, "buy X, get Y free" (the cheapest pieces are free), and a percentage off the order (on every order or above an amount). Switched-on offers apply to the cart automatically, show in a thin bar at the top of the store, and each order keeps a copy of the offers it used. Two start switched off: free delivery over 1,000 EGP, and buy 3 get the 4th free.
- **Delivery:** neighborhoods grouped by city, each with its own delivery fee. A neighborhood with no fee is hidden from customers; 0 means free delivery. Add or delete neighborhoods here.
- **Settings:** a contact email shown in the footer, the owner's password, and **two-step sign-in**: after the password, a 6-digit code is emailed to an inbox the owner confirms (it can differ from the sign-in email), so the password alone (or the link) opens nothing. Switching it on or changing the inbox needs the current password and a code sent to that inbox; switching off needs the password. The page also shows whether email sending is connected and the latest emails sent.

**Owner sign-in:** `/admin/login` (email + password, at most 10 tries an hour per email and 20 per 15 minutes per
visitor), then the emailed code when two-step sign-in is on. Lost access to that inbox? On a computer with the
live `DATABASE_URL` in `.env`, run `npm run owner:2fa-off`, sign in with the password and set up a new inbox.

## Emails

Until SMTP is configured, every email is **saved to `./outbox`** instead of being sent: a `.html` file
to open in a browser and a `.eml` file (the real message, with images embedded) for Outlook or
Windows Mail. On Cloudflare, configure Brevo (step 3 above), since there is no outbox folder to look in.

## Adding photos in bulk

Drop photos into `Collection/` and run `npm run import-collection`. Each photo becomes a hidden draft
product (a sub-folder becomes one product with several photos), uploaded to Supabase Storage when it's
configured. Then open **Products → Hidden** to price and publish them. Already-imported files are skipped.

## Tests

```bash
npm test         # unit tests: validation rules, pricing, orders (incl. two customers racing for the last piece),
                 # address lookup, sign-in codes, templates as the Cloudflare Worker bundles them
npm run e2e      # full browser run of every workflow (uses its own test owner account)
npm run test:security  # attack checks: CSRF, other people's orders, XSS, SQL injection, open redirects, guessing
                       # codes and the owner password, price tampering, file access, production cookies/HTTPS headers
```

Both use a throwaway in-memory database, so they never touch real orders or products. `npm run e2e`
checks the home collage and the sign-in characters, lets a guest buy with an email code (details and map pin on
the checkout page, against a stand-in address service), then signs in as the owner, ships and delivers the
order, rates it, prices a neighborhood, adds/edits/discounts/deletes a product, runs the offers, switches on
two-step sign-in and signs in with a code, and lets a returning customer reorder with a fresh code. Screenshots of
each step are saved in `temporary screenshots/`.

## Project layout

```
serve.mjs                 local entry point (port 3000)
worker/index.js           Cloudflare entry point (hands every request to the Express app)
worker/register.js        prepares the app for Cloudflare: bundled files, templates, database per request
wrangler.jsonc            Cloudflare settings: name, placement, Hyperdrive, plain settings
scripts/build-worker-files.mjs  bundles templates, translations and the email logo for the Worker
src/app.js                wiring only: middlewares in order, then routes, then the 404 and error pages
src/config/               index.js (settings from .env / Cloudflare), constants.js (the store's fixed rules)
src/routes/               which address goes to which controller (no logic)
src/controllers/          read the request, call a service, answer with a page, redirect or JSON
src/services/             the store's rules (cart, orders, pricing, offers, sign-in codes, emails…); no req/res
src/repositories/         every SQL query, one file per table; nothing else touches the database
src/validators/           checks for the owner's forms (products, offers, delivery, settings, ratings)
src/middlewares/          sessions, sign-in guards, CSRF, rate limits, uploads, security headers, errors
src/lib/                  db.js (Postgres driver), platform.js (Node vs Cloudflare), templates.js, i18n.js, storage.js
src/utils/                small helpers (form fields, safe redirects, constant-time compare, caches)
src/views/                EJS pages (layouts/, partials/, shop/, account/, admin/)
src/emails/               email templates (Arabic + English)
src/locales/              ar.json, en.json: all text on the site and in emails
src/schema.sql            the tables (Supabase in production, embedded Postgres locally)
public/js/validation.js   validation rules shared by the browser and the server
scripts/                  db:setup, migration, e2e and security tests, collection import, test email
```

A request flows one way: route → controller → service → repository → database. For example, an owner
saving a product: `routes/admin.js` sends `POST /admin/products/:id` through `uploadImages` and
`verifyCsrf` to `controllers/admin/products.js#update`, which checks the form with
`validators/product.js`, then calls `services/product-admin.js#updateProduct`, which stores the photos
and calls `repositories/products.js` and `repositories/product-images.js` inside one transaction.

Security: customers have no password (one-time email codes, stored hashed); the owner's password is hashed
with scrypt, with an optional emailed code as a second step; CSRF tokens on every form; rate-limited sign-in
and codes, counted in the database; private pages carry `X-Robots-Tag: noindex`; session cookies are httpOnly, SameSite and Secure in production; all SQL is parameterised;
uploads are checked by content, not just file name; the dashboard is restricted to the owner role on
the server; database tables are closed to Supabase's public API.

The page styles are built with the Tailwind CLI at deploy time (no CDN script).
