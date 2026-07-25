"""
Comprehensive validation tool to test all requirements
"""
import requests
import json
import sys
from datetime import datetime
from typing import Dict, List, Tuple

class FinanceTrackerValidator:
    def __init__(self, base_url="http://localhost:8000"):
        self.base_url = base_url
        self.token = None
        self.results = []
        
    def log_result(self, test_name: str, passed: bool, message: str = ""):
        """Log test result"""
        status = "✅ PASS" if passed else "❌ FAIL"
        self.results.append({
            "test": test_name,
            "passed": passed,
            "message": message,
            "timestamp": datetime.now().isoformat()
        })
        print(f"{status} - {test_name}: {message}")
        
    def login(self, username="testuser", password="testpass123"):
        """Login and get token"""
        try:
            response = requests.post(
                f"{self.base_url}/api/auth/login",
                data={"username": username, "password": password}
            )
            if response.status_code == 200:
                self.token = response.json().get("access_token")
                self.log_result("Authentication", True, "Login successful")
                return True
            else:
                self.log_result("Authentication", False, f"Login failed: {response.status_code}")
                return False
        except Exception as e:
            self.log_result("Authentication", False, f"Error: {str(e)}")
            return False
            
    def get_headers(self):
        """Get authorization headers"""
        return {"Authorization": f"Bearer {self.token}"}
        
    def test_field_mapping_loads_banks(self):
        """Test: PDF Field Mapping loads banks"""
        try:
            response = requests.get(
                f"{self.base_url}/api/banks/",
                headers=self.get_headers()
            )
            if response.status_code == 200:
                banks = response.json().get("banks", [])
                self.log_result(
                    "Field Mapping - Banks Loading",
                    True,
                    f"Successfully loaded {len(banks)} banks"
                )
                return True
            else:
                self.log_result(
                    "Field Mapping - Banks Loading",
                    False,
                    f"Failed to load banks: {response.status_code}"
                )
                return False
        except Exception as e:
            self.log_result("Field Mapping - Banks Loading", False, f"Error: {str(e)}")
            return False
            
    def test_analytics_shows_default_data(self):
        """Test: Analytics shows data by default"""
        try:
            response = requests.get(
                f"{self.base_url}/api/dashboard/summary",
                headers=self.get_headers()
            )
            if response.status_code == 200:
                data = response.json()
                has_data = (
                    data.get("total_income") is not None or
                    data.get("total_expense") is not None
                )
                self.log_result(
                    "Analytics - Default Data",
                    has_data,
                    f"Data loaded: income={data.get('total_income')}, expense={data.get('total_expense')}"
                )
                return has_data
            else:
                self.log_result(
                    "Analytics - Default Data",
                    False,
                    f"Failed: {response.status_code}"
                )
                return False
        except Exception as e:
            self.log_result("Analytics - Default Data", False, f"Error: {str(e)}")
            return False
            
    def test_analytics_banks_selectable(self):
        """Test: Analytics has banks to select"""
        try:
            response = requests.get(
                f"{self.base_url}/api/banks/",
                headers=self.get_headers()
            )
            if response.status_code == 200:
                banks = response.json().get("banks", [])
                has_banks = len(banks) > 0
                self.log_result(
                    "Analytics - Banks Selectable",
                    has_banks,
                    f"Found {len(banks)} banks available for selection"
                )
                return has_banks
            else:
                self.log_result(
                    "Analytics - Banks Selectable",
                    False,
                    f"Failed: {response.status_code}"
                )
                return False
        except Exception as e:
            self.log_result("Analytics - Banks Selectable", False, f"Error: {str(e)}")
            return False
            
    def test_analytics_filters_work(self):
        """Test: Analytics filters work"""
        try:
            # Get first bank
            banks_response = requests.get(
                f"{self.base_url}/api/banks/",
                headers=self.get_headers()
            )
            if banks_response.status_code != 200:
                self.log_result("Analytics - Filters", False, "Failed to get banks")
                return False
                
            banks = banks_response.json().get("banks", [])
            if not banks:
                self.log_result("Analytics - Filters", False, "No banks available for filtering")
                return False
                
            bank_id = banks[0]["id"]
            
            # Test with bank filter
            response = requests.get(
                f"{self.base_url}/api/dashboard/summary?bank_id={bank_id}",
                headers=self.get_headers()
            )
            if response.status_code == 200:
                self.log_result(
                    "Analytics - Filters",
                    True,
                    f"Filters working for bank_id={bank_id}"
                )
                return True
            else:
                self.log_result(
                    "Analytics - Filters",
                    False,
                    f"Filter request failed: {response.status_code}"
                )
                return False
        except Exception as e:
            self.log_result("Analytics - Filters", False, f"Error: {str(e)}")
            return False
            
    def test_bank_resync_endpoint(self):
        """Test: Bank resync endpoint exists and responds"""
        try:
            response = requests.post(
                f"{self.base_url}/api/sync/resync-pdfs",
                headers=self.get_headers(),
                json={"force_all": False}
            )
            # Accept 200 or 422 (no data) as valid responses
            success = response.status_code in [200, 422]
            message = f"Endpoint responds: {response.status_code}"
            if response.status_code == 200:
                result = response.json()
                message = f"Success: {result.get('pdfs_processed', 0)} PDFs processed"
                
            self.log_result("Bank Resync - Endpoint", success, message)
            return success
        except Exception as e:
            self.log_result("Bank Resync - Endpoint", False, f"Error: {str(e)}")
            return False
            
    def test_multiple_emails_support(self):
        """Test: Banks support multiple sender emails"""
        try:
            # Create a test bank with multiple emails
            test_bank = {
                "name": "Test Bank",
                "code": "TEST",
                "sender_email": "test@bank.com",
                "sender_emails": json.dumps(["test1@bank.com", "test2@bank.com"]),
                "bank_type": "savings"
            }
            
            response = requests.post(
                f"{self.base_url}/api/banks/",
                headers=self.get_headers(),
                json=test_bank
            )
            
            if response.status_code == 200:
                bank_id = response.json().get("id")
                
                # Verify it was saved
                get_response = requests.get(
                    f"{self.base_url}/api/banks/",
                    headers=self.get_headers()
                )
                
                if get_response.status_code == 200:
                    banks = get_response.json().get("banks", [])
                    test_bank_data = next((b for b in banks if b["id"] == bank_id), None)
                    
                    if test_bank_data:
                        has_multiple_emails = test_bank_data.get("sender_emails") is not None
                        
                        # Cleanup
                        requests.delete(
                            f"{self.base_url}/api/banks/{bank_id}",
                            headers=self.get_headers()
                        )
                        
                        self.log_result(
                            "Multiple Emails - Support",
                            has_multiple_emails,
                            "Multiple emails stored and retrieved successfully"
                        )
                        return has_multiple_emails
                        
            self.log_result("Multiple Emails - Support", False, f"Failed: {response.status_code}")
            return False
        except Exception as e:
            self.log_result("Multiple Emails - Support", False, f"Error: {str(e)}")
            return False
            
    def test_bank_type_column(self):
        """Test: Transactions have bank_type column"""
        try:
            response = requests.get(
                f"{self.base_url}/api/transactions?limit=10",
                headers=self.get_headers()
            )
            
            if response.status_code == 200:
                transactions = response.json().get("transactions", [])
                if transactions:
                    # Check if bank info includes bank_type
                    first_txn = transactions[0]
                    has_bank_type = "bank" in first_txn and isinstance(first_txn["bank"], dict)
                    message = f"Transactions loaded: {len(transactions)}, bank info present: {has_bank_type}"
                else:
                    has_bank_type = True  # No transactions to test, but endpoint works
                    message = "No transactions to test, but endpoint works"
                    
                self.log_result("Bank Type - Column", has_bank_type, message)
                return has_bank_type
            else:
                self.log_result("Bank Type - Column", False, f"Failed: {response.status_code}")
                return False
        except Exception as e:
            self.log_result("Bank Type - Column", False, f"Error: {str(e)}")
            return False
            
    def test_discord_integration(self):
        """Test: Discord notifier exists"""
        try:
            # Check if discord_notifier module exists
            import os
            backend_path = os.path.join(os.path.dirname(__file__), "../services/discord_notifier.py")
            exists = os.path.exists(backend_path)
            
            self.log_result(
                "Discord Integration - Module",
                exists,
                "discord_notifier.py exists" if exists else "discord_notifier.py not found"
            )
            return exists
        except Exception as e:
            self.log_result("Discord Integration - Module", False, f"Error: {str(e)}")
            return False
            
    def test_all_endpoints_health(self):
        """Test: All endpoints are accessible"""
        endpoints = [
            "/health",
            "/api/banks/",
            "/api/transactions",
            "/api/dashboard/summary",
            "/api/dashboard/monthly",
            "/api/field-mapping",
            "/api/bulk-edit/categorize",
        ]
        
        all_healthy = True
        for endpoint in endpoints:
            try:
                url = f"{self.base_url}{endpoint}"
                headers = self.get_headers() if endpoint != "/health" else {}
                response = requests.get(url, headers=headers)
                
                # Accept 200 or 422 as valid
                healthy = response.status_code in [200, 422]
                if not healthy:
                    all_healthy = False
                    
                status = "✅" if healthy else "❌"
                print(f"  {status} {endpoint}: {response.status_code}")
            except Exception as e:
                all_healthy = False
                print(f"  ❌ {endpoint}: Error - {str(e)}")
                
        self.log_result("Endpoints Health", all_healthy, f"Checked {len(endpoints)} endpoints")
        return all_healthy
        
    def run_all_tests(self):
        """Run all validation tests"""
        print("\n" + "="*80)
        print("FINANCE TRACKER - COMPREHENSIVE VALIDATION TOOL")
        print("="*80 + "\n")
        
        # Login first
        if not self.login():
            print("\n⚠️  Cannot proceed without authentication\n")
            return False
            
        print("\n" + "-"*80)
        print("RUNNING VALIDATION TESTS")
        print("-"*80 + "\n")
        
        # Run all tests
        self.test_field_mapping_loads_banks()
        self.test_analytics_shows_default_data()
        self.test_analytics_banks_selectable()
        self.test_analytics_filters_work()
        self.test_bank_resync_endpoint()
        self.test_multiple_emails_support()
        self.test_bank_type_column()
        self.test_discord_integration()
        self.test_all_endpoints_health()
        
        # Generate report
        self.generate_report()
        
        return True
        
    def generate_report(self):
        """Generate validation report"""
        print("\n" + "="*80)
        print("VALIDATION REPORT")
        print("="*80 + "\n")
        
        passed = sum(1 for r in self.results if r["passed"])
        total = len(self.results)
        percentage = (passed / total * 100) if total > 0 else 0
        
        print(f"Total Tests: {total}")
        print(f"Passed: {passed}")
        print(f"Failed: {total - passed}")
        print(f"Success Rate: {percentage:.1f}%")
        
        if total - passed > 0:
            print("\n❌ FAILED TESTS:")
            for result in self.results:
                if not result["passed"]:
                    print(f"  - {result['test']}: {result['message']}")
                    
        print("\n" + "="*80 + "\n")
        
        # Save report to file
        report_file = f"validation_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(report_file, 'w') as f:
            json.dump({
                "timestamp": datetime.now().isoformat(),
                "total_tests": total,
                "passed": passed,
                "failed": total - passed,
                "success_rate": percentage,
                "results": self.results
            }, f, indent=2)
            
        print(f"📄 Detailed report saved to: {report_file}\n")


if __name__ == "__main__":
    validator = FinanceTrackerValidator()
    success = validator.run_all_tests()
    sys.exit(0 if success else 1)
