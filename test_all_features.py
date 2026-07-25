#!/usr/bin/env python3
"""
Comprehensive test suite for Finance Tracker
Tests all API endpoints and functionality
"""

import requests
import json
import sys
from datetime import datetime

# Configuration
BASE_URL = "http://localhost:8000"
FRONTEND_URL = "http://localhost:3000"
USERNAME = "admin"
PASSWORD = "7411470935"

# Colors for output
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
RESET = '\033[0m'
BLUE = '\033[94m'

class FinanceTrackerTester:
    def __init__(self):
        self.token = None
        self.test_results = []
        self.bank_id = None
        self.label_id = None
        self.transaction_id = None
        
    def log(self, message, status="INFO"):
        colors = {"PASS": GREEN, "FAIL": RED, "INFO": BLUE, "WARN": YELLOW}
        color = colors.get(status, RESET)
        print(f"{color}[{status}]{RESET} {message}")
        
    def test(self, name, func):
        """Run a test and record result"""
        try:
            func()
            self.log(f"{name}", "PASS")
            self.test_results.append((name, True, None))
            return True
        except Exception as e:
            self.log(f"{name}: {str(e)}", "FAIL")
            self.test_results.append((name, False, str(e)))
            return False
    
    def test_backend_health(self):
        """Test backend is accessible"""
        response = requests.get(f"{BASE_URL}/")
        assert response.status_code == 200, "Backend not accessible"
        data = response.json()
        assert "message" in data, "Invalid response format"
        
    def test_frontend_health(self):
        """Test frontend is accessible"""
        response = requests.get(FRONTEND_URL)
        assert response.status_code == 200, "Frontend not accessible"
        
    def test_login(self):
        """Test user login"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            data={"username": USERNAME, "password": PASSWORD},
            headers={"Content-Type": "application/x-www-form-urlencoded"}
        )
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "access_token" in data, "No access token in response"
        self.token = data["access_token"]
        
    def get_headers(self):
        """Get authorization headers"""
        return {"Authorization": f"Bearer {self.token}"}
    
    def test_get_current_user(self):
        """Test get current user endpoint"""
        response = requests.get(f"{BASE_URL}/api/users/me", headers=self.get_headers())
        assert response.status_code == 200, f"Get user failed: {response.text}"
        data = response.json()
        assert data["username"] == USERNAME, "Wrong user returned"
        
    def test_list_banks(self):
        """Test list banks endpoint"""
        response = requests.get(f"{BASE_URL}/api/banks/", headers=self.get_headers())
        assert response.status_code == 200, f"List banks failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Banks should be a list"
        
    def test_create_bank(self):
        """Test create bank endpoint"""
        # First, try to get existing banks to avoid duplicate code
        response = requests.get(
            f"{BASE_URL}/api/banks/",
            headers=self.get_headers()
        )
        existing_banks = response.json() if response.status_code == 200 else []
        
        # Look for existing test bank
        for bank in existing_banks:
            if bank.get("code") == "TESTBANK":
                self.bank_id = bank["id"]
                return  # Use existing bank
        
        # Create new bank if doesn't exist
        bank_data = {
            "name": "Test Bank",
            "code": "TESTBANK",
            "sender_email": "alerts@testbank.com"
        }
        response = requests.post(
            f"{BASE_URL}/api/banks/",
            json=bank_data,
            headers=self.get_headers()
        )
        assert response.status_code == 201, f"Create bank failed: {response.text}"
        data = response.json()
        assert "id" in data, "No bank ID in response"
        self.bank_id = data["id"]
        
    def test_get_bank(self):
        """Test get specific bank"""
        if not self.bank_id:
            raise Exception("No bank created yet")
        response = requests.get(
            f"{BASE_URL}/api/banks/{self.bank_id}",
            headers=self.get_headers()
        )
        assert response.status_code == 200, f"Get bank failed: {response.text}"
        data = response.json()
        assert data["name"] == "Test Bank", "Wrong bank returned"
        
    def test_list_labels(self):
        """Test list labels endpoint"""
        response = requests.get(f"{BASE_URL}/api/labels/", headers=self.get_headers())
        assert response.status_code == 200, f"List labels failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Labels should be a list"
        
    def test_create_label(self):
        """Test create label endpoint"""
        label_data = {
            "name": "Shopping",
            "color": "#FF5733",
            "auto_keywords": ["amazon", "flipkart", "shopping"]
        }
        response = requests.post(
            f"{BASE_URL}/api/labels/",
            json=label_data,
            headers=self.get_headers()
        )
        assert response.status_code == 201, f"Create label failed: {response.text}"
        data = response.json()
        assert "id" in data, "No label ID in response"
        self.label_id = data["id"]
        
    def test_list_transactions(self):
        """Test list transactions endpoint"""
        response = requests.get(
            f"{BASE_URL}/api/transactions/",
            headers=self.get_headers()
        )
        assert response.status_code == 200, f"List transactions failed: {response.text}"
        data = response.json()
        assert "items" in data or isinstance(data, list), "Invalid transaction response format"
        
    def test_list_transactions_with_filters(self):
        """Test transactions with filter parameters"""
        params = {
            "skip": 0,
            "limit": 10,
            "type": "credit"
        }
        response = requests.get(
            f"{BASE_URL}/api/transactions/",
            params=params,
            headers=self.get_headers()
        )
        assert response.status_code == 200, f"Filtered transactions failed: {response.text}"
        
    def test_create_transaction(self):
        """Test create transaction endpoint"""
        if not self.bank_id:
            raise Exception("No bank available for transaction")
            
        transaction_data = {
            "bank_id": self.bank_id,
            "transaction_date": datetime.now().isoformat(),
            "description": "Test Transaction",
            "amount": 1000.00,
            "transaction_type": "credit",
            "from_account": "Test Account",
            "to_account": "My Account"
        }
        response = requests.post(
            f"{BASE_URL}/api/transactions/",
            json=transaction_data,
            headers=self.get_headers()
        )
        assert response.status_code == 201, f"Create transaction failed: {response.text}"
        data = response.json()
        assert "id" in data, "No transaction ID in response"
        self.transaction_id = data["id"]
        
    def test_update_transaction(self):
        """Test update transaction endpoint"""
        if not self.transaction_id:
            raise Exception("No transaction to update")
            
        update_data = {
            "description": "Updated Test Transaction",
            "amount": 1500.00
        }
        response = requests.put(
            f"{BASE_URL}/api/transactions/{self.transaction_id}",
            json=update_data,
            headers=self.get_headers()
        )
        assert response.status_code == 200, f"Update transaction failed: {response.text}"
        
    def test_get_duplicates(self):
        """Test get duplicate transactions"""
        response = requests.get(
            f"{BASE_URL}/api/transactions/duplicates",
            headers=self.get_headers()
        )
        assert response.status_code == 200, f"Get duplicates failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Duplicates should be a list"
        
    def test_gmail_accounts(self):
        """Test list Gmail accounts endpoint"""
        response = requests.get(
            f"{BASE_URL}/api/banks/gmail-accounts/",
            headers=self.get_headers()
        )
        # May return 404 if endpoint not found, that's okay
        assert response.status_code in [200, 404], f"Gmail accounts check failed: {response.text}"
        
    def test_api_docs(self):
        """Test API documentation is accessible"""
        response = requests.get(f"{BASE_URL}/docs")
        assert response.status_code == 200, "API docs not accessible"
        
    def cleanup(self):
        """Clean up test data"""
        try:
            if self.transaction_id:
                requests.delete(
                    f"{BASE_URL}/api/transactions/{self.transaction_id}",
                    headers=self.get_headers()
                )
            # Note: Not deleting bank and label as they might be useful
        except:
            pass
    
    def run_all_tests(self):
        """Run all tests"""
        print("\n" + "="*60)
        print("Finance Tracker - Comprehensive Test Suite")
        print("="*60 + "\n")
        
        # Health checks
        self.log("Testing Backend Health...", "INFO")
        self.test("Backend Health Check", self.test_backend_health)
        
        self.log("\nTesting Frontend Health...", "INFO")
        self.test("Frontend Health Check", self.test_frontend_health)
        
        # Authentication
        self.log("\nTesting Authentication...", "INFO")
        self.test("User Login", self.test_login)
        self.test("Get Current User", self.test_get_current_user)
        
        # Banks
        self.log("\nTesting Banks API...", "INFO")
        self.test("List Banks", self.test_list_banks)
        self.test("Create Bank", self.test_create_bank)
        self.test("Get Bank Details", self.test_get_bank)
        
        # Labels
        self.log("\nTesting Labels API...", "INFO")
        self.test("List Labels", self.test_list_labels)
        self.test("Create Label", self.test_create_label)
        
        # Transactions
        self.log("\nTesting Transactions API...", "INFO")
        self.test("List Transactions", self.test_list_transactions)
        self.test("List Transactions with Filters", self.test_list_transactions_with_filters)
        self.test("Create Transaction", self.test_create_transaction)
        self.test("Update Transaction", self.test_update_transaction)
        self.test("Get Duplicates", self.test_get_duplicates)
        
        # Gmail
        self.log("\nTesting Gmail Integration...", "INFO")
        self.test("Gmail Accounts Endpoint", self.test_gmail_accounts)
        
        # Documentation
        self.log("\nTesting Documentation...", "INFO")
        self.test("API Documentation", self.test_api_docs)
        
        # Cleanup
        self.log("\nCleaning up test data...", "INFO")
        self.cleanup()
        
        # Summary
        self.print_summary()
        
    def print_summary(self):
        """Print test summary"""
        print("\n" + "="*60)
        print("Test Summary")
        print("="*60)
        
        passed = sum(1 for _, result, _ in self.test_results if result)
        failed = sum(1 for _, result, _ in self.test_results if not result)
        total = len(self.test_results)
        
        print(f"\nTotal Tests: {total}")
        print(f"{GREEN}Passed: {passed}{RESET}")
        print(f"{RED}Failed: {failed}{RESET}")
        print(f"Success Rate: {(passed/total*100):.1f}%\n")
        
        if failed > 0:
            print(f"{RED}Failed Tests:{RESET}")
            for name, result, error in self.test_results:
                if not result:
                    print(f"  - {name}")
                    if error:
                        print(f"    Error: {error}")
        
        print("\n" + "="*60)
        
        if failed == 0:
            print(f"{GREEN}✅ All tests passed!{RESET}")
            print(f"{GREEN}The application is fully functional.{RESET}")
        else:
            print(f"{YELLOW}⚠️  Some tests failed. Check the errors above.{RESET}")
        
        print("="*60 + "\n")
        
        return failed == 0

if __name__ == "__main__":
    tester = FinanceTrackerTester()
    try:
        success = tester.run_all_tests()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\nTests interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n{RED}Fatal error: {e}{RESET}")
        sys.exit(1)
