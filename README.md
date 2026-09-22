# Swivels Inventory

Fresh eBay-master inventory system for Swivels Card Shop.

## Current package

This package contains the working responsive application interface, the fresh
Supabase schema, Railway deployment configuration, and environment-variable
contract. The included interface uses representative preview records until the
marketplace credentials and sync workers are connected.

## Deploy

### 1. GitHub

Create an empty repository, extract this ZIP, and upload all extracted files.
Do not upload the ZIP as a single file.

### 2. Supabase

Create a new Supabase project. Open SQL Editor and run:

    supabase/schema.sql

This creates fresh tables for eBay listings, physical SKUs, orders, allocations,
sync events, Manapool mappings, and reconciliation issues. It does not migrate
or reuse the previous database.

### 3. Railway

Create a Railway project from the GitHub repository. Railway reads
`railway.json` and builds the included Node.js 22 Dockerfile automatically.

Add these variables in Railway:

    EBAY_CLIENT_ID
    EBAY_CLIENT_SECRET
    EBAY_REFRESH_TOKEN
    EBAY_MARKETPLACE_ID=EBAY_US
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
    MANAPOOL_API_URL
    MANAPOOL_API_KEY
    SYNC_CRON_SECRET

Use the values from your new Supabase project and marketplace developer
accounts. Never commit real credentials to GitHub.

## Inventory authority

- eBay quantity is always authoritative.
- Supabase stores one physical SKU/location per card.
- Reconciliation compares active physical SKUs with eBay quantity.
- A discrepancy creates a review issue; it never changes eBay to match Supabase.
- Manapool is Magic-only. A Manapool sale must update eBay first.

## Local development

Requires Node.js 22 and npm.

    npm install
    cp .env.example .env.local
    npm run dev

Open http://localhost:3000.

### Render

The repository includes `render.yaml`, a Node.js 22 Dockerfile, and the
`/api/health` health-check endpoint. In Render, create a Blueprint from this
repository or create a Docker Web Service manually. The server binds to
`0.0.0.0` and Render's `PORT` automatically.

## CSV SKU requirement

If eBay exposes only the final consolidated listing SKU, its active-listing API
cannot reconstruct the original SKU from every CSV row. The ingestion worker
must receive the original CSV/feed export to preserve every physical location.
