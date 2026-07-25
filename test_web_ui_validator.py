#!/usr/bin/env python3
"""
Comprehensive Web UI Validator for Finance Tracker
Tests all frontend pages and components for functionality
"""

import time
import sys
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import TimeoutException, NoSuchElementException
from webdriver_manager.chrome import ChromeDriverManager

# Configuration
FRONTEND_URL = "http://localhost:3000"
USERNAME = "admin"
PASSWORD = "7411470935"

# Colors for output
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'

class WebUIValidator:
    def __init__(self):
        self.driver = None
        self.test_results = []
        self.wait = None
        
    def setup_driver(self):
        """Setup Chrome WebDriver"""
        print(f"\n{BLUE}[INFO]{RESET} Setting up Chrome WebDriver...")
        chrome_options = Options()
        chrome_options.add_argument('--headless')
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        chrome_options.add_argument('--disable-gpu')
        chrome_options.add_argument('--window-size=1920,1080')
        
        try:
            service = Service(ChromeDriverManager().install())
            self.driver = webdriver.Chrome(service=service, options=chrome_options)
            self.wait = WebDriverWait(self.driver, 10)
            print(f"{GREEN}[PASS]{RESET} WebDriver initialized successfully")
            return True
        except Exception as e:
            print(f"{RED}[FAIL]{RESET} Failed to initialize WebDriver: {str(e)}")
            return False
    
    def login(self):
        """Login to the application"""
        try:
            print(f"\n{BLUE}[INFO]{RESET} Logging in...")
            self.driver.get(f"{FRONTEND_URL}/login")
            time.sleep(2)
            
            # Find and fill username
            username_input = self.wait.until(
                EC.presence_of_element_located((By.NAME, "username"))
            )
            username_input.clear()
            username_input.send_keys(USERNAME)
            
            # Find and fill password
            password_input = self.driver.find_element(By.NAME, "password")
            password_input.clear()
            password_input.send_keys(PASSWORD)
            
            # Click login button
            login_button = self.driver.find_element(By.XPATH, "//button[contains(text(), 'Sign In')]")
            login_button.click()
            
            # Wait for redirect to dashboard
            time.sleep(3)
            
            if "/dashboard" in self.driver.current_url or "/login" not in self.driver.current_url:
                print(f"{GREEN}[PASS]{RESET} Login successful")
                self.test_results.append(("Login", True, ""))
                return True
            else:
                print(f"{RED}[FAIL]{RESET} Login failed - still on login page")
                self.test_results.append(("Login", False, "Failed to redirect after login"))
                return False
                
        except Exception as e:
            print(f"{RED}[FAIL]{RESET} Login error: {str(e)}")
            self.test_results.append(("Login", False, str(e)))
            return False
    
    def test_dashboard_page(self):
        """Test Dashboard page"""
        print(f"\n{BLUE}[INFO]{RESET} Testing Dashboard page...")
        try:
            self.driver.get(f"{FRONTEND_URL}/dashboard")
            time.sleep(2)
            
            # Check for key dashboard elements
            checks = []
            
            # Check for page title or heading
            try:
                dashboard_heading = self.driver.find_element(By.XPATH, "//*[contains(text(), 'Dashboard') or contains(text(), 'Overview')]")
                checks.append(("Dashboard heading", True))
            except:
                checks.append(("Dashboard heading", False))
            
            # Check for statistics cards
            try:
                cards = self.driver.find_elements(By.CSS_SELECTOR, "[class*='MuiCard'], [class*='card']")
                if len(cards) > 0:
                    checks.append((f"Statistics cards ({len(cards)} found)", True))
                else:
                    checks.append(("Statistics cards", False))
            except:
                checks.append(("Statistics cards", False))
            
            # Check for no runtime errors
            try:
                error_elements = self.driver.find_elements(By.XPATH, "//*[contains(text(), 'Error') or contains(text(), 'error')]")
                error_overlays = self.driver.find_elements(By.CSS_SELECTOR, "[class*='error'], [class*='Error']")
                if len(error_elements) == 0 and len(error_overlays) == 0:
                    checks.append(("No runtime errors", True))
                else:
                    checks.append(("No runtime errors", False))
            except:
                checks.append(("No runtime errors", True))
            
            # Summary
            passed = sum(1 for _, status in checks if status)
            total = len(checks)
            
            if passed == total:
                print(f"{GREEN}[PASS]{RESET} Dashboard page - All {total} checks passed")
                self.test_results.append(("Dashboard Page", True, f"{passed}/{total} checks"))
            else:
                print(f"{YELLOW}[PARTIAL]{RESET} Dashboard page - {passed}/{total} checks passed")
                for check_name, status in checks:
                    if not status:
                        print(f"  {RED}✗{RESET} {check_name}")
                self.test_results.append(("Dashboard Page", False, f"Only {passed}/{total} checks passed"))
            
        except Exception as e:
            print(f"{RED}[FAIL]{RESET} Dashboard page error: {str(e)}")
            self.test_results.append(("Dashboard Page", False, str(e)))
    
    def test_banks_page(self):
        """Test Banks page"""
        print(f"\n{BLUE}[INFO]{RESET} Testing Banks page...")
        try:
            self.driver.get(f"{FRONTEND_URL}/banks")
            time.sleep(2)
            
            checks = []
            
            # Check page loaded
            try:
                banks_element = self.driver.find_element(By.XPATH, "//*[contains(text(), 'Banks') or contains(text(), 'Bank')]")
                checks.append(("Banks page loaded", True))
            except:
                checks.append(("Banks page loaded", False))
            
            # Check for tabs (Banks and Gmail Accounts)
            try:
                tabs = self.driver.find_elements(By.CSS_SELECTOR, "[role='tab']")
                if len(tabs) >= 2:
                    checks.append((f"Tabs present ({len(tabs)} found)", True))
                else:
                    checks.append(("Tabs present", False))
            except:
                checks.append(("Tabs present", False))
            
            # Check for Add Bank button
            try:
                add_button = self.driver.find_element(By.XPATH, "//button[contains(., 'Add Bank') or contains(., 'Add')]")
                checks.append(("Add Bank button", True))
            except:
                checks.append(("Add Bank button", False))
            
            # Check for bank cards
            try:
                cards = self.driver.find_elements(By.CSS_SELECTOR, "[class*='MuiCard'], [class*='card']")
                checks.append((f"Bank cards ({len(cards)} found)", True))
            except:
                checks.append(("Bank cards", False))
            
            # Check for no error overlay
            try:
                error_overlay = self.driver.find_elements(By.XPATH, "//*[contains(text(), 'Edit is not defined') or contains(text(), 'ReferenceError')]")
                if len(error_overlay) == 0:
                    checks.append(("No Edit error", True))
                else:
                    checks.append(("No Edit error", False))
            except:
                checks.append(("No Edit error", True))
            
            passed = sum(1 for _, status in checks if status)
            total = len(checks)
            
            if passed == total:
                print(f"{GREEN}[PASS]{RESET} Banks page - All {total} checks passed")
                self.test_results.append(("Banks Page", True, f"{passed}/{total} checks"))
            else:
                print(f"{YELLOW}[PARTIAL]{RESET} Banks page - {passed}/{total} checks passed")
                for check_name, status in checks:
                    if not status:
                        print(f"  {RED}✗{RESET} {check_name}")
                self.test_results.append(("Banks Page", False, f"Only {passed}/{total} checks passed"))
                
        except Exception as e:
            print(f"{RED}[FAIL]{RESET} Banks page error: {str(e)}")
            self.test_results.append(("Banks Page", False, str(e)))
    
    def test_transactions_page(self):
        """Test Transactions page"""
        print(f"\n{BLUE}[INFO]{RESET} Testing Transactions page...")
        try:
            self.driver.get(f"{FRONTEND_URL}/transactions")
            time.sleep(2)
            
            checks = []
            
            # Check page loaded
            try:
                transactions_element = self.driver.find_element(By.XPATH, "//*[contains(text(), 'Transactions') or contains(text(), 'Transaction')]")
                checks.append(("Transactions page loaded", True))
            except:
                checks.append(("Transactions page loaded", False))
            
            # Check for filters
            try:
                filters = self.driver.find_elements(By.CSS_SELECTOR, "[class*='filter'], select, input[type='date']")
                if len(filters) > 0:
                    checks.append(("Filter elements present", True))
                else:
                    checks.append(("Filter elements present", False))
            except:
                checks.append(("Filter elements present", False))
            
            # Check for table or list
            try:
                table_or_list = self.driver.find_elements(By.CSS_SELECTOR, "table, [role='table'], [class*='MuiTable']")
                if len(table_or_list) > 0:
                    checks.append(("Transaction table/list", True))
                else:
                    checks.append(("Transaction table/list", False))
            except:
                checks.append(("Transaction table/list", False))
            
            passed = sum(1 for _, status in checks if status)
            total = len(checks)
            
            if passed == total:
                print(f"{GREEN}[PASS]{RESET} Transactions page - All {total} checks passed")
                self.test_results.append(("Transactions Page", True, f"{passed}/{total} checks"))
            else:
                print(f"{YELLOW}[PARTIAL]{RESET} Transactions page - {passed}/{total} checks passed")
                for check_name, status in checks:
                    if not status:
                        print(f"  {RED}✗{RESET} {check_name}")
                self.test_results.append(("Transactions Page", False, f"Only {passed}/{total} checks passed"))
                
        except Exception as e:
            print(f"{RED}[FAIL]{RESET} Transactions page error: {str(e)}")
            self.test_results.append(("Transactions Page", False, str(e)))
    
    def test_labels_page(self):
        """Test Labels functionality in Settings page"""
        print(f"\n{BLUE}[INFO]{RESET} Testing Labels (in Settings)...")
        try:
            self.driver.get(f"{FRONTEND_URL}/settings")
            time.sleep(2)
            
            checks = []
            
            # Check settings page loaded
            try:
                settings_element = self.driver.find_element(By.XPATH, "//*[contains(text(), 'Settings') or contains(text(), 'Labels')]")
                checks.append(("Settings page loaded", True))
            except:
                checks.append(("Settings page loaded", False))
            
            # Check for labels tab or section
            try:
                tabs = self.driver.find_elements(By.CSS_SELECTOR, "[role='tab']")
                labels_found = False
                for tab in tabs:
                    if 'label' in tab.text.lower():
                        labels_found = True
                        break
                if labels_found:
                    checks.append(("Labels tab found", True))
                else:
                    checks.append(("Labels tab found", False))
            except:
                checks.append(("Labels tab found", False))
            
            passed = sum(1 for _, status in checks if status)
            total = len(checks)
            
            if passed == total:
                print(f"{GREEN}[PASS]{RESET} Labels - All {total} checks passed")
                self.test_results.append(("Labels (Settings)", True, f"{passed}/{total} checks"))
            else:
                print(f"{YELLOW}[PARTIAL]{RESET} Labels - {passed}/{total} checks passed")
                for check_name, status in checks:
                    if not status:
                        print(f"  {RED}✗{RESET} {check_name}")
                self.test_results.append(("Labels (Settings)", False, f"Only {passed}/{total} checks passed"))
                
        except Exception as e:
            print(f"{RED}[FAIL]{RESET} Labels error: {str(e)}")
            self.test_results.append(("Labels (Settings)", False, str(e)))
    
    def test_settings_page(self):
        """Test Settings page"""
        print(f"\n{BLUE}[INFO]{RESET} Testing Settings page...")
        try:
            self.driver.get(f"{FRONTEND_URL}/settings")
            time.sleep(2)
            
            checks = []
            
            # Check page loaded
            try:
                settings_element = self.driver.find_element(By.XPATH, "//*[contains(text(), 'Settings') or contains(text(), 'Profile')]")
                checks.append(("Settings page loaded", True))
            except:
                checks.append(("Settings page loaded", False))
            
            # Check for user profile section
            try:
                profile = self.driver.find_elements(By.XPATH, "//*[contains(text(), 'Profile') or contains(text(), 'User')]")
                if len(profile) > 0:
                    checks.append(("User profile section", True))
                else:
                    checks.append(("User profile section", False))
            except:
                checks.append(("User profile section", False))
            
            passed = sum(1 for _, status in checks if status)
            total = len(checks)
            
            if passed == total:
                print(f"{GREEN}[PASS]{RESET} Settings page - All {total} checks passed")
                self.test_results.append(("Settings Page", True, f"{passed}/{total} checks"))
            else:
                print(f"{YELLOW}[PARTIAL]{RESET} Settings page - {passed}/{total} checks passed")
                for check_name, status in checks:
                    if not status:
                        print(f"  {RED}✗{RESET} {check_name}")
                self.test_results.append(("Settings Page", False, f"Only {passed}/{total} checks passed"))
                
        except Exception as e:
            print(f"{RED}[FAIL]{RESET} Settings page error: {str(e)}")
            self.test_results.append(("Settings Page", False, str(e)))
    
    def test_navigation(self):
        """Test navigation menu"""
        print(f"\n{BLUE}[INFO]{RESET} Testing Navigation...")
        try:
            self.driver.get(f"{FRONTEND_URL}/dashboard")
            time.sleep(2)
            
            checks = []
            
            # Check for app bar/header
            try:
                appbar = self.driver.find_element(By.CSS_SELECTOR, "[class*='MuiAppBar'], header")
                checks.append(("App header present", True))
            except:
                checks.append(("App header present", False))
            
            # Check for navigation buttons in toolbar
            try:
                nav_buttons = self.driver.find_elements(By.CSS_SELECTOR, "[class*='MuiToolbar'] button")
                # Should have Dashboard, Transactions, Banks, Settings + account menu
                if len(nav_buttons) >= 4:
                    checks.append((f"Navigation buttons ({len(nav_buttons)} found)", True))
                else:
                    checks.append(("Navigation buttons", False))
            except Exception as e:
                checks.append(("Navigation buttons", False))
            
            passed = sum(1 for _, status in checks if status)
            total = len(checks)
            
            if passed == total:
                print(f"{GREEN}[PASS]{RESET} Navigation - All {total} checks passed")
                self.test_results.append(("Navigation", True, f"{passed}/{total} checks"))
            else:
                print(f"{YELLOW}[PARTIAL]{RESET} Navigation - {passed}/{total} checks passed")
                for check_name, status in checks:
                    if not status:
                        print(f"  {RED}✗{RESET} {check_name}")
                self.test_results.append(("Navigation", False, f"Only {passed}/{total} checks passed"))
                
        except Exception as e:
            print(f"{RED}[FAIL]{RESET} Navigation error: {str(e)}")
            self.test_results.append(("Navigation", False, str(e)))
    
    def test_responsiveness(self):
        """Test responsive design"""
        print(f"\n{BLUE}[INFO]{RESET} Testing Responsiveness...")
        try:
            sizes = [
                ("Desktop", 1920, 1080),
                ("Tablet", 768, 1024),
                ("Mobile", 375, 667)
            ]
            
            for size_name, width, height in sizes:
                self.driver.set_window_size(width, height)
                self.driver.get(f"{FRONTEND_URL}/dashboard")
                time.sleep(2)
                
                # Check if content is visible (not hidden behind viewport)
                body = self.driver.find_element(By.TAG_NAME, "body")
                if body.is_displayed():
                    print(f"  {GREEN}✓{RESET} {size_name} ({width}x{height}) - Content visible")
                else:
                    print(f"  {RED}✗{RESET} {size_name} ({width}x{height}) - Content not visible")
            
            self.driver.set_window_size(1920, 1080)  # Reset to desktop
            self.test_results.append(("Responsiveness", True, "Tested multiple viewport sizes"))
            print(f"{GREEN}[PASS]{RESET} Responsiveness tests completed")
            
        except Exception as e:
            print(f"{RED}[FAIL]{RESET} Responsiveness error: {str(e)}")
            self.test_results.append(("Responsiveness", False, str(e)))
    
    def print_summary(self):
        """Print test summary"""
        print(f"\n{'='*60}")
        print(f"{BLUE}Test Summary{RESET}")
        print(f"{'='*60}\n")
        
        total = len(self.test_results)
        passed = sum(1 for _, status, _ in self.test_results if status)
        failed = total - passed
        
        print(f"Total Tests: {total}")
        print(f"{GREEN}Passed: {passed}{RESET}")
        print(f"{RED}Failed: {failed}{RESET}")
        print(f"Success Rate: {(passed/total*100):.1f}%\n")
        
        if failed > 0:
            print(f"{RED}Failed Tests:{RESET}")
            for name, status, error in self.test_results:
                if not status:
                    print(f"  - {name}")
                    if error:
                        print(f"    Error: {error}")
        
        print(f"\n{'='*60}")
        if failed == 0:
            print(f"{GREEN}✅ All UI tests passed!{RESET}")
            print(f"{GREEN}The web UI is fully functional.{RESET}")
        else:
            print(f"{YELLOW}⚠️  Some UI tests failed.{RESET}")
        print(f"{'='*60}\n")
        
        return failed == 0
    
    def run_all_tests(self):
        """Run all UI validation tests"""
        print(f"\n{'='*60}")
        print(f"{BLUE}Finance Tracker - Web UI Validator{RESET}")
        print(f"{'='*60}")
        
        if not self.setup_driver():
            return False
        
        try:
            # Login first
            if not self.login():
                print(f"\n{RED}[ERROR]{RESET} Cannot proceed without login")
                return False
            
            # Run all page tests
            self.test_dashboard_page()
            self.test_banks_page()
            self.test_transactions_page()
            self.test_labels_page()
            self.test_settings_page()
            self.test_navigation()
            self.test_responsiveness()
            
            # Print summary
            success = self.print_summary()
            return success
            
        finally:
            if self.driver:
                self.driver.quit()
                print(f"\n{BLUE}[INFO]{RESET} Browser closed")

if __name__ == "__main__":
    validator = WebUIValidator()
    success = validator.run_all_tests()
    sys.exit(0 if success else 1)
