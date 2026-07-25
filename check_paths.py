import sys
sys.path.append('/app')
from app.core.database import SessionLocal
from app.models.models import PDFDocument

db = SessionLocal()
pdfs = db.query(PDFDocument).filter(PDFDocument.id.in_([1,2,3,4,5])).all()

for pdf in pdfs:
    print(f"ID {pdf.id}: {pdf.filename}")
    print(f"  Decrypted: {pdf.decrypted_file_path}")
    print(f"  Bank: {pdf.bank_name}")
    print()
    
db.close()
