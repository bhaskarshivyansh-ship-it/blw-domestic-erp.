# BLW Domestic ERP

A working, private local application for domestic two- and three-wheeler operations. Requires Node.js 24 or newer. No dependency installation is needed.

## Start

Run `npm start`, then open `http://127.0.0.1:4173`. On first use, create an owner password of at least 12 characters. Records are stored in `data/blw.sqlite`, not browser storage. Keep the server running while using the dashboard.

## Included

- Orders with separate PO, receipt, original promise and revised dispatch dates.
- Per-part partial shipments with over-dispatch protection.
- Manufacturing and purchasing work records; customers and commercial terms.
- Product price sources; suppliers, marka and source star ratings.
- Complaint investigation and closure validation.
- Invoice / receipt register and recorded receivables.
- Business email review queue with source excerpts and original-message links.
- Order, dispatch, completion, complaint and invoice trend graphs.
- CSV import/export, private JSON backup, change history and concurrent-edit protection.
- Private daily feed importer: `node sync.mjs /path/to/feed.json`.

## Data and accuracy

This public repository contains **code only**. Customer records, emails, price snapshots, credentials and SQLite databases must never be committed. Local private snapshots are imported separately. Spreadsheet source files are never modified.

Source order values are not invoiced sales. Missing promises, prices, payments and operational statuses remain unverified. No default discount, tax, credit hold or interest is automatically applied. Inventory is deferred. Tally is not connected. The owner login is a single-owner first release; individual staff roles and secure phone hosting remain deployment work.

The agreed name exclusion is case-insensitive `shivyansh|kundan|test` in business and contact fields. It does **not** exclude legitimate emails from staff. Possible repeated submissions are flagged, not deleted. Email summaries do not become multiple complaint records automatically.

## Daily refresh

The associated Codex task can run a daily automation using its connected accounts. The application itself contains no Google or email credentials. The automation reads source sheets and relevant domestic emails, then supplies a private JSON file to `sync.mjs`:

```json
{"sheetRows":{"orders":[["Received","Order no","Shop","Name","Items"]]},"emails":[],"emailCheckedAt":"2026-09-23T03:30:00Z"}
```

Use complete original sheet headers and rows, not this illustrative empty example. Each email must have `scope: "domestic-business"`, `id`, `thread`, `mailbox`, `body`, `subject`, `date`, `from`, `category`, `summary`, and `caution`. Sync adds stable IDs once, preserves operational edits, and holds source changes for review. It never sends emails. The Codex host and authorized connectors must be available for scheduled runs. The app displays source freshness; scheduling is not a guarantee that an unavailable host can refresh.

## Security and deployment

Default binding is loopback only. Owner passwords use scrypt; sessions use HttpOnly, SameSite cookies. API calls require authentication and reject cross-origin requests and unexpected hosts. SQL is parameterized. All rendering escapes record text. Edits are version checked and audited. Database files are not served as web assets.

For phone / remote access, place the app behind a trusted HTTPS reverse proxy, set `BLW_HOST` and `BLW_PUBLIC_ORIGIN`, and provision the owner password locally first. Do not expose the development server directly. This repository is not a deployed website. GitHub Pages cannot run its database/server.

Environment settings: `PORT` (default 4173), `BLW_DATA_DIR`, `BLW_SEED_FILE` (private one-time JSON seed), `BLW_HOST` (default 127.0.0.1), `BLW_PUBLIC_ORIGIN` (HTTPS origin for remote hosting). Back up the database with a SQLite-aware backup or while the server is stopped; retain the private JSON export for records and audit history.

## Validation

`node test.mjs` runs domain tests without spawning subprocesses. `npm test` runs the Node test runner where subprocesses are permitted. Test cases cover exclusions, source dates and missing values, import headers, partial shipments, reductions below shipped quantities, overdue classification, invalid dates and overpayments. API validation also covers authentication, concurrent edits, origin checks and database-file isolation.
