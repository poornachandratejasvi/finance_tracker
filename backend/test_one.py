#!/usr/bin/env python3
import sys
sys.path.append('/app')
import logging

# Disable debug logging from pdfminer
logging.getLogger('pdfminer').setLevel(logging.WARNING)
logging.basicConfig(level=logging.INFO)

# Test just one PDF first
from app.services.pdf_parser import PDFParser

pdf_id = 1
file_path = '/app/uploads/hdfc_1ff1df7cb4e3ae79_4341XXXXXXXXXX41_18-09-2025_1164_decrypted.pdf'

print(f"Testing PDF {pdf_id}: {file_path}")
print("Parsing...")

result = PDFParser.parse_statement(file_path, bank_code='hdfc')

print(f"\nSuccess: {result['success']}")
print(f"Transactions: {len(result['transactions'])}")

if result['transactions']:
    print("\nFirst 5:")
    for i, t in enumerate(result['transactions'][:5], 1):
        print(f"{i}. {t['transaction_date'].strftime('%d/%m/%Y')} - {t['description'][:40]} - {t['amount']}")
