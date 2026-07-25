# Handoff Implementation Status

Date: 2026-02-27

This file summarizes completed work, current issues, and pending tasks based on the latest conversation context. It is intended for handoff to another model.

## Current implementations (completed)

### Frontend
- Banks UI: Edit/Delete buttons are visible; secondary actions are in the overflow menu.
- Gmail reauth: Reauth button always visible; Gmail connected date is displayed; UI refreshes after OAuth redirect.
- Dashboard: Latest-month selection is used; month label is shown; summary data is pulled from the latest-month range.
- ModernDashboard (analytics): Totals align with year/month; balances text contrast improved; placeholder for balances added.
- Transactions: Multi-label dialog supports keyword selection and a select-all option.
- PDF Management: Bulk reprocess, decrypt, reassign banks, delete and re-import; bulk remap to a target bank with checkboxes.

### Backend
- Gmail OAuth: Token persistence to mounted file; created_at and last_synced updated on reauth.
- Sync: Exact sender email parsing; logs include query and bank evaluation; parsing supports field mapping.
- PDF operations: decrypt-all, reset, reassign-banks, remap-bank endpoints.
- Dashboard: latest-month endpoint added.
- PDF parsing: fixed _parse_amount; mapping-aware generic parser; debit/credit/amount handling; BOB detection added.
- Password service: parse_with_passwords supports field_mapping.
- CSV export: uses field_mapping.

### Tests and tooling
- Playwright E2E scaffold and tests added (not recently executed).
- Multiple test scripts exist for backend, PDFs, and UI validation.

## Open issues (known problems or risks)

- Bank of Baroda PDFs were previously mis-mapped to SBI due to sender overlap; exact sender match was added, but needs validation.
- Gmail reauth connected date display needs user validation after reauth flow.
- The latest-month dashboard endpoint and label need validation in the running UI.
- Bulk remap of a specific PDF (example: 7388202512174603868818.pdf) needs verification.
- Delete and re-import PDF flow has not been executed recently and needs user confirmation.

## Pending tasks (recommended next actions)

1) Validate Gmail reauth date display after reauth.
2) Validate exact sender matching by syncing and confirming BOB PDFs map correctly.
3) Use PDF Management bulk remap to correct any mis-mapped PDFs; verify results.
4) Validate Dashboard latest-month label and totals in the UI.
5) Run delete and re-import PDFs if needed.
6) Run Playwright E2E tests and confirm UI coverage passes.

## Recent file touchpoints (key areas)

Frontend:
- frontend/src/pages/Banks.js
- frontend/src/pages/Dashboard.js
- frontend/src/pages/ModernDashboard.jsx
- frontend/src/pages/PDFManagement.js
- frontend/src/pages/Transactions.js
- frontend/src/services/api.js

Backend:
- backend/app/api/endpoints/pdfs.py
- backend/app/api/endpoints/sync.py
- backend/app/api/endpoints/dashboard.py
- backend/app/api/endpoints/oauth.py
- backend/app/api/endpoints/banks.py
- backend/app/services/pdf_parser.py
- backend/app/services/password_service.py
- backend/app/services/csv_service.py

## Notes for next model

- Exact sender email matching now uses strict parsing; if a bank config uses regex-like patterns, verify they are still supported.
- The remap endpoint can be used to reassign PDFs to the correct bank without re-importing.
- Delete and re-import will remove existing PDF rows, then re-fetch from Gmail.
- Token persistence is now stored at /app/credentials/token.json.
