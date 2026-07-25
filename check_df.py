import sys
sys.path.append('/app')
from app.services.pdf_parser import PDFParser

file_path = '/app/uploads/hdfc_19aa1c83aef680ba_4341XXXXXXXXXX41_19-11-2025_936_decrypted.pdf'
tables = PDFParser.extract_tables(file_path)

print(f'Total tables: {len(tables)}')

for i, df in enumerate(tables):
    if df.empty:
        continue
    
    # Check headers
    header_text = ' '.join([str(col).upper() for col in df.columns if str(col) != 'nan' and col])
    
    if 'DATE' in header_text and ('TRANSACTION' in header_text or 'DESCRIPTION' in header_text):
        print(f'\n=== TABLE {i+1} - Transaction table ({len(df)} rows) ===')
        print(f'Columns: {list(df.columns)}')
        print(f'Header text: {header_text}')
        print(f'\nFirst 3 rows:')
        for idx, row in df.head(3).iterrows():
            print(f'{idx}: {row.values}')
