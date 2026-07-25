import sys
sys.path.append('/app')
from app.services.pdf_parser import PDFParser
import logging

logging.basicConfig(level=logging.DEBUG)

file_path = '/app/uploads/hdfc_19aa1c83aef680ba_4341XXXXXXXXXX41_19-11-2025_936_decrypted.pdf'
print(f'Parsing: {file_path}')
result = PDFParser.parse_statement(file_path, bank_code='hdfc')

print(f'\nSuccess: {result["success"]}')
print(f'Bank detected: {result.get("bank_code")}')
print(f'Transactions: {len(result["transactions"])}')

if result.get('error'):
    print(f'Error: {result["error"]}')

if len(result['transactions']) > 0:
    print('\nFirst 10 transactions:')
    for i, t in enumerate(result['transactions'][:10]):
        print(f'{i+1}. {t["transaction_date"].strftime("%d/%m/%Y")} - {t["description"][:50]} - ₹{t["amount"]:.2f} ({t["transaction_type"]})')

