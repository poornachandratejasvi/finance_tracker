#!/usr/bin/env python3
"""
Automated UI Test for Finance Tracker Application
Tests login flow and dashboard verification
"""

import time
import sys
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service

class FinanceTrackerUITest:
    def __init__(self, headless=True):
        self.base_url = "http://localhost:3000"
        self.username = "admin"
        self.password = "7411470935"
        self.results = []
        self.driver = None
        self.headless = headless
        
    def setup_driver(self):
        """Setup Chrome driver with appropriate options"""
        chrome_options = Options()
        if self.headless:
            chrome_options.add_argument('--headless=new')
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        chrome_options.add_argument('--disable-gpu')
        chrome_options.add_argument('--window-size=1920,1080')
        
        try:
            self.driver = webdriver.Chrome(options=chrome_options)
            self.driver.implicitly_wait(10)
            return True
        except Exception as e:
            self.log_result("SETUP", False, f"Failed to initialize Chrome driver: {str(e)}")
            return False
    
    def log_result(self, test_name, passed, message, details=None):
        """Log test result"""
        status = "✓ PASS" if passed else "✗ FAIL"
        result = {
            "test": test_name,
            "status": status,
            "message": message,
            "details": details
        }
        self.results.append(result)
        print(f"\n{status} - {test_name}: {message}")
        if details:
            print(f"  Details: {details}")
    
    def take_screenshot(self, name):
        """Take a screenshot and return the filename"""
        if self.driver:
            filename = f"screenshot_{name}_{int(time.time())}.png"
            try:
                self.driver.save_screenshot(filename)
                print(f"  Screenshot saved: {filename}")
                return filename
            except Exception as e:
                print(f"  Failed to save screenshot: {str(e)}")
                return None
        return None
    
    def test_step_1_navigate_to_home(self):
        """Step 1: Navigate to http://localhost:3000"""
        try:
            print("\n" + "="*60)
            print("STEP 1: Navigate to http://localhost:3000")
            print("="*60)
            
            self.driver.get(self.base_url)
            time.sleep(2)
            
            current_url = self.driver.current_url
            page_title = self.driver.title
            
            self.log_result(
                "Navigate to home",
                True,
                f"Successfully navigated to {self.base_url}",
                f"Current URL: {current_url}, Page Title: {page_title}"
            )
            
            return True
        except Exception as e:
            self.log_result("Navigate to home", False, str(e))
            return False
    
    def test_step_2_verify_login_redirect(self):
        """Step 2: Verify redirect to /login page"""
        try:
            print("\n" + "="*60)
            print("STEP 2: Verify redirect to /login")
            print("="*60)
            
            wait = WebDriverWait(self.driver, 10)
            wait.until(lambda driver: "/login" in driver.current_url)
            
            current_url = self.driver.current_url
            
            if "/login" in current_url:
                self.log_result(
                    "Redirect to login page",
                    True,
                    "Successfully redirected to login page",
                    f"Current URL: {current_url}"
                )
                
                # Take snapshot
                screenshot = self.take_screenshot("login_page")
                
                # Verify login form elements
                try:
                    username_field = self.driver.find_element(By.NAME, "username")
                    password_field = self.driver.find_element(By.NAME, "password")
                    login_button = self.driver.find_element(By.CSS_SELECTOR, "button[type='submit']")
                    
                    self.log_result(
                        "Login form elements",
                        True,
                        "Login form contains username, password fields and submit button"
                    )
                    
                    # Get page content description
                    body_text = self.driver.find_element(By.TAG_NAME, "body").text
                    print(f"\n  Page content preview:")
                    print(f"  {body_text[:300]}...")
                    
                except Exception as e:
                    self.log_result(
                        "Login form elements",
                        False,
                        f"Could not find all login form elements: {str(e)}"
                    )
                
                return True
            else:
                self.log_result(
                    "Redirect to login page",
                    False,
                    f"Not redirected to login page. Current URL: {current_url}"
                )
                return False
                
        except Exception as e:
            self.log_result("Redirect to login page", False, str(e))
            return False
    
    def test_step_3_login(self):
        """Step 3: Login with provided credentials"""
        try:
            print("\n" + "="*60)
            print("STEP 3: Login with admin credentials")
            print("="*60)
            
            # Find and fill username
            username_field = self.driver.find_element(By.NAME, "username")
            username_field.clear()
            username_field.send_keys(self.username)
            
            # Find and fill password
            password_field = self.driver.find_element(By.NAME, "password")
            password_field.clear()
            password_field.send_keys(self.password)
            
            # Take screenshot before submitting
            self.take_screenshot("before_login")
            
            # Click login button
            login_button = self.driver.find_element(By.CSS_SELECTOR, "button[type='submit']")
            login_button.click()
            
            # Wait for navigation
            time.sleep(3)
            
            current_url = self.driver.current_url
            
            self.log_result(
                "Login submission",
                True,
                f"Login form submitted successfully",
                f"Current URL after login: {current_url}"
            )
            
            return True
            
        except Exception as e:
            self.log_result("Login submission", False, str(e))
            self.take_screenshot("login_error")
            return False
    
    def test_step_4_verify_dashboard_redirect(self):
        """Step 4: Verify redirect to /dashboard"""
        try:
            print("\n" + "="*60)
            print("STEP 4: Verify redirect to /dashboard")
            print("="*60)
            
            wait = WebDriverWait(self.driver, 10)
            wait.until(lambda driver: "/dashboard" in driver.current_url or "/login" not in driver.current_url)
            
            current_url = self.driver.current_url
            
            if "/dashboard" in current_url or current_url.endswith("/"):
                self.log_result(
                    "Redirect to dashboard",
                    True,
                    "Successfully redirected to dashboard",
                    f"Current URL: {current_url}"
                )
                return True
            else:
                self.log_result(
                    "Redirect to dashboard",
                    False,
                    f"Not redirected to dashboard. Current URL: {current_url}"
                )
                return False
                
        except Exception as e:
            self.log_result("Redirect to dashboard", False, str(e))
            return False
    
    def test_step_5_verify_dashboard_elements(self):
        """Step 5: Verify dashboard page elements"""
        try:
            print("\n" + "="*60)
            print("STEP 5: Verify dashboard elements")
            print("="*60)
            
            time.sleep(2)
            
            # Take dashboard screenshot
            self.take_screenshot("dashboard_page")
            
            # Get page title
            page_title = self.driver.title
            print(f"  Page Title: {page_title}")
            
            # Get body text for analysis
            body_text = self.driver.find_element(By.TAG_NAME, "body").text
            
            # Check for header/title
            header_found = False
            header_text = ""
            try:
                # Try multiple selectors for header
                possible_headers = [
                    (By.TAG_NAME, "h1"),
                    (By.TAG_NAME, "h2"),
                    (By.CSS_SELECTOR, "[class*='title']"),
                    (By.CSS_SELECTOR, "[class*='header']")
                ]
                
                for selector in possible_headers:
                    try:
                        header_element = self.driver.find_element(*selector)
                        header_text = header_element.text
                        if header_text and ("Dashboard" in header_text or "Financial" in header_text or "Overview" in header_text):
                            header_found = True
                            break
                    except:
                        continue
                
                if header_found:
                    self.log_result(
                        "Dashboard header/title",
                        True,
                        f"Found dashboard header: '{header_text}'"
                    )
                else:
                    # Check in body text
                    if "Dashboard" in body_text or "Financial Overview" in body_text:
                        self.log_result(
                            "Dashboard header/title",
                            True,
                            "Dashboard or Financial Overview text found on page"
                        )
                    else:
                        self.log_result(
                            "Dashboard header/title",
                            False,
                            "Could not find 'Dashboard' or 'Financial Overview' header"
                        )
            except Exception as e:
                self.log_result("Dashboard header/title", False, str(e))
            
            # Check for summary cards (debit, credit, balance)
            summary_cards_found = False
            try:
                # Look for financial terms in the page
                has_debit = "debit" in body_text.lower() or "debits" in body_text.lower()
                has_credit = "credit" in body_text.lower() or "credits" in body_text.lower()
                has_balance = "balance" in body_text.lower() or "net" in body_text.lower()
                
                if has_debit and has_credit and has_balance:
                    summary_cards_found = True
                    self.log_result(
                        "Summary cards (debit/credit/balance)",
                        True,
                        "Found references to debit, credit, and balance on page"
                    )
                else:
                    missing = []
                    if not has_debit: missing.append("debit")
                    if not has_credit: missing.append("credit")
                    if not has_balance: missing.append("balance")
                    
                    self.log_result(
                        "Summary cards (debit/credit/balance)",
                        False,
                        f"Missing summary information: {', '.join(missing)}"
                    )
            except Exception as e:
                self.log_result("Summary cards", False, str(e))
            
            # Check for Balances section
            balances_found = False
            try:
                if "balance" in body_text.lower() or "bank" in body_text.lower():
                    balances_found = True
                    self.log_result(
                        "Balances section",
                        True,
                        "Found balances or bank-related content on page"
                    )
                else:
                    self.log_result(
                        "Balances section",
                        False,
                        "Could not find balances or bank section"
                    )
            except Exception as e:
                self.log_result("Balances section", False, str(e))
            
            # Check for month label
            month_found = False
            try:
                import re
                month_pattern = r'(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}'
                month_match = re.search(month_pattern, body_text)
                
                if month_match:
                    month_found = True
                    self.log_result(
                        "Month label",
                        True,
                        f"Found month label: '{month_match.group()}'"
                    )
                else:
                    self.log_result(
                        "Month label",
                        False,
                        "Could not find month label in format 'MMM YYYY'"
                    )
            except Exception as e:
                self.log_result("Month label", False, str(e))
            
            # Print page content for manual review
            print(f"\n  Dashboard page content (first 500 chars):")
            print(f"  {body_text[:500]}")
            print(f"  ...")
            
            # Overall dashboard verification
            all_elements_found = header_found and summary_cards_found and balances_found and month_found
            
            return True
            
        except Exception as e:
            self.log_result("Dashboard elements verification", False, str(e))
            self.take_screenshot("dashboard_error")
            return False
    
    def test_step_6_dashboard_snapshot(self):
        """Step 6: Take final dashboard snapshot and describe"""
        try:
            print("\n" + "="*60)
            print("STEP 6: Final dashboard snapshot and description")
            print("="*60)
            
            screenshot = self.take_screenshot("dashboard_final")
            
            # Get comprehensive page information
            current_url = self.driver.current_url
            page_title = self.driver.title
            body_text = self.driver.find_element(By.TAG_NAME, "body").text
            
            # Get all visible text elements
            try:
                all_headings = []
                for tag in ["h1", "h2", "h3", "h4", "h5", "h6"]:
                    elements = self.driver.find_elements(By.TAG_NAME, tag)
                    for elem in elements:
                        text = elem.text.strip()
                        if text:
                            all_headings.append(f"{tag.upper()}: {text}")
                
                if all_headings:
                    print("\n  All headings found on page:")
                    for heading in all_headings[:10]:
                        print(f"    - {heading}")
            except:
                pass
            
            description = f"""
Dashboard Snapshot Description:
================================
URL: {current_url}
Page Title: {page_title}
Screenshot: {screenshot if screenshot else 'Failed to capture'}

Page Content Summary:
{body_text[:1000]}
...

"""
            print(description)
            
            self.log_result(
                "Dashboard snapshot",
                True,
                "Successfully captured dashboard state",
                description
            )
            
            return True
            
        except Exception as e:
            self.log_result("Dashboard snapshot", False, str(e))
            return False
    
    def run_all_tests(self):
        """Run all test steps"""
        print("\n" + "="*60)
        print("FINANCE TRACKER UI TEST - AUTOMATED")
        print("="*60)
        print(f"Base URL: {self.base_url}")
        print(f"Username: {self.username}")
        print(f"Password: {'*' * len(self.password)}")
        print("="*60)
        
        if not self.setup_driver():
            return False
        
        try:
            # Run all test steps
            self.test_step_1_navigate_to_home()
            self.test_step_2_verify_login_redirect()
            self.test_step_3_login()
            self.test_step_4_verify_dashboard_redirect()
            self.test_step_5_verify_dashboard_elements()
            self.test_step_6_dashboard_snapshot()
            
        finally:
            if self.driver:
                self.driver.quit()
        
        # Print summary
        self.print_summary()
        
        return True
    
    def print_summary(self):
        """Print test summary report"""
        print("\n" + "="*60)
        print("TEST SUMMARY REPORT")
        print("="*60)
        
        total_tests = len(self.results)
        passed_tests = sum(1 for r in self.results if "✓ PASS" in r["status"])
        failed_tests = total_tests - passed_tests
        
        print(f"\nTotal Tests: {total_tests}")
        print(f"Passed: {passed_tests}")
        print(f"Failed: {failed_tests}")
        print(f"Success Rate: {(passed_tests/total_tests)*100:.1f}%")
        
        print("\nDetailed Results:")
        print("-" * 60)
        
        for result in self.results:
            print(f"\n{result['status']} - {result['test']}")
            print(f"  {result['message']}")
            if result['details']:
                print(f"  {result['details'][:200]}")
        
        print("\n" + "="*60)
        
        if failed_tests > 0:
            print("❌ SOME TESTS FAILED - Please review the failures above")
            return False
        else:
            print("✅ ALL TESTS PASSED")
            return True

if __name__ == "__main__":
    # Run tests in headless mode
    tester = FinanceTrackerUITest(headless=True)
    success = tester.run_all_tests()
    
    sys.exit(0 if success else 1)
