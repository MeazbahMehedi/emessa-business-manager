# Setup

## Local preview

Install Node.js 22.12 or later. Run `npm ci`, copy `.dev.vars.example` to `.dev.vars`, then run `npm run dev`. Open `http://localhost:5173/login` and choose the sample workspace. The preview uses synthetic records.

## Connect an owner account

1. Deploy `apps-script/ReadApi.gs` with its accompanying manifest in an owner-controlled Apps Script project. Add the script properties from `config/script-properties.example.json` with your own private values and deploy it as an API executable with **Only myself** access.
2. Copy `config/reader-project.example.json` to `config/reader-project.json` and enter your Cloud project ID, owner email, timezone, and read API deployment ID. Use a Google OAuth web client in the same Cloud project with redirect URLs `http://127.0.0.1:8788/oauth/callback` and `http://localhost:5173/auth/callback`.
3. Run `npm run setup:google -- --client-json /path/to/client.json` and complete consent in your browser. The owner settings stay in ignored local files. Run `npm run dev` and sign in to verify the connection.

## Enable inventory staging

1. Deploy the generated `apps-script/inventory/Code.gs` and its accompanying manifest in a separate owner-controlled Apps Script project. Use an API executable with **Only myself** access.
2. Set its script properties `ADMIN_EMAIL`, `INVENTORY_MODE=staging`, `SALES_SPREADSHEET_ID`, and `INVESTMENT_SPREADSHEET_ID`. Set both `INVENTORY_SPREADSHEET_ID` and `INVENTORY_ALLOWED_STAGING_ID` to the same private staging copy. Use the two original workbook IDs for the sales and investment properties so the service can reject either as a staging target.
3. Run `emessaInventoryPrintPlan` in the editor. Review the migration and put its digest in `INVENTORY_APPROVED_PLAN`. With writes disabled, run `emessaInventoryInitialize` on the staging copy. Reconcile product counts and stock before setting `INVENTORY_WRITE_ENABLED=true`.
4. Add `GOOGLE_INVENTORY_DEPLOYMENT_ID` to the private `.dev.vars`, run `npm run setup:inventory`, and complete owner consent. Verify the connection with `npm run check:inventory`.
5. For private photo uploads, enable the Drive API and run `emessaInventoryCreateImageFolder` as the owner.

Set production account values using private Cloudflare Worker bindings. In particular, configure `ADMIN_EMAIL`, `ADMIN_GOOGLE_SUB`, `APP_ORIGIN`, and `SESSION_SECRET` before enabling owner sign-in. Keep workbook exports, product photos, OAuth credentials, and invoices outside the repository.
