# 1688 Scraper

A self-hosted product importer that scrapes listings from **1688** and **AliExpress**, uses Claude to clean up titles / descriptions / variant names, and pushes finished products straight into your Shopify store.

Built for dropshippers and store operators who want curated catalogs without the manual data-entry slog.

---

## What it does

1. **Paste a 1688 / AliExpress URL** on the Imports page (one or many).
2. The scraper fetches the listing through **Bright Data Web Unlocker** (handles the bot-protection layer).
3. **Claude (Anthropic)** rewrites the title, description, variant names, and tags into store-ready copy.
4. Images are downloaded, optimized with Sharp, and uploaded to **Supabase Storage**.
5. You **review** the product (edit anything you want, drop variants, reorder images) and **push to Shopify** with one click.
6. **Transformation Rules** let you encode repeated edits (e.g. "always strip the supplier's logo from titles") so the next 100 imports come out cleaner.

## Tech stack

- **Next.js 16** (App Router, Turbopack) + **React 19**
- **Prisma 6** on **PostgreSQL** (Supabase-hosted)
- **Anthropic Claude** for text rewriting & OCR
- **Bright Data Web Unlocker** for scraping
- **Supabase Storage** for product imagery
- **iron-session** for auth, **bcrypt** for password hashing
- **Tailwind 4** + **shadcn/ui** for the interface

## Quick start

### Prerequisites

- Node.js 20+
- A Supabase project (free tier works) — for both Postgres and Storage
- A Bright Data account with a Web Unlocker zone
- An Anthropic API key
- (Optional) A Shopify store with a Custom App access token if you want auto-upload

### Setup

```bash
git clone https://github.com/ahmadnuaymi1-alt/1688-scraper.git
cd 1688-scraper
npm install

cp .env.example .env.local
# Fill in the values — see "Environment" below

npx prisma migrate deploy
npm run dev
```

Visit http://localhost:3000, create the first account on the signup page, and you're in.

### Environment

Open `.env.example` for the full list. Minimum required vars:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` / `DIRECT_URL` | Supabase Postgres connection strings (pooler + direct) |
| `BRIGHT_DATA_TOKEN` | API token for the Web Unlocker zone |
| `BRIGHT_DATA_ZONE` | Name of your Web Unlocker zone (e.g. `web_unlocker1`) |
| `ANTHROPIC_API_KEY` | For Claude — title/description rewriting and OCR |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | For uploading images to Storage (server-side only) |
| `SESSION_SECRET` | Random 32+ byte secret — generate with `openssl rand -base64 48` |

Shopify credentials are **per-store** and stored encrypted in the DB once you connect a store from the Settings page — you don't need them in `.env.local`.

## Project layout

```
src/app/
  (auth)/login           # sign-in page
  (auth)/signup          # initial account creation
  (app)/imports          # paste URLs → kick off scrape jobs
  (app)/review/[id]      # edit a scraped product before publishing
  (app)/rules            # transformation rules editor
  (app)/settings         # Shopify connections, scrape presets, account
  api/...                # REST endpoints backing each page
prisma/
  schema.prisma          # User, ScrapeJob, Product, Variant, Image, Rule, …
  migrations/            # version history
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next dev server on :3000 (Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run db:migrate` | Create + apply a new Prisma migration (dev) |
| `npm run db:push` | Push schema without a migration (dev only) |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:seed` | Seed defaults (rule templates, etc.) |

## Notes

- **Windows + OneDrive**: Turbopack's file watcher can panic when the project lives inside a OneDrive-synced folder. If `next dev` enters a refresh loop with `Next.js package not found` errors, either move the repo outside OneDrive or switch to webpack mode (`next dev --webpack`).
- This project tracks a Next.js 16 build whose APIs differ from the publicly documented ones — see `AGENTS.md`.

## License

No license file is included — all rights reserved by default. If you want to allow reuse, add a `LICENSE` file (MIT is a common choice).
