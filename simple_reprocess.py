import sys
sys.path.append('/app')
from app.database import SessionLocal
from app import models
from app.services.pdf_parser import PDFParser

# List of problem PDF IDs
problem_ids = [1, 2, 3, 4, 5, 50, 51, 52]

db = SessionLocal()

for pdf_id in problem_ids:
    pdf = db.query(models.PDFDocument).filter(models.PDFDocument.id == pdf_id).first()
    
    if not pdf:
        print(f"PDF {pdf_id} not found")
        continue
    
    print(f"\n=== PDF {pdf_id}: {pdf.filename} ===")
    print(f"Bank: {pdf.bank_name}")
    
    # Use decrypted file if available
    file_path = pdf.decrypted_file_path or pdf.file_path
    print(f"File: {file_path}")
    
    # Detect bank code
    bank_code = None
    if pdf.bank_name and 'hdfc' in pdf.bank_name.lower():
        bank_code = 'hdfc'
    elif pdf.bank_name and 'yes' in pdf.bank_name.lower():
        bank_code = 'yes'
    
    print(f"Bank code: {bank_code}")
    
    # Parse
    result = PDFParser.parse_statement(file_path, bank_code=bank_code)
    
    if result['success'] and len(result['transactions']) > 0:
        # Delete old transactions
        old_count = db.query(models.Transaction).filter(models.Transaction.pdf_id == pdf_id).count()
        db.query(models.Transaction).filter(models.Transaction.pdf_id == pdf_id).delete()
        
        # Insert new transactions
        for trans_data in result['transactions']:
            transaction = models.Transaction(
                pdf_id=pdf_id,
                transaction_date=trans_data['transaction_date'],
                description=trans_data['description'],
                amount=trans_data['amount'],
                transaction_type=trans_data['transaction_type'],
                balance=trans_data.get('balance'),
                reference_number=trans_data.get('reference_number'),
                original_description=trans_data.get('original_description', trans_data['description'])
            )
            db.add(transaction)
        
        pdf.is_processed = True
        pdf.processing_status = 'completed'
        pdf.error_message = None
        
        db.commit()
        print(f"✓ SUCCESS: {old_count} → {len(result['transactions'])} transactions")
    else:
        error = result.get('error', 'No transactions found')
        print(f"✗ FAILED: {error}")

print("\n=== SUMMARY ===")
total_trans = db.query(models.Transaction).count()
print(f"Total transactions in database: {total_trans}")

db.close()
