#!/usr/bin/env python3
import sys
sys.path.append('/app')
from app.core.database import SessionLocal
from app.models.models import PDFDocument, Transaction

db = SessionLocal()

# Get counts
total_pdfs = db.query(PDFDocument).count()
processed_pdfs = db.query(PDFDocument).filter(PDFDocument.is_processed == True).count()
total_transactions = db.query(Transaction).count()

print(f"\n=== FINAL SUMMARY ===")
print(f"Total PDFs: {total_pdfs}")
print(f"Processed PDFs: {processed_pdfs}")
print(f"Total transactions: {total_transactions}")

# Check the 8 specific PDFs
print(f"\n=== Problem PDFs (Should now have transactions) ===")
for pdf_id in [1,2,3,4,5,50,51,52]:
    pdf = db.query(PDFDocument).filter(PDFDocument.id == pdf_id).first()
    trans_count = db.query(Transaction).filter(Transaction.pdf_id == pdf_id).count()
    print(f"PDF {pdf_id} ({pdf.filename[:40]}...): {trans_count} transactions")

# Get date range
from sqlalchemy import func
date_range = db.query(
    func.min(Transaction.transaction_date),
    func.max(Transaction.transaction_date)
).first()

print(f"\n=== Transaction Date Range ===")
print(f"Earliest: {date_range[0]}")
print(f"Latest: {date_range[1]}")

db.close()
