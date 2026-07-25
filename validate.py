#!/usr/bin/env python3
"""
Validation script for Finance Tracker application
This script validates the application structure, dependencies, and basic functionality
"""

import os
import sys
import importlib.util
from pathlib import Path

# ANSI color codes
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'

def print_success(message):
    print(f"{GREEN}✓{RESET} {message}")

def print_error(message):
    print(f"{RED}✗{RESET} {message}")

def print_warning(message):
    print(f"{YELLOW}⚠{RESET} {message}")

def print_info(message):
    print(f"{BLUE}ℹ{RESET} {message}")

def check_directory_structure():
    """Check if all required directories exist"""
    print_info("Checking directory structure...")
    
    required_dirs = [
        "backend",
        "backend/app",
        "backend/app/api",
        "backend/app/api/endpoints",
        "backend/app/core",
        "backend/app/models",
        "backend/app/schemas",
        "backend/app/services",
        "backend/app/utils",
        "frontend",
        "frontend/src",
        "frontend/src/pages",
        "frontend/public",
    ]
    
    all_exist = True
    for dir_path in required_dirs:
        if os.path.isdir(dir_path):
            print_success(f"Directory exists: {dir_path}")
        else:
            print_error(f"Directory missing: {dir_path}")
            all_exist = False
    
    return all_exist

def check_required_files():
    """Check if all required files exist"""
    print_info("\nChecking required files...")
    
    required_files = [
        "docker-compose.yml",
        ".env.example",
        "README.md",
        "backend/requirements.txt",
        "backend/Dockerfile",
        "backend/app/main.py",
        "backend/app/core/config.py",
        "backend/app/core/database.py",
        "backend/app/core/security.py",
        "backend/app/models/models.py",
        "backend/app/services/gmail_service.py",
        "backend/app/services/pdf_parser.py",
        "backend/app/services/transaction_service.py",
        "backend/app/api/router.py",
        "backend/app/api/endpoints/auth.py",
        "backend/app/api/endpoints/banks.py",
        "backend/app/api/endpoints/transactions.py",
        "backend/app/api/endpoints/labels.py",
        "backend/app/api/endpoints/sync.py",
        "backend/app/api/endpoints/users.py",
        "frontend/package.json",
        "frontend/Dockerfile",
        "frontend/src/App.js",
        "frontend/src/index.js",
    ]
    
    all_exist = True
    for file_path in required_files:
        if os.path.isfile(file_path):
            print_success(f"File exists: {file_path}")
        else:
            print_error(f"File missing: {file_path}")
            all_exist = False
    
    return all_exist

def check_python_syntax():
    """Check Python files for syntax errors"""
    print_info("\nChecking Python syntax...")
    
    python_files = []
    for root, dirs, files in os.walk("backend"):
        for file in files:
            if file.endswith(".py"):
                python_files.append(os.path.join(root, file))
    
    all_valid = True
    for py_file in python_files:
        try:
            with open(py_file, 'r') as f:
                compile(f.read(), py_file, 'exec')
            print_success(f"Valid syntax: {py_file}")
        except SyntaxError as e:
            print_error(f"Syntax error in {py_file}: {e}")
            all_valid = False
    
    return all_valid

def check_imports():
    """Check if main modules can be imported"""
    print_info("\nChecking Python imports...")
    
    # Add backend to path
    backend_path = os.path.abspath("backend")
    if backend_path not in sys.path:
        sys.path.insert(0, backend_path)
    
    modules_to_check = [
        "app.core.config",
        "app.core.database",
        "app.core.security",
        "app.models.models",
    ]
    
    all_importable = True
    for module_name in modules_to_check:
        try:
            spec = importlib.util.find_spec(module_name)
            if spec is not None:
                print_success(f"Module importable: {module_name}")
            else:
                print_error(f"Module not found: {module_name}")
                all_importable = False
        except Exception as e:
            print_error(f"Error importing {module_name}: {e}")
            all_importable = False
    
    return all_importable

def check_docker_files():
    """Check Docker configuration"""
    print_info("\nChecking Docker configuration...")
    
    all_valid = True
    
    # Check docker-compose.yml
    if os.path.isfile("docker-compose.yml"):
        with open("docker-compose.yml", 'r') as f:
            content = f.read()
            required_services = ["db", "redis", "backend", "frontend"]
            for service in required_services:
                if f"{service}:" in content:
                    print_success(f"Service defined: {service}")
                else:
                    print_error(f"Service missing: {service}")
                    all_valid = False
    
    # Check Dockerfiles
    dockerfiles = ["backend/Dockerfile", "frontend/Dockerfile"]
    for dockerfile in dockerfiles:
        if os.path.isfile(dockerfile):
            print_success(f"Dockerfile exists: {dockerfile}")
        else:
            print_error(f"Dockerfile missing: {dockerfile}")
            all_valid = False
    
    return all_valid

def check_env_example():
    """Check .env.example file"""
    print_info("\nChecking environment configuration...")
    
    if not os.path.isfile(".env.example"):
        print_error(".env.example file missing")
        return False
    
    with open(".env.example", 'r') as f:
        content = f.read()
        required_vars = [
            "DATABASE_URL",
            "SECRET_KEY",
            "REDIS_URL",
            "GMAIL_CREDENTIALS_PATH",
        ]
        
        all_found = True
        for var in required_vars:
            if var in content:
                print_success(f"Environment variable defined: {var}")
            else:
                print_error(f"Environment variable missing: {var}")
                all_found = False
        
        return all_found

def check_database_models():
    """Check database models"""
    print_info("\nChecking database models...")
    
    try:
        backend_path = os.path.abspath("backend")
        if backend_path not in sys.path:
            sys.path.insert(0, backend_path)
        
        from app.models import models
        
        required_models = [
            'User', 'Bank', 'Transaction', 'Label', 
            'GmailAccount', 'BankConfig', 'PDFStatement'
        ]
        
        all_found = True
        for model_name in required_models:
            if hasattr(models, model_name):
                print_success(f"Model defined: {model_name}")
            else:
                print_error(f"Model missing: {model_name}")
                all_found = False
        
        return all_found
    except Exception as e:
        print_error(f"Error checking models: {e}")
        return False

def main():
    """Main validation function"""
    print(f"\n{BLUE}{'='*60}{RESET}")
    print(f"{BLUE}Finance Tracker Application Validation{RESET}")
    print(f"{BLUE}{'='*60}{RESET}\n")
    
    results = {
        "Directory Structure": check_directory_structure(),
        "Required Files": check_required_files(),
        "Python Syntax": check_python_syntax(),
        "Docker Configuration": check_docker_files(),
        "Environment Configuration": check_env_example(),
    }
    
    print(f"\n{BLUE}{'='*60}{RESET}")
    print(f"{BLUE}Validation Summary{RESET}")
    print(f"{BLUE}{'='*60}{RESET}\n")
    
    all_passed = True
    for check_name, passed in results.items():
        if passed:
            print_success(f"{check_name}: PASSED")
        else:
            print_error(f"{check_name}: FAILED")
            all_passed = False
    
    print(f"\n{BLUE}{'='*60}{RESET}\n")
    
    if all_passed:
        print_success("All validations passed! ✓")
        print_info("\nNext steps:")
        print("1. Copy .env.example to .env and configure")
        print("2. Set up Gmail API credentials")
        print("3. Run: docker-compose up --build")
        print("4. Access frontend at http://localhost:3000")
        print("5. Access API docs at http://localhost:8000/docs")
        return 0
    else:
        print_error("Some validations failed. Please fix the issues above.")
        return 1

if __name__ == "__main__":
    sys.exit(main())
