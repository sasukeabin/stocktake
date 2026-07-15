# BSS Shopify Stocktake App

This is a Shopify app version of the stocktake scanner.

It is separate from the standalone CSV scanner. It reads product and inventory data from Shopify, saves counted stocktakes, exports CSV, and can apply counted stock back to Shopify inventory.

## What It Does

- Connects to a Shopify store through app OAuth.
- Looks up products by barcode or SKU.
- Shows Shopify's current inventory quantity for a selected location.
- Lets staff scan and enter counted quantity.
- Saves stocktake lines on the app server.
- Downloads a counted CSV.
- Emails CSV through the device share sheet where supported.
- Can update Shopify inventory after confirmation.

## Required Shopify Scopes

```text
read_products,read_inventory,write_inventory
```

Only include `write_inventory` if you want the **Update Shopify** button.

## Setup

1. Create or open your app in Shopify Partner Dashboard.
2. Copy the app client ID and client secret.
3. Copy `.env.example` to `.env`.
4. Fill in:

```text
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET= 
HOST=
```

5. Install dependencies:

```bash
npm install
```

6. Copy the scanner library from the main project:

```bash
mkdir -p public/vendor
cp ../vendor/zxing-browser.min.js public/vendor/zxing-browser.min.js
```

On Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force .\public\vendor
Copy-Item ..\vendor\zxing-browser.min.js .\public\vendor\
```

7. Run locally:

```bash
npm run dev
```

8. Use a tunnel URL, such as Shopify CLI tunnel, Cloudflare Tunnel, or ngrok, and set `HOST` to that HTTPS URL.
9. Add this redirect URL in Partner Dashboard:

```text
https://your-host/auth/callback
```

## Deploy

Deploy this as a Node app, not a static Netlify Drop site.

Good options:

- Render
- Railway
- Fly.io
- Heroku-style Node hosting
- VPS

Set environment variables on the host:

```text
SHOPIFY_API_KEY
SHOPIFY_API_SECRET
SCOPES=read_products,read_inventory,write_inventory
HOST=https://your-production-host
```

## Important

The Shopify Admin API token must stay on the server. Do not put it in browser JavaScript.

Before pressing **Update Shopify**, the app calculates variance:

```text
counted quantity - Shopify quantity
```

Then it uses Shopify's `inventoryAdjustQuantities` mutation to apply the difference.

## Next Production Improvements

- Replace JSON file storage with Postgres or SQLite persistence on your host.
- Add a stocktake history screen.
- Add user/staff name per scan.
- Add stronger duplicate scan controls.
- Add a review screen before Shopify updates.
