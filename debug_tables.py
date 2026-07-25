import sys
sys.path.append('/app')
import pdfplumber

file_path = '/app/uploads/hdfc_19aa1c83aef680ba_4341XXXXXXXXXX41_19-11-2025_936_decrypted.pdf'

with pdfplumber.open(file_path) as pdf:
    for page_num, page in enumerate(pdf.pages):
        tables = page.extract_tables()
        print(f'\n=== PAGE {page_num + 1} - {len(tables)} tables ===')
        
        for table_num, table in enumerate(tables):
            if not table or len(table) < 2:
                continue
            
            # Check for transaction table
            header_str = ' '.join([str(cell) for cell in table[0] if cell])
            if 'DATE' in header_str.upper() or 'TRANSACTION' in header_str.upper():
                print(f'\n*** TABLE {table_num + 1} (Transaction Table) ***')
                print(f'Headers: {table[0]}')
                print(f'Total rows: {len(table)}')
                print('\nFirst 5 data rows:')
                for i, row in enumerate(table[1:6], 1):
                    print(f'{i}. {row}')
