# Prestige Market

Telegram-first marketplace for NFT gift rentals, collectible usernames, compliant number listings, Telegram Stars and Premium requests.

## Architecture

- Cloudflare Worker: API + Telegram webhook (no always-on VPS).
- Cloudflare D1: users, listings, rental options, orders, payments, favorites, support and audit.
- Cloudflare R2: optional product media storage.
- React + TypeScript + Vite: Mini App frontend.
- GitHub: source control and deployment workflow.

This repository is designed for the Cloudflare free tiers, subject to current account quotas and limits. Free plans are not unlimited and availability/quotas can change.

## Important payment rules

- Telegram Stars digital goods must be sold using Telegram's official Stars invoice flow (`XTR`) where required by Telegram.
- An order is marked paid only after a verified `successful_payment` update from Telegram.
- This starter does not pretend to deliver Stars or Premium automatically. Such orders remain `pending_admin` unless a separately approved official fulfillment integration is configured.
- Never ask users for passwords, login codes, QR login, session files, seed phrases or account access.
- Number listings are informational/lease requests only. No SMS, calls, forwarding, verification codes or account access.

## Deploy

1. Create a GitHub repository and upload this folder.
2. Install Node.js 20+ and Wrangler locally, or use Cloudflare's Git integration.
3. Create a D1 database:
   `npx wrangler d1 create prestige-market-db`
4. Copy the returned `database_id` into `wrangler.toml`.
5. Apply schema:
   `npx wrangler d1 execute prestige-market-db --file=cloudflare/schema.sql`
6. If the D1 database already exists, apply the price update once:
   `npx wrangler d1 execute prestige-market-db --file=cloudflare/update_prices.sql`
6. Set Worker secrets:
   - `BOT_TOKEN`
   - `BOT_USERNAME`
   - `ADMIN_IDS` (comma-separated Telegram numeric IDs)
   - `WEBAPP_URL` (deployed frontend URL)
   - `TELEGRAM_WEBHOOK_SECRET` (random secret string)
   - `ADMIN_API_SECRET` (long random secret)
7. Deploy Worker:
   `npx wrangler deploy`
8. Set Telegram webhook:
   `https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://YOUR-WORKER.workers.dev/telegram/webhook&secret_token=YOUR_TELEGRAM_WEBHOOK_SECRET`
   Use the exact same secret in the Worker secret `TELEGRAM_WEBHOOK_SECRET`.
9. Deploy `frontend/` as a Cloudflare Pages project:
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: `frontend`
   - Set `VITE_API_BASE` to your Worker URL.
10. In @BotFather:
    - `/newbot`, choose name and username.
    - `/setmenubutton` → choose your bot → set button text (e.g. `Open Market`) and Mini App URL.
    - Configure the menu button URL to your Pages URL.
11. Set `WEBAPP_URL` to the same Pages URL and redeploy Worker.

## Local frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

## Admin access

Set `ADMIN_IDS` to numeric Telegram IDs. Admin API requests require Telegram Web App `initData` signed by Telegram and an admin ID in this allowlist. Do not put admin IDs or secrets in frontend code.

## D1 backup

Export a SQL backup periodically:
`npx wrangler d1 export prestige-market-db --output=backup.sql`

Store backups privately. Do not commit secrets or production user data to GitHub.

## Current implementation notes

- The Worker validates Telegram Web App `initData` on the backend.
- Prices are calculated server-side from D1.
- Order creation uses a D1 batch and unique idempotency key.
- Admin endpoints allow listing CRUD, order status updates, and basic statistics.
- Product media metadata is supported; configure R2 binding before enabling uploads.
- Telegram Stars invoice delivery is wired as a bot capability, but product/fulfillment policy must be configured before production sales.
- Refunds/disputes require manual handling unless an official provider supports the corresponding API.
