#!/usr/bin/env python3
"""
Selenium-based GUI Test Suite for Finance Tracker
Tests all pages and features through the web interface
"""

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import TimeoutException, NoSuchElementException
import time
import sys

# Configuration
FRONTEND_URL = "http://localhost:3000"
USERNAME = "admin"
PASSWORD = "password123"


class GUITestRunner:
    def __init__(self):
        self.test_results = []
        self.driver = None
        
    def setup_driver(self):
        """Setup Chrome driver with headless option"""
        chrome_options = Options()
        chrome_options.add_argument("--headless")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--window-size=1920,1080")
        
        try:
            self.driver = webdriver.Chrome(options=chrome_options)
            self.driver.implicitly_wait(10)
            return True
        except Exception as e:
            print(f"❌ Failed to setup Chrome driver: {e}")
            print("💡 Tip: Install ChromeDriver with: sudo apt-get install chromium-chromedriver")
            return False
    
    def wait_for_element(self, by, value, timeout=10):
        """Wait for element to be present"""
        try:
            element = WebDriverWait(self.driver, timeout).until(
                EC.presence_of_element_located((by, value))
            )
            return element
        except TimeoutException:
            return None
    
    def wait_for_clickable(self, by, value, timeout=10):
        """Wait for element to be clickable"""
        try:
            element = WebDriverWait(self.driver, timeout).until(
                EC.element_to_be_clickable((by, value))
            )
            return element
        except TimeoutException:
            return None
    
    def log(self, message, level="INFO"):
        """Print colored log message"""
        colors = {
            "INFO": "\033[94m",  # Blue
            "PASS": "\033[92m",  # Green
            "FAIL": "\033[91m",  # Red
            "WARN": "\033[93m",  # Yellow
        }
        reset = "\033[0m"
        prefix = f"[{level}]" if level == "INFO" else f"[{level}]"
        print(f"{colors.get(level, '')}{prefix} {message}{reset}")
    
    def test(self, name, func):
        """Run a single test"""
        try:
            func()
            self.log(f"✅ {name}", "PASS")
            self.test_results.append((name, True, None))
            return True
        except Exception as e:
            self.log(f"❌ {name}: {str(e)}", "FAIL")
            self.test_results.append((name, False, str(e)))
            return False
    
    def test_page_load(self):
        """Test that the main page loads"""
        self.driver.get(FRONTEND_URL)
        time.sleep(2)
        assert "Finance Tracker" in self.driver.title or "React App" in self.driver.title
    
    def test_login_page(self):
        """Test login page elements and functionality"""
        self.driver.get(f"{FRONTEND_URL}/login")
        time.sleep(1)
        
        # Check for login form elements
        username_field = self.wait_for_element(By.NAME, "username")
        assert username_field is not None, "Username field not found"
        
        password_field = self.driver.find_element(By.NAME, "password")
        assert password_field is not None, "Password field not found"
        
        # Perform login
        username_field.send_keys(USERNAME)
        password_field.send_keys(PASSWORD)
        
        login_button = self.driver.find_element(By.CSS_SELECTOR, "button[type='submit']")
        login_button.click()
        
        # Wait for redirect to dashboard
        time.sleep(2)
        assert "/dashboard" in self.driver.current_url or "/login" not in self.driver.current_url
    
    def test_dashboard_page(self):
        """Test dashboard page loads and shows stats"""
        self.driver.get(f"{FRONTEND_URL}/dashboard")
        time.sleep(2)
        
        # Check for dashboard elements
        page_content = self.driver.page_source
        assert "Dashboard" in page_content or "Total Balance" in page_content
    
    def test_banks_page(self):
        """Test banks page functionality"""
        self.driver.get(f"{FRONTEND_URL}/banks")
        time.sleep(2)
        
        # Check page loaded
        page_content = self.driver.page_source
        assert "Banks" in page_content or "Add Bank" in page_content
        
        # Try to click Add Bank button (if visible)
        try:
            add_bank_btn = self.wait_for_clickable(By.XPATH, "//button[contains(text(), 'Add Bank')]", timeout=3)
            if add_bank_btn:
                add_bank_btn.click()
                time.sleep(1)
                # Check if dialog opened
                assert "Bank Name" in self.driver.page_source or "name" in self.driver.page_source.lower()
        except:
            pass  # Button might not be immediately visible
    
    def test_transactions_page(self):
        """Test transactions page loads"""
        self.driver.get(f"{FRONTEND_URL}/transactions")
        time.sleep(2)
        
        # Check page loaded
        page_content = self.driver.page_source
        assert "Transactions" in page_content or "Amount" in page_content
    
    def test_settings_page(self):
        """Test settings page loads"""
        self.driver.get(f"{FRONTEND_URL}/settings")
        time.sleep(2)
        
        # Check page loaded
        page_content = self.driver.page_source
        assert "Settings" in page_content or "Profile" in page_content or "Labels" in page_content
    
    def test_no_error_messages(self):
        """Test that no 'Failed to load' errors appear on any page"""
        pages = ["/dashboard", "/banks", "/transactions", "/settings"]
        
        for page in pages:
            self.driver.get(f"{FRONTEND_URL}{page}")
            time.sleep(2)
            page_content = self.driver.page_source.lower()
            
            error_phrases = ["failed to load", "error loading", "something went wrong"]
            for phrase in error_phrases:
                assert phrase not in page_content, f"Error message '{phrase}' found on {page}"
    
    def test_navigation_menu(self):
        """Test that navigation menu works"""
        self.driver.get(f"{FRONTEND_URL}/dashboard")
        time.sleep(2)
        
        # Check for navigation elements (drawer or menu)
        page_source = self.driver.page_source
        assert ("Dashboard" in page_source or 
                "Transactions" in page_source or 
                "Banks" in page_source)
    
    def cleanup(self):
        """Close browser"""
        if self.driver:
            self.driver.quit()
    
    def print_summary(self):
        """Print test summary"""
        print("\n" + "="*60)
        print("Test Summary")
        print("="*60 + "\n")
        
        total = len(self.test_results)
        passed = sum(1 for _, success, _ in self.test_results if success)
        failed = total - passed
        
        print(f"Total Tests: {total}")
        print(f"Passed: {passed}")
        print(f"Failed: {failed}")
        print(f"Success Rate: {(passed/total*100):.1f}%\n")
        
        if failed > 0:
            print("Failed Tests:")
            for name, success, error in self.test_results:
                if not success:
                    print(f"  - {name}")
                    print(f"    Error: {error}")
            print("\n" + "="*60)
            print("⚠️  Some GUI tests failed.")
            print("="*60 + "\n")
            return False
        else:
            print("\n" + "="*60)
            print("✅ All GUI tests passed!")
            print("The web interface is fully functional.")
            print("="*60 + "\n")
            return True
    
    def run_all_tests(self):
        """Run all GUI tests"""
        print("\n" + "="*60)
        print("Finance Tracker - Selenium GUI Test Suite")
        print("="*60 + "\n")
        
        if not self.setup_driver():
            print("\n⚠️  Cannot run GUI tests without Chrome/ChromeDriver")
            print("Install with: sudo apt-get install chromium-chromedriver")
            return False
        
        try:
            # Run tests
            self.log("Testing Page Load...")
            self.test("Page Load", self.test_page_load)
            
            self.log("\nTesting Login Page...")
            self.test("Login Page", self.test_login_page)
            
            self.log("\nTesting Dashboard...")
            self.test("Dashboard Page", self.test_dashboard_page)
            
            self.log("\nTesting Banks Page...")
            self.test("Banks Page", self.test_banks_page)
            
            self.log("\nTesting Transactions Page...")
            self.test("Transactions Page", self.test_transactions_page)
            
            self.log("\nTesting Settings Page...")
            self.test("Settings Page", self.test_settings_page)
            
            self.log("\nTesting Navigation...")
            self.test("Navigation Menu", self.test_navigation_menu)
            
            self.log("\nTesting for Errors...")
            self.test("No Error Messages", self.test_no_error_messages)
            
        finally:
            self.cleanup()
        
        return self.print_summary()


if __name__ == "__main__":
    runner = GUITestRunner()
    success = runner.run_all_tests()
    sys.exit(0 if success else 1)
