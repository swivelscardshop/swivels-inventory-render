# Swivels Inventory

## Current package — v1.3.0

This is the real-data Render application with built-in eBay OAuth. The app gets
and stores the long-lived eBay refresh token after you click **Connect eBay**.
You no longer need to copy a short-lived access token into Render.

The import is one-way and read-only: it reads active listings and open orders
from eBay and stores them in Supabase. It never revises or ends an eBay listing.

## Upgrade an existing v1.2.0 deployment

1. Replace the files in your GitHub repository with this package and commit.
2. In Supabase, open SQL Editor and run `supabase/oauth-migration.sql` once.
   This adds only the secure token table and does not delete existing data.
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
