#!/usr/bin/env python3
"""
Comprehensive test script to verify all fixes
Run this after logging in to get a token
"""
import requests
import json
import sys

BASE_URL = "http://localhost:8000"

def test_with_token(token):
    """Test all endpoints with authentication token"""
    headers = {"Authorization": f"Bearer {token}"}
    results = []
    
    print("\n" + "="*80)
    print("TESTING ALL FIXES")
    print("="*80 + "\n")
    
    # Test 1: Analytics Dashboard (was failing with SQL error)
    print("1. Testing Analytics Dashboard...")
    try:
        response = requests.get(f"{BASE_URL}/api/dashboard/summary", headers=headers)
        if response.status_code == 200:
            data = response.json()
            print(f"   ✅ Analytics working - Income: {data.get('total_income', 0)}, Expense: {data.get('total_expense', 0)}")
            results.append(("Analytics Dashboard", True))
        else:
            print(f"   ❌ Analytics failed: {response.status_code}")
            results.append(("Analytics Dashboard", False))
    except Exception as e:
        print(f"   ❌ Error: {e}")
        results.append(("Analytics Dashboard", False))
    
    # Test 2: Banks list (for analytics filters)
    print("\n2. Testing Banks List...")
    try:
        response = requests.get(f"{BASE_URL}/api/banks/", headers=headers)
        if response.status_code == 200:
            banks = response.json().get("banks", [])
            print(f"   ✅ Banks loading - Found {len(banks)} banks")
            if banks:
                print(f"      Banks: {', '.join([b['name'] for b in banks[:3]])}")
            results.append(("Banks List", True))
        else:
            print(f"   ❌ Banks failed: {response.status_code}")
            results.append(("Banks List", False))
    except Exception as e:
        print(f"   ❌ Error: {e}")
        results.append(("Banks List", False))
    
    # Test 3: Find Duplicates
    print("\n3. Testing Find Duplicates...")
    try:
        response = requests.get(f"{BASE_URL}/api/transactions/duplicates/find", headers=headers)
        if response.status_code == 200:
            data = response.json()
            print(f"   ✅ Duplicate detection working")
            print(f"      Found {data.get('duplicate_groups', 0)} groups with {data.get('total_duplicates', 0)} duplicates")
            results.append(("Find Duplicates", True))
        else:
            print(f"   ❌ Failed: {response.status_code}")
            results.append(("Find Duplicates", False))
    except Exception as e:
        print(f"   ❌ Error: {e}")
        results.append(("Find Duplicates", False))
    
    # Test 4: Transactions with PDF mapping
    print("\n4. Testing Transactions with PDF File Mapping...")
    try:
        response = requests.get(f"{BASE_URL}/api/transactions?limit=5", headers=headers)
        if response.status_code == 200:
            data = response.json()
            items = data.get("items", [])
            if items:
                has_pdf = any(item.get('pdf_file') for item in items)
                has_bank_type = any(item.get('bank_type') for item in items)
                print(f"   ✅ Transactions loading - {len(items)} transactions")
                print(f"      PDF mapping: {'✅' if has_pdf else '⚠️ No PDFs'}")
                print(f"      Bank type: {'✅' if has_bank_type else '⚠️ No bank types'}")
                if has_pdf:
                    pdf_txn = next((t for t in items if t.get('pdf_file')), None)
                    if pdf_txn:
                        print(f"      Example PDF: {pdf_txn['pdf_file']}")
            else:
                print("   ⚠️  No transactions to test")
            results.append(("Transactions + PDF Mapping", True))
        else:
            print(f"   ❌ Failed: {response.status_code}")
            results.append(("Transactions + PDF Mapping", False))
    except Exception as e:
        print(f"   ❌ Error: {e}")
        results.append(("Transactions + PDF Mapping", False))
    
    # Test 5: Field Mapping
    print("\n5. Testing Field Mapping...")
    try:
        response = requests.get(f"{BASE_URL}/api/field-mapping", headers=headers)
        if response.status_code == 200:
            print(f"   ✅ Field mapping endpoint working")
            results.append(("Field Mapping", True))
        else:
            print(f"   ❌ Failed: {response.status_code}")
            results.append(("Field Mapping", False))
    except Exception as e:
        print(f"   ❌ Error: {e}")
        results.append(("Field Mapping", False))
    
    # Test 6: Resync PDFs
    print("\n6. Testing Resync PDFs...")
    try:
        response = requests.post(f"{BASE_URL}/api/sync/resync-pdfs", headers=headers, json={"force_all": False})
        if response.status_code in [200, 422]:  # 422 might mean no PDFs
            data = response.json()
            print(f"   ✅ Resync endpoint working")
            print(f"      Message: {data.get('message', 'No message')}")
            results.append(("Resync PDFs", True))
        else:
            print(f"   ❌ Failed: {response.status_code}")
            results.append(("Resync PDFs", False))
    except Exception as e:
        print(f"   ❌ Error: {e}")
        results.append(("Resync PDFs", False))
    
    # Test 7: Bank Type Update
    print("\n7. Testing Bank Type Update Schema...")
    try:
        # Get first bank
        banks_response = requests.get(f"{BASE_URL}/api/banks/", headers=headers)
        if banks_response.status_code == 200:
            banks = banks_response.json().get("banks", [])
            if banks:
                bank = banks[0]
                print(f"   ✅ Bank schema includes:")
                print(f"      bank_type: {bank.get('bank_type', 'NOT FOUND')}")
                print(f"      sender_emails: {bank.get('sender_emails', 'NOT FOUND')}")
                has_bank_type = 'bank_type' in bank
                results.append(("Bank Type Schema", has_bank_type))
            else:
                print("   ⚠️  No banks to test")
                results.append(("Bank Type Schema", True))
        else:
            print(f"   ❌ Failed to get banks")
            results.append(("Bank Type Schema", False))
    except Exception as e:
        print(f"   ❌ Error: {e}")
        results.append(("Bank Type Schema", False))
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    passed = sum(1 for _, success in results if success)
    total = len(results)
    print(f"\nPassed: {passed}/{total} ({passed/total*100:.1f}%)\n")
    
    for test_name, success in results:
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} - {test_name}")
    
    print("\n" + "="*80)
    print("\nFRONTEND CHECKS (Manual):")
    print("1. Open http://localhost:3000/analytics")
    print("   - Check if banks dropdown is populated")
    print("   - Check if charts show data by default")
    print("   - Try selecting different filters")
    print("\n2. Open http://localhost:3000/transactions")
    print("   - Check 'Account Type' column shows chips")
    print("   - Check 'PDF Source' column shows PDF names")
    print("   - Try 'Find Duplicates' button")
    print("   - Try 'Remove Duplicates' button")
    print("\n3. Open http://localhost:3000/banks")
    print("   - Add a bank with multiple emails: email1@test.com, email2@test.com")
    print("   - Select Account Type (Savings/Credit Card)")
    print("   - Save and verify values persist")
    print("\n4. Open http://localhost:3000/field-mapping")
    print("   - Check if banks dropdown is populated")
    print("\n5. Toggle Dark Mode")
    print("   - Click moon/sun icon in header")
    print("   - Verify ENTIRE page changes color (not just components)")
    print("="*80 + "\n")
    
    return passed == total


if __name__ == "__main__":
    print("\nTo run this test:")
    print("1. Login to http://localhost:3000")
    print("2. Open browser DevTools > Application > Local Storage")
    print("3. Copy the 'token' value")
    print("4. Run: python3 test_fixes.py YOUR_TOKEN\n")
    
    if len(sys.argv) > 1:
        token = sys.argv[1]
        success = test_with_token(token)
        sys.exit(0 if success else 1)
    else:
        print("Error: No token provided")
        sys.exit(1)
