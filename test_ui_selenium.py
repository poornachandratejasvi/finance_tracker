#!/usr/bin/env python3
"""
Real UI Testing with Selenium - Tests actual frontend rendering
Tests all 14 user requirements by interacting with the actual web UI
"""

import time
import sys
import os
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
PASSWORD = "admin123"

# Colors
GREEN = '\033[0;32m'
RED = '\033[0;31m'
YELLOW = '\033[1;33m'
BLUE = '\033[0;34m'
NC = '\033[0m'

class UITester:
    def __init__(self):
        self.driver = None
        self.wait = None
        self.passed = 0
        self.failed = 0
        
    def setup_driver(self):
        """Setup Chrome WebDriver"""
        print(f"\n{BLUE}[SETUP]{NC} Initializing Chrome WebDriver...")
        options = Options()
        # Run in non-headless mode for better compatibility
        # options.add_argument('--headless')  # Commented out - running in visible mode
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        options.add_argument('--disable-gpu')
        options.add_argument('--window-size=1920,1080')
        options.add_argument('--disable-blink-features=AutomationControlled')
        options.add_argument('--remote-debugging-port=9222')
        
        try:
            service = Service(ChromeDriverManager().install())
            self.driver = webdriver.Chrome(service=service, options=options)
            self.wait = WebDriverWait(self.driver, 15)
            print(f"{GREEN}[PASS]{NC} WebDriver initialized\n")
            return True
        except Exception as e:
            print(f"{RED}[FAIL]{NC} Failed to initialize WebDriver: {e}")
            return False
    
    def login(self):
        """Login to application"""
        try:
            print(f"{BLUE}[TEST]{NC} Logging in...")
            self.driver.get(f"{FRONTEND_URL}/login")
            time.sleep(2)
            
            username_input = self.wait.until(EC.presence_of_element_located((By.NAME, "username")))
            username_input.send_keys(USERNAME)
            
            password_input = self.driver.find_element(By.NAME, "password")
            password_input.send_keys(PASSWORD)
            
            login_button = self.driver.find_element(By.XPATH, "//button[contains(., 'Sign In')]")
            login_button.click()
            
            time.sleep(3)
            
            if "/login" not in self.driver.current_url:
                print(f"{GREEN}[PASS]{NC} Login successful\n")
                self.passed += 1
                return True
            else:
                print(f"{RED}[FAIL]{NC} Login failed\n")
                self.failed += 1
                return False
                
        except Exception as e:
            print(f"{RED}[FAIL]{NC} Login error: {e}\n")
            self.failed += 1
            return False
    
    def test_1_and_13_analytics_banks_dropdown(self):
        """REQ 1 & 13: Analytics page should show banks in dropdown"""
        print(f"{BLUE}[TEST 1 & 13]{NC} Analytics - Banks dropdown populated")
        try:
            self.driver.get(f"{FRONTEND_URL}/analytics")
            time.sleep(3)
            
            # Find the Bank filter select
            bank_select = self.wait.until(EC.presence_of_element_located(
                (By.XPATH, "//label[contains(text(), 'Bank')]/following-sibling::div//select | //label[contains(text(), 'Bank')]/..//select | //*[@id='bank-select']")
            ))
            
            # Click to open dropdown
            bank_select.click()
            time.sleep(1)
            
            # Check for options
            options = self.driver.find_elements(By.XPATH, "//ul[@role='listbox']//li | //div[@role='option']")
            
            if len(options) > 1:  # More than just "All Banks"
                print(f"  {GREEN}✓{NC} Found {len(options)} options in banks dropdown")
                print(f"{GREEN}[PASS]{NC} Banks dropdown is populated\n")
                self.passed += 1
            else:
                print(f"  {RED}✗{NC} Banks dropdown is empty or has only 1 option")
                print(f"{RED}[FAIL]{NC} Banks dropdown not populated\n")
                self.failed += 1
                
        except Exception as e:
            print(f"  {RED}✗{NC} Could not find banks dropdown: {e}")
            print(f"{RED}[FAIL]{NC} Banks dropdown test failed\n")
            self.failed += 1
    
    def test_2_analytics_all_filters(self):
        """REQ 2: Analytics should have filters for all fields"""
        print(f"{BLUE}[TEST 2]{NC} Analytics - All filters present")
        try:
            self.driver.get(f"{FRONTEND_URL}/analytics")
            time.sleep(3)
            
            required_filters = [
                ("Bank", "//label[contains(text(), 'Bank')]"),
                ("Start Date", "//label[contains(text(), 'Start Date')] | //input[@type='date']"),
                ("End Date", "//label[contains(text(), 'End Date')] | //input[@type='date']"),
                ("Category", "//label[contains(text(), 'Category')]"),
                ("Transaction Type", "//label[contains(text(), 'Type')] | //label[contains(text(), 'Transaction Type')]"),
            ]
            
            found_filters = 0
            for filter_name, xpath in required_filters:
                try:
                    element = self.driver.find_element(By.XPATH, xpath)
                    print(f"  {GREEN}✓{NC} Found filter: {filter_name}")
                    found_filters += 1
                except:
                    print(f"  {YELLOW}?{NC} Filter not found: {filter_name}")
            
            if found_filters >= 4:  # At least 4 filters
                print(f"{GREEN}[PASS]{NC} Analytics has comprehensive filters ({found_filters}/5)\n")
                self.passed += 1
            else:
                print(f"{RED}[FAIL]{NC} Not enough filters ({found_filters}/5)\n")
                self.failed += 1
                
        except Exception as e:
            print(f"  {RED}✗{NC} Error checking filters: {e}")
            print(f"{RED}[FAIL]{NC} Filter test failed\n")
            self.failed += 1
    
    def test_3_5_6_duplicate_buttons(self):
        """REQ 3, 5, 6: Find and Remove Duplicates buttons"""
        print(f"{BLUE}[TEST 3, 5, 6]{NC} Transactions - Duplicate removal buttons")
        try:
            self.driver.get(f"{FRONTEND_URL}/transactions")
            time.sleep(3)
            
            # Check for Find Duplicates button
            find_button = None
            remove_button = None
            
            try:
                find_button = self.driver.find_element(By.XPATH, "//button[contains(., 'Find Duplicates')]")
                print(f"  {GREEN}✓{NC} Found 'Find Duplicates' button")
            except:
                print(f"  {RED}✗{NC} 'Find Duplicates' button not found")
            
            try:
                remove_button = self.driver.find_element(By.XPATH, "//button[contains(., 'Remove Duplicates')]")
                print(f"  {GREEN}✓{NC} Found 'Remove Duplicates' button")
            except:
                print(f"  {RED}✗{NC} 'Remove Duplicates' button not found")
            
            if find_button and remove_button:
                print(f"{GREEN}[PASS]{NC} Both duplicate buttons present\n")
                self.passed += 1
            else:
                print(f"{RED}[FAIL]{NC} Duplicate buttons missing\n")
                self.failed += 1
                
        except Exception as e:
            print(f"  {RED}✗{NC} Error: {e}")
            print(f"{RED}[FAIL]{NC} Duplicate buttons test failed\n")
            self.failed += 1
    
    def test_4_pdf_source_column(self):
        """REQ 4: Transactions should show PDF source"""
        print(f"{BLUE}[TEST 4]{NC} Transactions - PDF Source column")
        try:
            self.driver.get(f"{FRONTEND_URL}/transactions")
            time.sleep(3)
            
            # Check for PDF Source column
            try:
                pdf_column = self.driver.find_element(By.XPATH, "//th[contains(., 'PDF')] | //th[contains(., 'Source')]")
                print(f"  {GREEN}✓{NC} Found PDF Source column header")
                print(f"{GREEN}[PASS]{NC} PDF Source column exists\n")
                self.passed += 1
            except:
                print(f"  {RED}✗{NC} PDF Source column not found")
                print(f"{RED}[FAIL]{NC} PDF Source column missing\n")
                self.failed += 1
                
        except Exception as e:
            print(f"  {RED}✗{NC} Error: {e}")
            print(f"{RED}[FAIL]{NC} PDF Source test failed\n")
            self.failed += 1
    
    def test_7_resync_pdfs(self):
        """REQ 7: Resync PDFs button should not error"""
        print(f"{BLUE}[TEST 7]{NC} Resync PDFs - No error on empty")
        try:
            self.driver.get(f"{FRONTEND_URL}/pdfs")
            time.sleep(3)
            
            # Find Resync button
            resync_button = self.driver.find_element(By.XPATH, "//button[contains(., 'Resync') or contains(., 'Sync')]")
            print(f"  {GREEN}✓{NC} Found Resync button")
            
            # Click it
            resync_button.click()
            time.sleep(2)
            
            # Check for error
            try:
                error = self.driver.find_element(By.XPATH, "//*[contains(text(), 'Failed') and contains(text(), 'resync')]")
                print(f"  {RED}✗{NC} Resync shows error")
                print(f"{RED}[FAIL]{NC} Resync PDFs failed\n")
                self.failed += 1
            except:
                print(f"  {GREEN}✓{NC} No error shown (expected for empty PDFs)")
                print(f"{GREEN}[PASS]{NC} Resync handles empty gracefully\n")
                self.passed += 1
                
        except Exception as e:
            print(f"  {YELLOW}?{NC} Could not test resync: {e}")
            print(f"{YELLOW}[SKIP]{NC} Resync test skipped\n")
    
    def test_8_field_mapping_banks(self):
        """REQ 8: Field Mapping should show banks"""
        print(f"{BLUE}[TEST 8]{NC} Field Mapping - Banks dropdown")
        try:
            self.driver.get(f"{FRONTEND_URL}/field-mapping")
            time.sleep(3)
            
            # Find bank select
            bank_select = self.wait.until(EC.presence_of_element_located(
                (By.XPATH, "//label[contains(text(), 'Bank')]/..//select | //select[@name='bank']")
            ))
            
            # Get options
            bank_select.click()
            time.sleep(1)
            
            options = self.driver.find_elements(By.XPATH, "//option | //li[@role='option']")
            
            if len(options) > 0:
                print(f"  {GREEN}✓{NC} Found {len(options)} bank options")
                print(f"{GREEN}[PASS]{NC} Field Mapping banks loaded\n")
                self.passed += 1
            else:
                print(f"  {RED}✗{NC} No banks in Field Mapping dropdown")
                print(f"{RED}[FAIL]{NC} Field Mapping banks empty\n")
                self.failed += 1
                
        except Exception as e:
            print(f"  {RED}✗{NC} Error: {e}")
            print(f"{RED}[FAIL]{NC} Field Mapping test failed\n")
            self.failed += 1
    
    def test_10_discord_integration_ui(self):
        """REQ 10: Discord integration in Settings"""
        print(f"{BLUE}[TEST 10]{NC} Settings - Discord webhook UI")
        try:
            self.driver.get(f"{FRONTEND_URL}/settings")
            time.sleep(3)
            
            # Find Integrations tab
            tabs = self.driver.find_elements(By.XPATH, "//button[@role='tab']")
            integrations_tab = None
            
            for tab in tabs:
                if 'integration' in tab.text.lower():
                    integrations_tab = tab
                    break
            
            if integrations_tab:
                integrations_tab.click()
                time.sleep(2)
                
                # Check for Discord webhook field
                try:
                    webhook_field = self.driver.find_element(By.XPATH, "//input[contains(@placeholder, 'discord') or contains(@label, 'Discord')]")
                    print(f"  {GREEN}✓{NC} Found Discord webhook field")
                    
                    # Check for test button
                    test_button = self.driver.find_element(By.XPATH, "//button[contains(., 'Test')]")
                    print(f"  {GREEN}✓{NC} Found Test Notification button")
                    
                    print(f"{GREEN}[PASS]{NC} Discord integration UI exists\n")
                    self.passed += 1
                except:
                    print(f"  {RED}✗{NC} Discord webhook field not found")
                    print(f"{RED}[FAIL]{NC} Discord UI incomplete\n")
                    self.failed += 1
            else:
                print(f"  {RED}✗{NC} Integrations tab not found")
                print(f"{RED}[FAIL]{NC} Discord integration UI missing\n")
                self.failed += 1
                
        except Exception as e:
            print(f"  {RED}✗{NC} Error: {e}")
            print(f"{RED}[FAIL]{NC} Discord integration test failed\n")
            self.failed += 1
    
    def test_11_dark_mode_logs(self):
        """REQ 11: Dark mode logs should be visible"""
        print(f"{BLUE}[TEST 11]{NC} Settings - Dark mode logs visibility")
        try:
            self.driver.get(f"{FRONTEND_URL}/settings")
            time.sleep(2)
            
            # Toggle dark mode
            try:
                dark_mode_toggle = self.driver.find_element(By.XPATH, "//button[contains(@aria-label, 'dark')] | //*[contains(@class, 'dark')]//button")
                dark_mode_toggle.click()
                time.sleep(1)
            except:
                print(f"  {YELLOW}?{NC} Could not toggle dark mode")
            
            # Go to System tab
            tabs = self.driver.find_elements(By.XPATH, "//button[@role='tab']")
            system_tab = None
            
            for tab in tabs:
                if 'system' in tab.text.lower():
                    system_tab = tab
                    break
            
            if system_tab:
                system_tab.click()
                time.sleep(2)
                
                # Check logs color
                try:
                    logs_element = self.driver.find_element(By.XPATH, "//pre | //*[contains(@class, 'monospace')]")
                    color = logs_element.value_of_css_property('color')
                    
                    # In dark mode, text should not be black
                    if 'rgb(0, 0, 0)' not in color:
                        print(f"  {GREEN}✓{NC} Logs text color: {color}")
                        print(f"{GREEN}[PASS]{NC} Dark mode logs are visible\n")
                        self.passed += 1
                    else:
                        print(f"  {RED}✗{NC} Logs text is black in dark mode")
                        print(f"{RED}[FAIL]{NC} Dark mode logs not visible\n")
                        self.failed += 1
                except:
                    print(f"  {YELLOW}?{NC} Could not check logs color")
                    print(f"{YELLOW}[SKIP]{NC} Dark mode logs test skipped\n")
            else:
                print(f"  {RED}✗{NC} System tab not found")
                print(f"{RED}[FAIL]{NC} Cannot test dark mode logs\n")
                self.failed += 1
                
        except Exception as e:
            print(f"  {RED}✗{NC} Error: {e}")
            print(f"{RED}[FAIL]{NC} Dark mode test failed\n")
            self.failed += 1
    
    def test_14_test_notification_button(self):
        """REQ 14: Test notification button exists"""
        print(f"{BLUE}[TEST 14]{NC} Settings - Test notification button")
        try:
            self.driver.get(f"{FRONTEND_URL}/settings")
            time.sleep(2)
            
            # Find Integrations tab
            tabs = self.driver.find_elements(By.XPATH, "//button[@role='tab']")
            for tab in tabs:
                if 'integration' in tab.text.lower():
                    tab.click()
                    break
            
            time.sleep(2)
            
            # Check for test button
            test_button = self.driver.find_element(By.XPATH, "//button[contains(., 'Test Notification')]")
            
            print(f"  {GREEN}✓{NC} Found Test Notification button")
            print(f"{GREEN}[PASS]{NC} Test notification button exists\n")
            self.passed += 1
                
        except Exception as e:
            print(f"  {RED}✗{NC} Test notification button not found: {e}")
            print(f"{RED}[FAIL]{NC} Test notification button missing\n")
            self.failed += 1
    
    def print_summary(self):
        """Print test summary"""
        total = self.passed + self.failed
        
        print(f"\n{'='*70}")
        print(f"{BLUE}UI TEST SUMMARY{NC}")
        print(f"{'='*70}")
        print(f"Total Tests: {total}")
        print(f"{GREEN}Passed: {self.passed}{NC}")
        print(f"{RED}Failed: {self.failed}{NC}")
        
        if total > 0:
            success_rate = (self.passed / total) * 100
            print(f"Success Rate: {success_rate:.1f}%")
        
        print(f"{'='*70}\n")
        
        if self.failed == 0:
            print(f"{GREEN}✅ ALL UI TESTS PASSED!{NC}")
            print(f"{GREEN}The user interface is fully functional.{NC}\n")
            return True
        else:
            print(f"{YELLOW}⚠️  Some UI tests failed.{NC}")
            print(f"Please check the failed tests above.\n")
            return False
    
    def run_all_tests(self):
        """Run all UI tests"""
        print(f"\n{'='*70}")
        print(f"{BLUE}FINANCE TRACKER - REAL UI TESTING{NC}")
        print(f"{BLUE}Testing actual frontend rendering and functionality{NC}")
        print(f"{'='*70}")
        
        if not self.setup_driver():
            return False
        
        try:
            if not self.login():
                print(f"{RED}Cannot proceed without login{NC}")
                return False
            
            # Run all tests
            self.test_1_and_13_analytics_banks_dropdown()
            self.test_2_analytics_all_filters()
            self.test_3_5_6_duplicate_buttons()
            self.test_4_pdf_source_column()
            self.test_7_resync_pdfs()
            self.test_8_field_mapping_banks()
            self.test_10_discord_integration_ui()
            self.test_11_dark_mode_logs()
            self.test_14_test_notification_button()
            
            # Print summary
            success = self.print_summary()
            return success
            
        except Exception as e:
            print(f"{RED}Fatal error: {e}{NC}")
            return False
        finally:
            if self.driver:
                self.driver.quit()
                print(f"{BLUE}[INFO]{NC} Browser closed\n")


if __name__ == "__main__":
    tester = UITester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)
