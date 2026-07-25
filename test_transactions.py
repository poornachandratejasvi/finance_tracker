#!/usr/bin/env python3
"""Test script for transaction features"""

import requests
import json
from datetime import datetime

API_URL = "http://localhost:8000"

# Login
print("1. Logging in...")
login_response = requests.post(
    f"{API_URL}/api/auth/login",
    data={"username": "admin", "password": "admin123"},
    headers={"Content-Type": "application/x-www-form-urlencoded"}
)

if login_response.status_code != 200:
    print(f"Login failed: {login_response.text}")
    exit(1)

token = login_response.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

print("✓ Login successful\n")

# Get transactions
print("2. Fetching transactions...")
trans_response = requests.get(
    f"{API_URL}/api/transactions?skip=0&limit=5",
    headers=headers
)

if trans_response.status_code == 200:
    data = trans_response.json()
    print(f"✓ Found {data['total']} transactions")
    if data['items']:
        first_trans = data['items'][0]
        print(f"  First transaction: {first_trans['description']}")
        print(f"  Date: {first_trans['transaction_date']}")
        print(f"  Bank: {first_trans.get('bank_name', 'Unknown')}")
        print(f"  Notes field exists: {'notes' in first_trans}")
        print(f"  Is manual: {first_trans.get('is_manual', False)}")
else:
    print(f"✗ Failed to fetch transactions: {trans_response.status_code}")
    print(trans_response.text)

print()

# Get banks
print("3. Fetching banks...")
banks_response = requests.get(f"{API_URL}/api/banks/", headers=headers)
if banks_response.status_code == 200:
    banks = banks_response.json()
    print(f"✓ Found {len(banks)} banks")
    if banks:
        bank_id = banks[0]['id']
        bank_name = banks[0]['name']
        print(f"  Using bank: {bank_name} (ID: {bank_id})")
    else:
        print("  No banks found, cannot test manual transaction creation")
        exit(1)
else:
    print(f"✗ Failed to fetch banks: {banks_response.status_code}")
    exit(1)

print()

# Create manual transaction
print("4. Creating manual transaction...")
new_trans = {
    "bank_id": bank_id,
    "transaction_date": datetime.now().isoformat(),
    "description": "Test Manual Transaction",
    "amount": 100.50,
    "transaction_type": "debit",
    "category": "Testing",
    "notes": "This is a test comment"
}

create_response = requests.post(
    f"{API_URL}/api/transactions/",
    headers={**headers, "Content-Type": "application/json"},
    json=new_trans
)

if create_response.status_code == 201:
    created_trans = create_response.json()
    trans_id = created_trans['id']
    print(f"✓ Created transaction ID: {trans_id}")
    print(f"  Description: {created_trans['description']}")
    print(f"  Notes: {created_trans.get('notes', 'N/A')}")
    print(f"  Is manual: {created_trans.get('is_manual', False)}")
else:
    print(f"✗ Failed to create transaction: {create_response.status_code}")
    print(create_response.text)
    exit(1)

print()

# Update transaction
print("5. Updating transaction...")
update_data = {
    "notes": "Updated comment - transaction verified",
    "category": "Test Updated"
}

update_response = requests.put(
    f"{API_URL}/api/transactions/{trans_id}",
    headers={**headers, "Content-Type": "application/json"},
    json=update_data
)

if update_response.status_code == 200:
    updated_trans = update_response.json()
    print(f"✓ Updated transaction")
    print(f"  Notes: {updated_trans.get('notes', 'N/A')}")
    print(f"  Category: {updated_trans.get('category', 'N/A')}")
else:
    print(f"✗ Failed to update transaction: {update_response.status_code}")
    print(update_response.text)

print()

# Delete transaction
print("6. Deleting test transaction...")
delete_response = requests.delete(
    f"{API_URL}/api/transactions/{trans_id}",
    headers=headers
)

if delete_response.status_code == 204:
    print(f"✓ Deleted transaction ID: {trans_id}")
else:
    print(f"✗ Failed to delete transaction: {delete_response.status_code}")
    print(delete_response.text)

print()
print("=" * 50)
print("All tests completed!")
print("=" * 50)
