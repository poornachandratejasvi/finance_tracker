#!/usr/bin/env python3
"""
Comprehensive UI and API testing for Finance Tracker
"""
import requests
import time
import json
from datetime import datetime
import os

API_URL = "http://localhost:8000"
BASE_URL = API_URL + "/api"

class FinanceTrackerTest:
    def __init__(self):
        self.token = None
        self.tests_passed = 0
        self.tests_failed = 0
        
    def log(self, message, status="INFO"):
        timestamp = datetime.now().strftime("%H:%M:%S")
        symbols = {"PASS": "✓", "FAIL": "✗", "INFO": "ℹ", "WARN": "⚠"}
        print(f"[{timestamp}] {symbols.get(status, 'ℹ')} {message}")
    
    def test(self, name, func):
        """Run a test function"""
        try:
            self.log(f"Testing: {name}")
            func()
            self.tests_passed += 1
            self.log(f"{name}: PASSED", "PASS")
            return True
        except Exception as e:
            self.tests_failed += 1
            self.log(f"{name}: FAILED - {str(e)}", "FAIL")
            return False
    
    def login(self):
        """Login and get token"""
        username = os.getenv("ADMIN_USERNAME")
        password = os.getenv("ADMIN_PASSWORD")

        if not username or not password:
            env_path = os.path.join(os.path.dirname(__file__), ".env")
            if os.path.exists(env_path):
                with open(env_path, "r", encoding="utf-8") as env_file:
                    for line in env_file:
                        if line.startswith("ADMIN_USERNAME=") and not username:
                            username = line.strip().split("=", 1)[1]
                        if line.startswith("ADMIN_PASSWORD=") and not password:
                            password = line.strip().split("=", 1)[1]

        username = username or "admin"
        password = password or "admin123"
        data = {
            "username": username,
            "password": password
        }
        response = requests.post(
            f"{BASE_URL}/auth/login",
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"}
        )
        assert response.status_code == 200, f"Login failed: {response.text}"
        self.token = response.json()["access_token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
        self.log("Login successful")
    
    def test_get_transactions(self):
        """Test getting transactions"""
        response = requests.get(f"{BASE_URL}/transactions/", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
        self.log(f"Found {data['total']} transactions")
    
    def test_get_banks(self):
        """Test getting banks"""
        response = requests.get(f"{BASE_URL}/banks/", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        self.log(f"Found {len(data)} banks")
    
    def test_get_pdfs(self):
        """Test getting PDFs"""
        response = requests.get(f"{BASE_URL}/pdfs/", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
        self.log(f"Found {data['total']} PDFs")
        return data['items']
    
    def test_pdf_stats(self):
        """Test PDF statistics"""
        response = requests.get(f"{BASE_URL}/pdfs/stats", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert "stats" in data
        for stat in data['stats']:
            self.log(f"  {stat['bank_name']}: {stat['processed_pdfs']}/{stat['total_pdfs']} processed")
    
    def test_reprocess_unprocessed_pdfs(self):
        """Test reprocessing unprocessed PDFs"""
        # Get unprocessed PDFs
        response = requests.get(
            f"{BASE_URL}/pdfs/",
            params={"is_processed": "false", "limit": 5},
            headers=self.headers
        )
        assert response.status_code == 200
        pdfs = response.json()['items']
        
        if not pdfs:
            self.log("No unprocessed PDFs found", "WARN")
            return
        
        self.log(f"Found {len(pdfs)} unprocessed PDFs, reprocessing first one...")
        pdf = pdfs[0]
        
        response = requests.post(
            f"{BASE_URL}/pdfs/{pdf['id']}/reprocess",
            headers=self.headers
        )
        if response.status_code != 200:
            self.log(f"Reprocess skipped: {response.status_code} {response.text}", "WARN")
            return
        result = response.json()
        self.log(f"  Reprocessed {result['file_name']}: {result['transactions_added']} transactions added")
    
    def test_download_pdf(self):
        """Test downloading a PDF"""
        # Get first PDF
        response = requests.get(f"{BASE_URL}/pdfs/?limit=1", headers=self.headers)
        assert response.status_code == 200
        pdfs = response.json()['items']
        
        if not pdfs:
            self.log("No PDFs found", "WARN")
            return
        
        pdf_id = pdfs[0]['id']
        response = requests.get(
            f"{BASE_URL}/pdfs/{pdf_id}/download",
            headers=self.headers
        )
        assert response.status_code == 200
        assert response.headers['content-type'] == 'application/pdf'
        self.log(f"Downloaded PDF {pdf_id}, size: {len(response.content)} bytes")
    
    def test_resync_pdfs(self):
        """Test resync PDFs endpoint"""
        response = requests.post(
            f"{BASE_URL}/sync/resync-pdfs",
            params={"force_all": False},
            headers=self.headers
        )
        assert response.status_code == 200
        result = response.json()
        self.log(f"Resync completed: {result['pdfs_processed']} PDFs, {result['transactions_added']} transactions")
    
    def test_create_manual_transaction(self):
        """Test creating manual transaction"""
        bank_response = requests.get(f"{BASE_URL}/banks/", headers=self.headers)
        assert bank_response.status_code == 200
        banks = bank_response.json()
        if not banks:
            self.log("No banks available for manual transaction", "WARN")
            return
        bank_id = banks[0]["id"]
        data = {
            "bank_id": bank_id,
            "transaction_date": "2026-01-30T00:00:00",
            "description": "Test Manual Transaction",
            "amount": 100.50,
            "transaction_type": "debit",
            "category": "Testing",
            "notes": "Created by automated test"
        }
        response = requests.post(
            f"{BASE_URL}/transactions/",
            json=data,
            headers=self.headers
        )
        assert response.status_code in (200, 201), response.text
        result = response.json()
        self.log(f"Created manual transaction ID: {result['id']}")
        
        # Clean up - delete the test transaction
        requests.delete(f"{BASE_URL}/transactions/{result['id']}", headers=self.headers)
        self.log(f"Deleted test transaction ID: {result['id']}")
    
    def run_all_tests(self):
        """Run all tests"""
        self.log("="*60)
        self.log("Finance Tracker - Comprehensive Test Suite")
        self.log("="*60)
        
        # Login first
        try:
            self.login()
        except Exception as e:
            self.log(f"Login failed: {e}", "FAIL")
            return
        
        # Run all tests
        self.test("Get Transactions", self.test_get_transactions)
        self.test("Get Banks", self.test_get_banks)
        self.test("Get PDFs", self.test_get_pdfs)
        self.test("PDF Statistics", self.test_pdf_stats)
        self.test("Download PDF", self.test_download_pdf)
        self.test("Reprocess Unprocessed PDFs", self.test_reprocess_unprocessed_pdfs)
        self.test("Create Manual Transaction", self.test_create_manual_transaction)
        self.test("Resync PDFs", self.test_resync_pdfs)
        
        # Summary
        self.log("="*60)
        self.log(f"Tests Passed: {self.tests_passed}", "PASS")
        self.log(f"Tests Failed: {self.tests_failed}", "FAIL" if self.tests_failed > 0 else "INFO")
        self.log("="*60)
        
        return self.tests_failed == 0

if __name__ == "__main__":
    tester = FinanceTrackerTest()
    success = tester.run_all_tests()
    exit(0 if success else 1)
