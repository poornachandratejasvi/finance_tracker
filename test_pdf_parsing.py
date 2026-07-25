#!/usr/bin/env python3
"""
Test script for PDF parsing functionality
Tests the attached sample PDFs (scbank.pdf and yes.pdf)
"""

import sys
import os

# Add backend to path
backend_path = os.path.abspath("backend")
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from app.services.pdf_parser import PDFParser, OCR_AVAILABLE
import json


def test_ocr(pdf_path):
    """Test OCR capability on a sample PDF"""
    print("\nOCR Test")
    print("-" * 20)

    if not OCR_AVAILABLE:
        print("⚠ OCR libraries not available. Skipping OCR test.")
        return

    ocr_text = PDFParser.extract_text_ocr(pdf_path)
    if ocr_text and len(ocr_text.strip()) > 0:
        print(f"✓ OCR extracted {len(ocr_text)} characters")
    else:
        print("⚠ OCR returned no text - verify tesseract and poppler installation")

def test_pdf(pdf_path, pdf_name):
    """Test PDF parsing"""
    print(f"\n{'='*60}")
    print(f"Testing: {pdf_name}")
    print(f"{'='*60}\n")
    
    # Check if password protected
    is_protected = PDFParser.is_password_protected(pdf_path)
    print(f"Password Protected: {is_protected}")
    
    if is_protected:
        print("⚠ PDF is password protected. Skipping parsing.")
        print("In production, the system will prompt user for password.")
        return
    
    # Extract text
    print("\nExtracting text...")
    text = PDFParser.extract_text(pdf_path)
    if text:
        print(f"✓ Extracted {len(text)} characters")
        print(f"First 200 characters: {text[:200]}...")
    else:
        print("✗ Failed to extract text")
        return
    
    # Detect bank
    print("\nDetecting bank...")
    bank_code = PDFParser.detect_bank(text)
    if bank_code:
        print(f"✓ Detected bank: {bank_code}")
    else:
        print("⚠ Could not detect bank")
    
    # Extract statement period
    print("\nExtracting statement period...")
    start_date, end_date = PDFParser.extract_statement_period(text)
    if start_date and end_date:
        print(f"✓ Period: {start_date} to {end_date}")
    else:
        print("⚠ Could not extract statement period")
    
    # Parse full statement
    print("\nParsing complete statement...")
    result = PDFParser.parse_statement(pdf_path)
    
    if result['success']:
        print(f"✓ Successfully parsed statement")
        print(f"  Bank: {result['bank_code']}")
        print(f"  Period: {result['statement_period']['start']} to {result['statement_period']['end']}")
        print(f"  Transactions found: {len(result['transactions'])}")
        
        if result['transactions']:
            print(f"\nSample transactions (first 3):")
            for i, trans in enumerate(result['transactions'][:3], 1):
                print(f"\n  Transaction {i}:")
                print(f"    Date: {trans['transaction_date']}")
                print(f"    Description: {trans['description'][:50]}...")
                print(f"    Amount: {trans['amount']}")
                print(f"    Type: {trans['transaction_type']}")
                if trans.get('balance'):
                    print(f"    Balance: {trans['balance']}")
        
        # Save results to JSON
        output_file = f"test_results_{os.path.basename(pdf_path)}.json"
        with open(output_file, 'w') as f:
            # Convert datetime objects to strings for JSON serialization
            result_copy = result.copy()
            if result_copy['statement_period']['start']:
                result_copy['statement_period']['start'] = str(result_copy['statement_period']['start'])
            if result_copy['statement_period']['end']:
                result_copy['statement_period']['end'] = str(result_copy['statement_period']['end'])
            
            for trans in result_copy['transactions']:
                if trans.get('transaction_date'):
                    trans['transaction_date'] = str(trans['transaction_date'])
            
            json.dump(result_copy, f, indent=2)
        
        print(f"\n✓ Results saved to: {output_file}")
    else:
        print(f"✗ Failed to parse statement")
        if result.get('error'):
            print(f"  Error: {result['error']}")

def main():
    """Main test function"""
    print("\n" + "="*60)
    print("PDF Parser Test Script")
    print("="*60)
    
    # Test sample PDFs
    pdf_files = [
        ("scbank.pdf", "Standard Chartered Bank Statement"),
        ("sc.pdf", "Standard Chartered Bank Statement (New)"),
        ("yes.pdf", "YES Bank Statement"),
        ("rbl.pdf", "RBL Bank Credit Card Statement"),
        ("hsbc.pdf", "HSBC Credit Card Statement"),
        ("sbi.pdf", "SBI Credit Card Statement"),
    ]
    
    for pdf_file, pdf_name in pdf_files:
        if os.path.isfile(pdf_file):
            test_pdf(pdf_file, pdf_name)
            # Always run OCR test on available PDF
            test_ocr(pdf_file)
        else:
            print(f"\n⚠ PDF file not found: {pdf_file}")
    
    print("\n" + "="*60)
    print("Testing Complete")
    print("="*60 + "\n")
    
    print("Note: These tests demonstrate the PDF parsing capabilities.")
    print("In production, the system will:")
    print("  1. Automatically download PDFs from Gmail")
    print("  2. Detect password protection")
    print("  3. Prompt for password if needed")
    print("  4. Extract and categorize transactions")
    print("  5. Store in database")
    print("  6. Detect duplicates")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n✗ Error during testing: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
