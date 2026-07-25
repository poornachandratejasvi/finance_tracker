#!/bin/bash

# Get auth token
TOKEN=$(curl -s -X POST "http://localhost:8000/api/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=admin123" | python3 -c "import sys, json; print(json.load(sys.stdin)['access_token'])")

# Test a random sample of PDFs
echo "=== Testing random PDFs ==="

# Get list of all PDFs
curl -s "http://localhost:8000/api/pdfs" -H "Authorization: Bearer $TOKEN" > /tmp/all_pdfs.json

# Show summary
python3 << 'EOF'
import json

with open('/tmp/all_pdfs.json') as f:
    data = json.load(f)
    pdfs = data.get('items', [])
    
    print(f"Total PDFs: {len(pdfs)}")
    
    # Count by bank
    banks = {}
    trans_by_pdf = {}
    
    for pdf in pdfs:
        bank = pdf.get('bank_name', 'Unknown')
        banks[bank] = banks.get(bank, 0) + 1
        trans_by_pdf[pdf['id']] = {
            'filename': pdf['filename'],
            'bank': bank,
            'count': 0  # Will be updated
        }
    
    print(f"\nPDFs by bank:")
    for bank, count in sorted(banks.items()):
        print(f"  {bank}: {count}")
    
    # Check PDFs with 0 transactions
    zero_trans = [pdf for pdf in pdfs if pdf.get('transaction_count', 0) == 0]
    if zero_trans:
        print(f"\n⚠️  PDFs with 0 transactions: {len(zero_trans)}")
        for pdf in zero_trans[:5]:
            print(f"   ID {pdf['id']}: {pdf['filename']}")
    else:
        print(f"\n✓ All PDFs have transactions!")
    
    # Total transactions
    total_trans = sum(pdf.get('transaction_count', 0) for pdf in pdfs)
    print(f"\n✓ Total transactions: {total_trans}")
    
    # Date range
    dates = [(pdf.get('earliest_transaction'), pdf.get('latest_transaction')) for pdf in pdfs 
             if pdf.get('earliest_transaction') and pdf.get('latest_transaction')]
    if dates:
        all_earliest = min(d[0] for d in dates)
        all_latest = max(d[1] for d in dates)
        print(f"✓ Date range: {all_earliest} to {all_latest}")
EOF
