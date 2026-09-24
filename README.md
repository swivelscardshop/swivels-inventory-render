# Swivels Inventory

## Current package — v1.8.0

This is the real-data Render application with built-in eBay OAuth. The app gets
and stores the long-lived eBay refresh token after you click **Connect eBay**.
You no longer need to copy a short-lived access token into Render.

The normal import is one-way and read-only. Duplicate Center and CSV Intake can
change live eBay quantities or end confirmed duplicates only after a review and
browser confirmation.

### Duplicate and CSV workflow

- Duplicate Center scans live active eBay listings directly, uses a normalized Card Uploader title, and reads NM, LP, MP,
  HP, or DMG from either eBay's condition field or the listing title. This works
  even when eBay omits Item Specifics and condition from its bulk response.
- NM, LP, MP, HP, and DMG copies of the same card are separate valid listings.
- CSV Intake accepts the Card Uploader eBay CSV layout and generates a CSV with
  the same ordered columns containing only genuinely new unique listings.
- Incoming copies that already have one matching eBay listing increase that
  listing's quantity and save each physical SKU in Supabase.
- New repeated copies become one eBay listing row with combined quantity while
  every physical SKU is retained for order pulling.
- When an order is imported, the surviving listing's primary SKU is allocated
  first; later sales use the next available physical SKU.
- An allocated SKU stays in Supabase until **Confirm shipped** is clicked on
  the Orders page. That confirmation permanently removes only that order's SKU.
- Confirmations use the application's modern review dialog instead of the
  browser popup. Status messages appear as dismissible notifications.
- The interface uses the Swivels Card Shop dragon logo and its official blue,
  cyan, violet, orange, cream, and yellow brand palette.

### Low-egress design

- The dashboard requests only totals and five recent orders.
- Inventory is loaded only when the Inventory page is opened.
- Inventory search and pagination run on the server, with 50 listings returned
  per request instead of downloading the complete catalog.
- Orders are loaded only when the Orders page is opened and are limited to the
  50 currently actionable order lines.
- Changing dashboard views does not repeatedly download the full catalog.

## Upgrade an existing deployment

1. Replace the files in your GitHub repository with this package and commit.
2. In Supabase, open SQL Editor and run `supabase/v1.5.0-migration.sql` once.
   This adds duplicate-matching, pending-SKU, and order-location fields without
   deleting existing inventory.
3. Wait for Render to redeploy.

Do not rerun `supabase/schema.sql` on an existing database because that file is
for a fresh installation and resets the inventory tables.

## Configure eBay OAuth

1. Open the eBay Developer Program and select your **Production** application.
2. Open **User Tokens** and create or edit your eBay Redirect URL (RuName).
3. Set the authorization accepted URL to:

       https://YOUR-RENDER-DOMAIN.onrender.com/api/ebay/callback

4. Save it, then copy the generated **RuName** value.
5. In Render → your service → Environment, set:

       EBAY_CLIENT_ID=your production App ID
       EBAY_CLIENT_SECRET=your production Cert ID
       EBAY_RU_NAME=your RuName
       EBAY_MARKETPLACE_ID=EBAY_US

6. Keep your existing Supabase variables:

       SUPABASE_URL
       SUPABASE_SERVICE_ROLE_KEY

7. Save the variables and wait for Render to redeploy.
8. Open the application and click **Connect eBay**.
9. Sign in to the eBay seller account and approve access. eBay sends the app a
   refresh token, which the server stores in the protected Supabase
   `app_secrets` table.
10. Click **Import from eBay**.

`EBAY_REFRESH_TOKEN` is optional and supported only as a backwards-compatible
fallback. Do not add it when using the Connect eBay flow.

## Fresh installation

1. Create an empty GitHub repository and upload all extracted files.
2. Create a new Supabase project.
3. In Supabase SQL Editor, run `supabase/schema.sql` once.
4. Create a Render Docker Web Service from the GitHub repository.
5. Complete the eBay OAuth steps above.

## Security

- OAuth state is checked before accepting the callback.
- The refresh token is available only to the Render server through the
  Supabase service-role key; no public row-level-security policy is created.
- Secret values are never returned to the browser.
- Never commit real credentials to GitHub.

## Local development

Requires Node.js 22 and npm.

    npm install
    cp .env.example .env.local
    npm run dev

For local OAuth, create a separate RuName whose accepted URL is
`http://localhost:3000/api/ebay/callback`.
# Mana Pool setup

1. In Supabase SQL Editor, run `supabase/v1.9.0-manapool.sql` once.
2. In Mana Pool, open **API Integration Settings** and create an access token.
3. In Render, add `MANAPOOL_API_TOKEN` and the Mana Pool account email as `MANAPOOL_API_EMAIL`. Keep `MANAPOOL_SYNC_ENABLED=false` initially.
4. Redeploy, open the **Mana Pool** tab, and click **Map next 40 cards** until the queue is complete.
5. Review any ambiguous printings shown by the app. Mapping uses Scryfall IDs accepted directly by Mana Pool; a TCGPlayer account or SKU is not required.
6. Use **Preview changes**. After the preview is correct, set `MANAPOOL_SYNC_ENABLED=true` in Render and redeploy.

Pricing uses the exact Scryfall ID, language, condition, and finish. A lowest market price of 40 cents or less is listed at 40 cents; any higher market price is multiplied by 1.30 and rounded up to the next cent. Mana Pool orders can be imported from the Mana Pool tab and appear on the Orders page with their allocated Supabase location. Confirming shipment sends fulfillment to Mana Pool, then removes the allocated physical SKU from Supabase.

Live sync is intentionally disabled by default. Automatic matches must be unique; uncertain printings remain in the review list and are never sent until confirmed.
