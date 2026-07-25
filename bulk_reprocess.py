import sys
sys.path.append('/app')
from app.database import SessionLocal
from app import models
from app.services.pdf_parser import PDFParser
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Get all PDFs with 0 transactions
db = SessionLocal()

# List of problem PDFs
problem_pdfs = db.query(models.PDFDocument).join(
    models.Transaction, models.PDFDocument.id == models.Transaction.pdf_id, isouter=True
).group_by(models.PDFDocument.id).having(
    db.query(models.Transaction.id).filter(
        models.Transaction.pdf_id == models.PDFDocument.id
    ).exists() == False
).all()

# Also check PDFs that are marked processed but have 0 transactions
all_pdfs = db.query(models.PDFDocument).filter(
    models.PDFDocument.is_processed == True
).all()

problem_ids = []
for pdf in all_pdfs:
    count = db.query(models.Transaction).filter(models.Transaction.pdf_id == pdf.id).count()
    if count == 0:
        problem_ids.append(pdf.id)

print(f"Found {len(problem_ids)} PDFs with 0 transactions: {problem_ids}")

# Reprocess each one
for pdf_id in problem_ids:
    pdf = db.query(models.PDFDocument).filter(models.PDFDocument.id == pdf_id).first()
    
    print(f"\n=== Processing PDF {pdf_id}: {pdf.filename} ===")
    print(f"Bank: {pdf.bank_name}")
    
    # Use decrypted file if available
    file_path = pdf.decrypted_file_path or pdf.file_path
    
    # Detect bank code from file/name
    bank_code = None
    if pdf.bank_name:
        bank_name_lower = pdf.bank_name.lower()
        if 'hdfc' in bank_name_lower:
            bank_code = 'hdfc'
        elif 'yes' in bank_name_lower:
            bank_code = 'yes'
    
    # Parse the PDF
    result = PDFParser.parse_statement(file_path, bank_code=bank_code)
    
    if result['success'] and len(result['transactions']) > 0:
        # Delete existing transactions for this PDF
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
        
        # Update PDF
        pdf.is_processed = True
        pdf.processing_status = 'completed'
        pdf.error_message = None
        
        db.commit()
        print(f"✓ Reprocessed: {len(result['transactions'])} transactions")
    else:
        error_msg = result.get('error', 'Unknown error')
        print(f"✗ Failed: {error_msg}")
        pdf.processing_status = 'failed'
        pdf.error_message = error_msg
        db.commit()

# Final summary
print("\n=== FINAL SUMMARY ===")
total_trans = db.query(models.Transaction).count()
total_pdfs = db.query(models.PDFDocument).count()
processed_pdfs = db.query(models.PDFDocument).filter(models.PDFDocument.is_processed == True).count()

print(f"Total PDFs: {total_pdfs}")
print(f"Processed PDFs: {processed_pdfs}")
print(f"Total transactions: {total_trans}")

db.close()
