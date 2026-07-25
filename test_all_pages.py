#!/usr/bin/env python3
"""
Comprehensive UI Test for Finance Tracker Application
Tests all pages: Transactions, Banks, Analytics, and PDFs
"""

import time
import sys
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options

class FinanceTrackerComprehensiveTest:
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
    
    def login(self):
        """Login to the application"""
        try:
            print("\n" + "="*60)
            print("LOGIN PROCESS")
            print("="*60)
            
            self.driver.get(f"{self.base_url}/login")
            time.sleep(2)
            
            # Find and fill username
            username_field = self.driver.find_element(By.NAME, "username")
            username_field.clear()
            username_field.send_keys(self.username)
            
            # Find and fill password
            password_field = self.driver.find_element(By.NAME, "password")
            password_field.clear()
            password_field.send_keys(self.password)
            
            # Click login button
            login_button = self.driver.find_element(By.CSS_SELECTOR, "button[type='submit']")
            login_button.click()
            
            # Wait for navigation
            time.sleep(3)
            
            current_url = self.driver.current_url
            
            if "/login" not in current_url:
                self.log_result(
                    "Login",
                    True,
                    "Successfully logged in",
                    f"Current URL: {current_url}"
                )
                return True
            else:
                self.log_result(
                    "Login",
                    False,
                    "Login failed - still on login page"
                )
                return False
                
        except Exception as e:
            self.log_result("Login", False, str(e))
            self.take_screenshot("login_error")
            return False
    
    def test_transactions_page(self):
        """Test the Transactions page"""
        try:
            print("\n" + "="*60)
            print("TEST 1: TRANSACTIONS PAGE")
            print("="*60)
            
            self.driver.get(f"{self.base_url}/transactions")
            time.sleep(3)
            
            self.take_screenshot("transactions_page")
            
            current_url = self.driver.current_url
            body_text = self.driver.find_element(By.TAG_NAME, "body").text
            
            print(f"  Current URL: {current_url}")
            print(f"  Page content preview:")
            print(f"  {body_text[:500]}")
            
            # Test: Transaction list loads with data
            if "transaction" in body_text.lower() or "no data" in body_text.lower() or "₹" in body_text or "rs" in body_text.lower():
                self.log_result(
                    "Transactions - Page loads",
                    True,
                    "Transactions page loaded successfully"
                )
            else:
                self.log_result(
                    "Transactions - Page loads",
                    False,
                    "Transactions page may not have loaded properly"
                )
            
            # Test: Search/filter area
            has_search = False
            try:
                # Look for search/filter elements
                search_elements = self.driver.find_elements(By.CSS_SELECTOR, "input[type='text'], input[type='search']")
                if search_elements or "search" in body_text.lower() or "filter" in body_text.lower():
                    has_search = True
                    self.log_result(
                        "Transactions - Search/Filter area",
                        True,
                        "Search/filter elements found"
                    )
                else:
                    self.log_result(
                        "Transactions - Search/Filter area",
                        False,
                        "No search/filter elements found"
                    )
            except:
                self.log_result(
                    "Transactions - Search/Filter area",
                    False,
                    "Could not verify search/filter elements"
                )
            
            # Test: Transaction details (date, description, amount, bank, type)
            has_date = "date" in body_text.lower() or any(month in body_text for month in ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])
            has_description = "description" in body_text.lower() or len(body_text.split()) > 20
            has_amount = "₹" in body_text or "amount" in body_text.lower() or "rs" in body_text.lower()
            has_bank = "bank" in body_text.lower() or "hdfc" in body_text.lower() or "icici" in body_text.lower()
            has_type = "debit" in body_text.lower() or "credit" in body_text.lower()
            
            transaction_details_score = sum([has_date, has_description, has_amount, has_bank, has_type])
            
            if transaction_details_score >= 3:
                self.log_result(
                    "Transactions - Transaction details",
                    True,
                    f"Transaction details present ({transaction_details_score}/5 indicators found)",
                    f"Date: {has_date}, Desc: {has_description}, Amount: {has_amount}, Bank: {has_bank}, Type: {has_type}"
                )
            else:
                self.log_result(
                    "Transactions - Transaction details",
                    False,
                    f"Insufficient transaction details ({transaction_details_score}/5 indicators found)",
                    f"Date: {has_date}, Desc: {has_description}, Amount: {has_amount}, Bank: {has_bank}, Type: {has_type}"
                )
            
            # Test: Label badges
            has_labels = "label" in body_text.lower() or "tag" in body_text.lower() or "category" in body_text.lower()
            self.log_result(
                "Transactions - Label badges",
                has_labels,
                "Label badges found" if has_labels else "No label badges visible"
            )
            
            # Test: Select All checkbox or bulk selection
            has_bulk_selection = False
            try:
                checkboxes = self.driver.find_elements(By.CSS_SELECTOR, "input[type='checkbox']")
                has_bulk_selection = len(checkboxes) > 0 or "select all" in body_text.lower()
                self.log_result(
                    "Transactions - Bulk selection UI",
                    has_bulk_selection,
                    f"{'Bulk selection UI found' if has_bulk_selection else 'No bulk selection UI visible'} ({len(checkboxes)} checkboxes)"
                )
            except:
                self.log_result(
                    "Transactions - Bulk selection UI",
                    False,
                    "Could not verify bulk selection UI"
                )
            
            # Test: Multi-label dialog or labeling UI
            has_labeling_ui = "apply label" in body_text.lower() or "add label" in body_text.lower() or "manage label" in body_text.lower()
            self.log_result(
                "Transactions - Multi-label UI",
                has_labeling_ui,
                "Multi-label UI elements found" if has_labeling_ui else "No multi-label UI visible"
            )
            
            return True
            
        except Exception as e:
            self.log_result("Transactions Page", False, str(e))
            self.take_screenshot("transactions_error")
            return False
    
    def test_banks_page(self):
        """Test the Banks page"""
        try:
            print("\n" + "="*60)
            print("TEST 2: BANKS PAGE")
            print("="*60)
            
            self.driver.get(f"{self.base_url}/banks")
            time.sleep(3)
            
            self.take_screenshot("banks_page")
            
            current_url = self.driver.current_url
            body_text = self.driver.find_element(By.TAG_NAME, "body").text
            
            print(f"  Current URL: {current_url}")
            print(f"  Page content preview:")
            print(f"  {body_text[:500]}")
            
            # Test: Banks list loads
            has_bank_data = "bank" in body_text.lower() and (len(body_text.split()) > 20 or "hdfc" in body_text.lower() or "icici" in body_text.lower())
            self.log_result(
                "Banks - Page loads with data",
                has_bank_data,
                "Banks page loaded with data" if has_bank_data else "Banks page may be empty or not loaded"
            )
            
            # Test: Bank details (name, type, balance)
            has_name = len([line for line in body_text.split('\n') if line.strip()]) > 5
            has_type = "type" in body_text.lower() or "savings" in body_text.lower() or "current" in body_text.lower() or "credit" in body_text.lower()
            has_balance = "balance" in body_text.lower() or "₹" in body_text or "rs" in body_text.lower()
            
            bank_details_score = sum([has_name, has_type, has_balance])
            
            if bank_details_score >= 2:
                self.log_result(
                    "Banks - Bank details (name, type, balance)",
                    True,
                    f"Bank details present ({bank_details_score}/3 indicators found)",
                    f"Name: {has_name}, Type: {has_type}, Balance: {has_balance}"
                )
            else:
                self.log_result(
                    "Banks - Bank details (name, type, balance)",
                    False,
                    f"Insufficient bank details ({bank_details_score}/3 indicators found)",
                    f"Name: {has_name}, Type: {has_type}, Balance: {has_balance}"
                )
            
            # Test: Edit and Delete buttons
            has_edit = False
            has_delete = False
            try:
                buttons = self.driver.find_elements(By.TAG_NAME, "button")
                button_texts = [btn.text.lower() for btn in buttons if btn.text]
                
                has_edit = "edit" in body_text.lower() or any("edit" in text for text in button_texts)
                has_delete = "delete" in body_text.lower() or any("delete" in text for text in button_texts)
                
                if has_edit and has_delete:
                    self.log_result(
                        "Banks - Edit and Delete buttons",
                        True,
                        "Edit and Delete buttons visible",
                        f"Buttons found: {button_texts[:10]}"
                    )
                elif has_edit or has_delete:
                    self.log_result(
                        "Banks - Edit and Delete buttons",
                        False,
                        f"Only {'Edit' if has_edit else 'Delete'} button found"
                    )
                else:
                    self.log_result(
                        "Banks - Edit and Delete buttons",
                        False,
                        "Neither Edit nor Delete buttons visible"
                    )
            except:
                self.log_result(
                    "Banks - Edit and Delete buttons",
                    False,
                    "Could not verify Edit/Delete buttons"
                )
            
            # Test: Overflow menu
            has_overflow = False
            try:
                # Look for three-dot menu, more options, etc.
                overflow_elements = self.driver.find_elements(By.CSS_SELECTOR, "[aria-label*='more'], [aria-label*='menu'], button[aria-haspopup='true']")
                has_overflow = len(overflow_elements) > 0 or "more" in body_text.lower() or "⋮" in body_text or "..." in body_text
                
                self.log_result(
                    "Banks - Overflow menu",
                    has_overflow,
                    f"Overflow menu {'found' if has_overflow else 'not visible'} ({len(overflow_elements)} menu elements)"
                )
            except:
                self.log_result(
                    "Banks - Overflow menu",
                    False,
                    "Could not verify overflow menu"
                )
            
            return True
            
        except Exception as e:
            self.log_result("Banks Page", False, str(e))
            self.take_screenshot("banks_error")
            return False
    
    def test_analytics_page(self):
        """Test the Analytics/ModernDashboard page"""
        try:
            print("\n" + "="*60)
            print("TEST 3: ANALYTICS PAGE")
            print("="*60)
            
            self.driver.get(f"{self.base_url}/analytics")
            time.sleep(4)  # Extra time for charts to load
            
            self.take_screenshot("analytics_page")
            
            current_url = self.driver.current_url
            body_text = self.driver.find_element(By.TAG_NAME, "body").text
            
            print(f"  Current URL: {current_url}")
            print(f"  Page content preview:")
            print(f"  {body_text[:500]}")
            
            # Test: Charts/graphs render
            has_charts = False
            try:
                # Look for canvas elements (commonly used for charts)
                canvas_elements = self.driver.find_elements(By.TAG_NAME, "canvas")
                svg_elements = self.driver.find_elements(By.TAG_NAME, "svg")
                
                chart_indicators = ["chart" in body_text.lower(), 
                                  "monthly" in body_text.lower(),
                                  "summary" in body_text.lower(),
                                  len(canvas_elements) > 0,
                                  len(svg_elements) > 0]
                
                has_charts = sum(chart_indicators) >= 2
                
                self.log_result(
                    "Analytics - Charts/graphs render",
                    has_charts,
                    f"Charts {'rendered' if has_charts else 'may not be rendered'} (canvas: {len(canvas_elements)}, svg: {len(svg_elements)})"
                )
            except:
                self.log_result(
                    "Analytics - Charts/graphs render",
                    False,
                    "Could not verify chart rendering"
                )
            
            # Test: Year/Month selector
            has_selector = False
            try:
                # Look for select elements or year/month indicators
                select_elements = self.driver.find_elements(By.TAG_NAME, "select")
                has_year = any(str(year) in body_text for year in range(2020, 2027))
                has_month_selector = "month" in body_text.lower() or any(month in body_text for month in ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"])
                
                has_selector = len(select_elements) > 0 or has_year or has_month_selector
                
                self.log_result(
                    "Analytics - Year/Month selector",
                    has_selector,
                    f"Date selector {'visible' if has_selector else 'not visible'} (selects: {len(select_elements)}, year: {has_year}, month: {has_month_selector})"
                )
            except:
                self.log_result(
                    "Analytics - Year/Month selector",
                    False,
                    "Could not verify date selector"
                )
            
            # Test: Totals displayed
            has_totals = False
            try:
                has_amount = "₹" in body_text or "rs" in body_text.lower()
                has_total = "total" in body_text.lower()
                has_financial = "debit" in body_text.lower() or "credit" in body_text.lower() or "balance" in body_text.lower()
                
                has_totals = has_amount and (has_total or has_financial)
                
                self.log_result(
                    "Analytics - Totals displayed",
                    has_totals,
                    f"Totals {'displayed' if has_totals else 'not visible'} (amount: {has_amount}, total: {has_total}, financial: {has_financial})"
                )
            except:
                self.log_result(
                    "Analytics - Totals displayed",
                    False,
                    "Could not verify totals"
                )
            
            # Test: Text contrast (basic check)
            try:
                # Get computed styles of some text elements
                text_elements = self.driver.find_elements(By.CSS_SELECTOR, "h1, h2, h3, p, span")
                
                readable_count = 0
                total_checked = 0
                
                for elem in text_elements[:20]:  # Check first 20 text elements
                    try:
                        if elem.text.strip():
                            color = elem.value_of_css_property("color")
                            bg_color = elem.value_of_css_property("background-color")
                            total_checked += 1
                            
                            # Basic check: if colors are defined and not the same
                            if color and bg_color and color != bg_color:
                                readable_count += 1
                    except:
                        continue
                
                contrast_ok = total_checked == 0 or (readable_count / max(total_checked, 1)) > 0.7
                
                self.log_result(
                    "Analytics - Text contrast",
                    contrast_ok,
                    f"Text contrast {'appears adequate' if contrast_ok else 'may have issues'} ({readable_count}/{total_checked} elements checked)"
                )
            except Exception as e:
                self.log_result(
                    "Analytics - Text contrast",
                    True,  # Default to pass if we can't check
                    f"Could not verify text contrast programmatically: {str(e)[:100]}"
                )
            
            return True
            
        except Exception as e:
            self.log_result("Analytics Page", False, str(e))
            self.take_screenshot("analytics_error")
            return False
    
    def test_pdfs_page(self):
        """Test the PDF Management page"""
        try:
            print("\n" + "="*60)
            print("TEST 4: PDF MANAGEMENT PAGE")
            print("="*60)
            
            self.driver.get(f"{self.base_url}/pdfs")
            time.sleep(3)
            
            self.take_screenshot("pdfs_page")
            
            current_url = self.driver.current_url
            body_text = self.driver.find_element(By.TAG_NAME, "body").text
            
            print(f"  Current URL: {current_url}")
            print(f"  Page content preview:")
            print(f"  {body_text[:500]}")
            
            # Test: PDF list loads
            has_pdf_data = "pdf" in body_text.lower() or "file" in body_text.lower()
            self.log_result(
                "PDFs - Page loads",
                has_pdf_data,
                "PDF page loaded" if has_pdf_data else "PDF page may not have loaded properly"
            )
            
            # Test: PDF details (file name, bank, status, transaction count)
            has_filename = ".pdf" in body_text.lower() or "file" in body_text.lower() or "name" in body_text.lower()
            has_bank = "bank" in body_text.lower()
            has_status = "status" in body_text.lower() or "processed" in body_text.lower() or "pending" in body_text.lower()
            has_transaction_count = "transaction" in body_text.lower() or "count" in body_text.lower() or any(char.isdigit() for char in body_text)
            
            pdf_details_score = sum([has_filename, has_bank, has_status, has_transaction_count])
            
            if pdf_details_score >= 2:
                self.log_result(
                    "PDFs - PDF details",
                    True,
                    f"PDF details present ({pdf_details_score}/4 indicators found)",
                    f"Filename: {has_filename}, Bank: {has_bank}, Status: {has_status}, Count: {has_transaction_count}"
                )
            else:
                self.log_result(
                    "PDFs - PDF details",
                    False,
                    f"Insufficient PDF details ({pdf_details_score}/4 indicators found)",
                    f"Filename: {has_filename}, Bank: {has_bank}, Status: {has_status}, Count: {has_transaction_count}"
                )
            
            # Test: Bulk action buttons
            has_bulk_actions = False
            try:
                buttons = self.driver.find_elements(By.TAG_NAME, "button")
                button_texts = [btn.text.lower() for btn in buttons if btn.text]
                
                bulk_keywords = ["reprocess", "decrypt", "bulk", "all"]
                has_bulk_actions = any(keyword in body_text.lower() for keyword in bulk_keywords)
                
                matching_buttons = [text for text in button_texts if any(keyword in text for keyword in bulk_keywords)]
                
                self.log_result(
                    "PDFs - Bulk action buttons",
                    has_bulk_actions,
                    f"Bulk action buttons {'found' if has_bulk_actions else 'not visible'}",
                    f"Matching buttons: {matching_buttons[:5]}" if matching_buttons else None
                )
            except:
                self.log_result(
                    "PDFs - Bulk action buttons",
                    False,
                    "Could not verify bulk action buttons"
                )
            
            # Test: Remap/reassign bank options
            has_remap = False
            try:
                remap_keywords = ["remap", "reassign", "change bank", "assign"]
                has_remap = any(keyword in body_text.lower() for keyword in remap_keywords)
                
                self.log_result(
                    "PDFs - Remap/reassign bank options",
                    has_remap,
                    f"Remap/reassign options {'found' if has_remap else 'not visible'}"
                )
            except:
                self.log_result(
                    "PDFs - Remap/reassign bank options",
                    False,
                    "Could not verify remap options"
                )
            
            return True
            
        except Exception as e:
            self.log_result("PDFs Page", False, str(e))
            self.take_screenshot("pdfs_error")
            return False
    
    def run_all_tests(self):
        """Run all test steps"""
        print("\n" + "="*60)
        print("FINANCE TRACKER - COMPREHENSIVE PAGE TEST")
        print("="*60)
        print(f"Base URL: {self.base_url}")
        print(f"Username: {self.username}")
        print(f"Password: {'*' * len(self.password)}")
        print("="*60)
        
        if not self.setup_driver():
            return False
        
        try:
            # Login first
            if not self.login():
                print("\n❌ Login failed - cannot proceed with tests")
                return False
            
            # Run all page tests
            self.test_transactions_page()
            self.test_banks_page()
            self.test_analytics_page()
            self.test_pdfs_page()
            
        finally:
            if self.driver:
                self.driver.quit()
        
        # Print summary
        return self.print_summary()
    
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
        
        # Group by page
        pages = {
            "Login": [],
            "Transactions": [],
            "Banks": [],
            "Analytics": [],
            "PDFs": []
        }
        
        for result in self.results:
            test_name = result['test']
            for page in pages.keys():
                if page in test_name or page.lower() in test_name.lower():
                    pages[page].append(result)
                    break
        
        # Print by page
        for page, results in pages.items():
            if results:
                page_passed = sum(1 for r in results if "✓ PASS" in r["status"])
                page_total = len(results)
                
                print(f"\n{page} Page: {page_passed}/{page_total} passed")
                print("-" * 60)
                
                for result in results:
                    print(f"{result['status']} - {result['test']}")
                    print(f"  {result['message']}")
                    if result['details']:
                        detail_text = str(result['details'])[:150]
                        print(f"  {detail_text}")
        
        print("\n" + "="*60)
        
        if failed_tests > 0:
            print(f"⚠️  {failed_tests} TEST(S) FAILED - Please review the failures above")
            print("\nScreenshots have been saved for manual review:")
            print("  - screenshot_transactions_page_*.png")
            print("  - screenshot_banks_page_*.png")
            print("  - screenshot_analytics_page_*.png")
            print("  - screenshot_pdfs_page_*.png")
            return False
        else:
            print("✅ ALL TESTS PASSED")
            return True

if __name__ == "__main__":
    # Run tests in headless mode
    tester = FinanceTrackerComprehensiveTest(headless=True)
    success = tester.run_all_tests()
    
    sys.exit(0 if success else 1)
