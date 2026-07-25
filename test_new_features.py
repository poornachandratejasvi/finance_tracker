#!/usr/bin/env python3
"""
Test suite for newly added features:
1. Dashboard (summary, monthly, custom reports)
2. Bulk edit transactions
3. Custom fields
4. Field mapping
5. Resync PDFs (fixed bank code detection)
"""

import requests
import sys

BASE_URL = "http://localhost:8000/api"

def test_endpoint_exists(endpoint, method="GET"):
    """Test if endpoint exists and returns appropriate response"""
    try:
        url = f"{BASE_URL}{endpoint}"
        
        if method == "GET":
            response = requests.get(url)
        elif method == "POST":
            response = requests.post(url, json={})
        
        # 401 means endpoint exists but needs auth (good!)
        # 422 means endpoint exists but validation failed (good!)
        # 200 means endpoint works (best!)
        # 404 means endpoint doesn't exist (bad!)
        
        if response.status_code in [200, 401, 422]:
            return True, response.status_code
        else:
            return False, response.status_code
    except Exception as e:
        return False, str(e)

def main():
    print("=" * 60)
    print("Testing New Feature Endpoints")
    print("=" * 60)
    
    tests = [
        # Dashboard endpoints
        ("Dashboard Summary", "/dashboard/summary", "GET"),
        ("Dashboard Monthly Summary", "/dashboard/monthly-summary", "GET"),
        ("Dashboard Custom Report", "/dashboard/custom-report", "POST"),
        
        # Transaction enhancements
        ("Bulk Edit Transactions", "/transactions/bulk-edit", "POST"),
        ("Get Transaction Fields", "/transactions/fields", "GET"),
        ("Update Custom Fields", "/transactions/1/custom-fields", "POST"),
        
        # Field mapping
        ("Get Field Mapping", "/field-mapping/1", "GET"),
        ("Update Field Mapping", "/field-mapping/1", "POST"),
        ("List All Mappings", "/field-mapping", "GET"),
        
        # Existing features (should still work)
        ("Resync PDFs", "/sync/resync-pdfs", "POST"),
        ("List Banks", "/banks/", "GET"),
        ("List Transactions", "/transactions/", "GET"),
    ]
    
    passed = 0
    failed = 0
    
    for name, endpoint, method in tests:
        exists, status = test_endpoint_exists(endpoint, method)
        
        if exists:
            print(f"✓ {name:40s} [{method:4s}] - Status {status}")
            passed += 1
        else:
            print(f"✗ {name:40s} [{method:4s}] - Status {status}")
            failed += 1
    
    print("=" * 60)
    print(f"Results: {passed} passed, {failed} failed out of {passed + failed} tests")
    print("=" * 60)
    
    if failed == 0:
        print("✅ All new endpoints are properly registered!")
        print("\nNote: Endpoints return 401 (auth required) which is expected.")
        print("To test functionality, log in through the web UI at:")
        print("  http://localhost:3000")
        return 0
    else:
        print("❌ Some endpoints are not registered properly.")
        return 1

if __name__ == "__main__":
    sys.exit(main())
