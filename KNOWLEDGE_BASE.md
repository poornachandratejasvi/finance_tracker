# Knowledge Base

## Overview
This project ingests bank statement PDFs, extracts transactions, and normalizes them into a standard schema. It supports Gmail-based statement sync, manual PDF uploads, per-bank field mapping, PDF preview with detected columns, and reprocess workflows.

## Core Components
- Backend (FastAPI + SQLAlchemy): APIs, parsing services, sync/reprocess logic.
- Frontend (React + MUI): field mapping UI, PDF preview, mapping management.
- PDF parsing: pdfplumber + PyPDF2/pikepdf; pandas for table handling.

## PDF Parsing Pipeline
1. Ingest PDF (Gmail sync, manual upload, or reprocess).
2. If password-protected, try known passwords; store decrypted PDF when successful.
3. Detect table columns from PDF pages (best-effort; fallback to mapping if none).
4. Parse transactions with mapping-aware logic:
   - Resolve columns using per-bank mapping when provided.
   - If debit/credit columns are configured, use them to build signed amounts.
   - If a single amount column is used, respect +/- signs or inferred type.
5. Normalize into standard fields (date, description, amount, balance, type, reference).

## Field Mapping
- Stored per bank in Bank.field_mapping.
- Supported fields:
  - date_field, description_field, amount_field, balance_field
  - debit_field, credit_field
  - type_field, reference_field
  - date_format, amount_format
- Field mapping is used during parsing to resolve column names and override detected columns when needed.

## Debit/Credit Handling
- Separate debit and credit columns:
  - Debit values become negative amounts.
  - Credit values become positive amounts.
- Single amount column:
  - Parse signed values when the column includes +/- or parentheses.
  - If an explicit type field exists, use it to infer sign.

## Decrypted PDF Storage
- When a password is known and decryption succeeds, the decrypted PDF is persisted.
- Decrypted storage is applied in:
  - Gmail sync/resync
  - Manual upload parsing
  - Reprocess and bulk reprocess flows

## Detected Columns Fallback
- If detected columns cannot be extracted for a PDF, the system falls back to the bank field mapping values when available.
- This keeps the Field Mapping UI usable even if detection fails.

## API Endpoints (Key)
- Field mapping:
  - GET /api/field-mapping/{bank_id}
  - POST /api/field-mapping/{bank_id}
- PDFs:
  - GET /api/pdfs/{id}/fields (returns detected_columns)
  - POST /api/pdfs/{id}/reprocess
  - POST /api/pdfs/reprocess
- Sync:
  - Gmail sync/resync endpoints in /api/sync

## UI: Field Mapping
- Field mapping UI includes:
  - PDF preview
  - Detected columns list
  - Core field mapping selects (date, description, amount, balance)
  - Format settings (date/amount format, type, reference)
  - Debit and credit column selectors (auto-detect fallback)

## Reprocess Workflows
- Single-PDF reprocess and bulk reprocess use the latest bank field mapping.
- Reprocess should be run after updating mappings to apply fixes.

## Recent Updates
- Dashboard totals now pull from /api/dashboard/summary for accurate income/expense totals.
- Modern analytics balance cards use higher-contrast text in dark mode.
- Transactions page fixed missing MUI import to restore label management dialog.

## Operational Notes
- For protected PDFs, ensure password candidates are set so decryption succeeds.
- After mapping changes, reprocess PDFs to update extracted data.
- Use the Field Mapping UI to verify detected columns and mapping correctness.

## Useful Scripts
- Reprocess helpers:
  - reprocess_all.sh
  - simple_reprocess.py
- PDF parsing tests:
  - test_pdf_parsing.py
  - test_all_pdfs.sh
