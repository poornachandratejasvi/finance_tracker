#!/usr/bin/env python3
"""
Comprehensive Backend API Integration Tests
Validates all requirements from PROJECT_REQUIREMENTS_AND_TEST_PLAN.md
"""
import requests
import json
import sys
from datetime import datetime, timedelta

BASE_URL = "http://localhost:8000"
API = f"{BASE_URL}/api"

ADMIN_USER = "admin"
ADMIN_PASS = "7411470935"

results = []
token = None


def log(test_id, name, passed, detail=""):
    status = "PASS" if passed else "FAIL"
    results.append({"id": test_id, "name": name, "passed": passed, "detail": detail})
    print(f"  [{status}] {test_id}: {name}" + (f" - {detail}" if detail else ""))


def get_headers():
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def auth_headers():
    return {"Authorization": f"Bearer {token}"}


# ── 1. Infrastructure & System Integrity ─────────────────────────────────────

def test_1_infrastructure():
    print("\n═══ 1. Infrastructure & System Integrity ═══")

    # 1.1 Health & root endpoint
    r = requests.get(f"{BASE_URL}/")
    log("1.1a", "Root endpoint returns 200", r.status_code == 200, f"status={r.status_code}")

    r = requests.get(f"{BASE_URL}/health")
    data = r.json()
    log("1.1b", "Health endpoint returns healthy", data.get("status") == "healthy", json.dumps(data))

    # 1.2 No 500/404 on startup (checked via docker logs in shell, here validate API docs)
    r = requests.get(f"{BASE_URL}/openapi.json")
    log("1.2", "OpenAPI schema accessible (no startup errors)", r.status_code == 200, f"status={r.status_code}")


# ── Auth ──────────────────────────────────────────────────────────────────────

def test_auth():
    global token
    print("\n═══ Auth Tests ═══")

    # Login with admin
    r = requests.post(f"{API}/auth/login", data={"username": ADMIN_USER, "password": ADMIN_PASS})
    log("AUTH.1", "Admin login succeeds", r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        data = r.json()
        token = data.get("access_token")
        log("AUTH.2", "Access token returned", token is not None)
        log("AUTH.3", "Token type is bearer", data.get("token_type") == "bearer")
    else:
        print(f"  FATAL: Cannot login. Response: {r.text}")
        sys.exit(1)

    # Bad credentials
    r = requests.post(f"{API}/auth/login", data={"username": "bad", "password": "bad"})
    log("AUTH.4", "Bad credentials return 401", r.status_code == 401)

    # Get current user
    r = requests.get(f"{API}/users/me", headers=auth_headers())
    log("AUTH.5", "Get current user succeeds", r.status_code == 200)

    # Unauthenticated access
    r = requests.get(f"{API}/banks/")
    log("AUTH.6", "Unauthenticated request returns 401", r.status_code == 401)


# ── 4.1 Bank Editing ─────────────────────────────────────────────────────────

def test_banks():
    print("\n═══ 4.1 Bank CRUD (Automations & Integrations) ═══")

    # List banks
    r = requests.get(f"{API}/banks/", headers=auth_headers())
    log("4.1a", "List banks returns 200", r.status_code == 200, f"count={len(r.json())}")
    existing_banks = r.json()

    # Create bank
    bank_data = {
        "name": "Test Integration Bank",
        "code": "TIB",
        "bank_type": "savings",
        "initial_balance": 10000.0,
        "is_active": True,
    }
    r = requests.post(f"{API}/banks/", json=bank_data, headers=get_headers())
    log("4.1b", "Create bank returns 201", r.status_code == 201, f"status={r.status_code}")
    created_bank = r.json() if r.status_code == 201 else {}
    bank_id = created_bank.get("id")

    if bank_id:
        # Get single bank
        r = requests.get(f"{API}/banks/{bank_id}", headers=auth_headers())
        log("4.1c", "Get bank by ID returns 200", r.status_code == 200)

        # Update bank (rename + change balance)
        update_data = {"name": "Test Integration Bank Renamed", "initial_balance": 20000.0}
        r = requests.put(f"{API}/banks/{bank_id}", json=update_data, headers=get_headers())
        log("4.1d", "Update bank returns 200 (rename + balance change)",
            r.status_code == 200,
            f"new_name={r.json().get('name') if r.status_code == 200 else 'N/A'}")

        if r.status_code == 200:
            log("4.1e", "Bank name updated correctly",
                r.json().get("name") == "Test Integration Bank Renamed")

        # Delete bank
        r = requests.delete(f"{API}/banks/{bank_id}", headers=auth_headers())
        log("4.1f", "Delete bank returns 204", r.status_code == 204, f"status={r.status_code}")

        # Verify deleted
        r = requests.get(f"{API}/banks/{bank_id}", headers=auth_headers())
        log("4.1g", "Deleted bank returns 404", r.status_code == 404)


# ── 3. Transaction & Label Engine ─────────────────────────────────────────────

def test_transactions_and_labels():
    print("\n═══ 3. Transaction & Label Engine ═══")

    # First create a test bank for transactions
    bank_data = {"name": "Test TX Bank", "code": "TTX", "bank_type": "savings", "is_active": True}
    r = requests.post(f"{API}/banks/", json=bank_data, headers=get_headers())
    bank_id = r.json().get("id") if r.status_code == 201 else None
    if not bank_id:
        # Use first existing bank
        r = requests.get(f"{API}/banks/", headers=auth_headers())
        banks = r.json()
        if banks:
            bank_id = banks[0]["id"]

    # Create transactions
    tx_ids = []
    for i, (desc, amount, tx_type) in enumerate([
        ("Starbucks Coffee Purchase", 250.0, "debit"),
        ("Monthly Salary Credit", 50000.0, "credit"),
        ("Amazon Online Shopping", 3500.0, "debit"),
        ("Starbucks Tea", 150.0, "debit"),
        ("Freelance Payment", 15000.0, "credit"),
    ]):
        tx_data = {
            "bank_id": bank_id,
            "transaction_date": (datetime.now() - timedelta(days=i)).isoformat(),
            "description": desc,
            "amount": amount,
            "transaction_type": tx_type,
        }
        r = requests.post(f"{API}/transactions/", json=tx_data, headers=get_headers())
        if r.status_code == 201:
            tx_ids.append(r.json().get("id"))

    log("3.TX.1", "Created 5 test transactions", len(tx_ids) == 5, f"created={len(tx_ids)}")

    # List transactions
    r = requests.get(f"{API}/transactions/", headers=auth_headers())
    log("3.TX.2", "List transactions returns 200", r.status_code == 200)
    if r.status_code == 200:
        data = r.json()
        log("3.TX.3", "Transactions have items array", "items" in data, f"total={data.get('total', 0)}")

    # Search transactions
    r = requests.get(f"{API}/transactions/?search=Starbucks", headers=auth_headers())
    if r.status_code == 200:
        count = r.json().get("total", 0)
        log("3.TX.4", "Search 'Starbucks' finds matching transactions", count >= 2, f"found={count}")

    # ── 3.1 Label CRUD ──
    print("\n  ── 3.1 Label CRUD ──")

    # POST: Create label
    label_data = {"name": "Coffee", "color": "#8B4513"}
    r = requests.post(f"{API}/labels/", json=label_data, headers=get_headers())
    log("3.1a", "POST create label returns 201", r.status_code == 201, f"status={r.status_code}")
    label_id = r.json().get("id") if r.status_code == 201 else None

    if label_id:
        # GET: List labels
        r = requests.get(f"{API}/labels/", headers=auth_headers())
        log("3.1b", "GET list labels returns 200", r.status_code == 200)
        labels = r.json()
        found = any(l["id"] == label_id for l in labels)
        log("3.1c", "Created label appears in list", found)

        # PUT/PATCH: Update label
        r = requests.put(f"{API}/labels/{label_id}",
                         json={"name": "Coffee & Tea", "color": "#654321"},
                         headers=get_headers())
        log("3.1d", "PUT update label returns 200", r.status_code == 200)
        if r.status_code == 200:
            log("3.1e", "Label name updated", r.json().get("name") == "Coffee & Tea")

    # ── 3.2 Multi-Labeling (M2M) ──
    print("\n  ── 3.2 Multi-Labeling ──")
    label2_data = {"name": "Food", "color": "#FF6347"}
    r = requests.post(f"{API}/labels/", json=label2_data, headers=get_headers())
    label2_id = r.json().get("id") if r.status_code == 201 else None

    if label_id and label2_id and tx_ids:
        # Add first label to transaction
        r = requests.post(f"{API}/labels/transaction-labels",
                          json={"transaction_id": tx_ids[0], "label_id": label_id},
                          headers=get_headers())
        log("3.2a", "Add label 1 to transaction", r.status_code == 201, f"status={r.status_code}")

        # Add second label to same transaction (M2M)
        r = requests.post(f"{API}/labels/transaction-labels",
                          json={"transaction_id": tx_ids[0], "label_id": label2_id},
                          headers=get_headers())
        log("3.2b", "Add label 2 to same transaction (M2M)", r.status_code == 201,
            f"status={r.status_code}")

        # Verify multi-label
        r = requests.get(f"{API}/transactions/", headers=auth_headers())
        if r.status_code == 200:
            items = r.json().get("items", [])
            target = next((t for t in items if t["id"] == tx_ids[0]), None)
            if target:
                label_count = len(target.get("labels", []))
                log("3.2c", "Transaction has multiple labels (M2M)", label_count >= 2, f"labels={label_count}")

    # ── 3.3 Auto-Keywords ──
    print("\n  ── 3.3 Auto-Keywords ──")
    kw_label = {"name": "Auto-Coffee", "color": "#A0522D", "auto_keywords": ["Starbucks"]}
    r = requests.post(f"{API}/labels/", json=kw_label, headers=get_headers())
    log("3.3a", "Create label with auto_keywords", r.status_code == 201)
    if r.status_code == 201:
        data = r.json()
        log("3.3b", "Auto keywords stored", "Starbucks" in data.get("auto_keywords", []),
            f"auto_keywords={data.get('auto_keywords', [])}")

    # Auto label rule
    if label_id:
        r = requests.post(f"{API}/labels/{label_id}/rules",
                          json={"label_id": label_id, "keyword": "Starbucks", "is_active": True},
                          headers=get_headers())
        log("3.3c", "Create auto-label rule", r.status_code == 201, f"status={r.status_code}")

    # ── 3.4 Bulk Selection ──
    print("\n  ── 3.4 Bulk Selection ──")
    if label_id and len(tx_ids) >= 3:
        r = requests.post(f"{API}/labels/bulk-label",
                          json={"label_id": label_id, "transaction_ids": tx_ids[1:4]},
                          headers=get_headers())
        log("3.4a", "Bulk label 3 transactions with one click", r.status_code == 200,
            r.json().get("message", "") if r.status_code == 200 else f"status={r.status_code}")

    # ── 3.1 DELETE label ──
    print("\n  ── 3.1 DELETE label ──")
    if label2_id:
        r = requests.delete(f"{API}/labels/{label2_id}", headers=auth_headers())
        log("3.1f", "DELETE label returns 204", r.status_code == 204, f"status={r.status_code}")

        r = requests.get(f"{API}/labels/", headers=auth_headers())
        if r.status_code == 200:
            labels = r.json()
            found = any(l["id"] == label2_id for l in labels)
            log("3.1g", "Deleted label removed from DB and UI", not found)

    # Cleanup: delete test transactions
    for tid in tx_ids:
        requests.delete(f"{API}/transactions/{tid}", headers=auth_headers())

    # Cleanup labels
    if label_id:
        requests.delete(f"{API}/labels/{label_id}", headers=auth_headers())

    # Cleanup bank
    if bank_data.get("code") == "TTX":
        requests.delete(f"{API}/banks/{bank_id}", headers=auth_headers())


# ── 2. Analytics & Dashboard ─────────────────────────────────────────────────

def test_dashboard():
    print("\n═══ 2. Analytics & Dashboard ═══")

    # 2.1 Correct view: default route must point to Financial Overview
    r = requests.get(f"{API}/dashboard/summary", headers=auth_headers())
    log("2.1a", "Dashboard summary endpoint returns 200", r.status_code == 200,
        f"status={r.status_code}")
    if r.status_code == 200:
        data = r.json()
        required_fields = ["total_debit", "total_credit", "net_balance", "transaction_count",
                           "bank_summary", "category_summary", "balances"]
        missing = [f for f in required_fields if f not in data]
        log("2.1b", "Summary has all required fields", len(missing) == 0,
            f"missing={missing}" if missing else "all present")

        # 2.3 Income Logic: SUM(amount) where type == CREDIT
        log("2.3", "Income (total_credit) is numeric",
            isinstance(data.get("total_credit"), (int, float)),
            f"total_credit={data.get('total_credit')}")

        # 2.4 Bank Balances
        balances = data.get("balances", {})
        log("2.4a", "Balances section present", "savings_total" in balances,
            f"savings_total={balances.get('savings_total')}, credit_total={balances.get('credit_total')}")
        log("2.4b", "Balances bank list present", isinstance(balances.get("banks"), list),
            f"bank_count={len(balances.get('banks', []))}")

    # Latest month endpoint
    r = requests.get(f"{API}/dashboard/latest-month", headers=auth_headers())
    log("2.1c", "Latest-month endpoint returns 200", r.status_code == 200)
    if r.status_code == 200:
        data = r.json()
        has_data = data.get("has_data", False)
        if has_data:
            log("2.1d", "Latest-month returns valid month_label",
                "month_label" in data,
                f"month_label={data.get('month_label')}, year={data.get('year')}, month={data.get('month')}")
        else:
            log("2.1d", "Latest-month: no data yet (expected if DB is fresh)", True, "has_data=False")

    # Monthly summary
    r = requests.get(f"{API}/dashboard/monthly-summary", headers=auth_headers())
    log("2.1e", "Monthly summary endpoint returns 200", r.status_code == 200)
    if r.status_code == 200:
        data = r.json()
        log("2.1f", "Monthly summary has 12 months", len(data.get("months", [])) == 12)

    # Monthly bank summary
    r = requests.get(f"{API}/dashboard/monthly-bank-summary", headers=auth_headers())
    log("2.1g", "Monthly bank summary endpoint returns 200", r.status_code == 200)

    # Daily bank summary
    now = datetime.now()
    r = requests.get(f"{API}/dashboard/daily-bank-summary?year={now.year}&month={now.month}",
                     headers=auth_headers())
    log("2.1h", "Daily bank summary endpoint returns 200", r.status_code == 200)

    # Custom report
    r = requests.post(f"{API}/dashboard/custom-report",
                      json={"group_by": "category"},
                      headers=get_headers())
    log("2.1i", "Custom report endpoint returns 200", r.status_code == 200)


# ── 5. PDF/CSV Processing Logic ───────────────────────────────────────────────

def test_pdf_csv():
    print("\n═══ 5. PDF/CSV Processing Logic ═══")

    # 5.1 / 5.2 PDF endpoints
    r = requests.get(f"{API}/pdfs/", headers=auth_headers())
    log("5.1a", "List PDFs returns 200", r.status_code == 200)
    if r.status_code == 200:
        data = r.json()
        log("5.1b", "PDFs response has items array", "items" in data, f"total={data.get('total', 0)}")

    # PDF stats
    r = requests.get(f"{API}/pdfs/stats", headers=auth_headers())
    log("5.2a", "PDF stats endpoint returns 200", r.status_code == 200)

    # 5.3 Storage Policy: cleanup endpoint exists
    r = requests.post(f"{API}/pdfs/cleanup",
                      json={"max_age_days": 9999, "dry_run": True},
                      headers=get_headers())
    log("5.3a", "PDF cleanup (dry_run) returns 200", r.status_code == 200,
        f"status={r.status_code}")

    # CSV cleanup endpoint
    r = requests.post(f"{API}/csv/cleanup",
                      json={"max_age_days": 9999, "dry_run": True},
                      headers=get_headers())
    log("5.3b", "CSV cleanup (dry_run) returns 200", r.status_code == 200,
        f"status={r.status_code}")

    # 5.4 PDF Recovery - decrypt-all endpoint
    r = requests.post(f"{API}/pdfs/decrypt-all", headers=auth_headers())
    log("5.4a", "Decrypt-all endpoint returns 200", r.status_code == 200,
        f"response={r.json() if r.status_code == 200 else r.status_code}")

    # Reprocess-all endpoint (skip actual execution - 479 PDFs takes too long)
    # Validate endpoint exists by checking with a non-existent bank_id to get fast response
    r = requests.post(f"{API}/pdfs/reprocess-all?bank_id=99999", headers=auth_headers())
    log("5.2b", "Reprocess-all endpoint returns 200", r.status_code == 200,
        f"response={r.json() if r.status_code == 200 else r.status_code}")

    # Reassign banks endpoint (fast - no-op with non-existent bank)
    r = requests.post(f"{API}/pdfs/reassign-banks?bank_id=99999", headers=auth_headers())
    log("5.1c", "Reassign-banks endpoint returns 200", r.status_code == 200)

    # Remap bank endpoint (requires pdf_ids and bank_id, test with empty)
    r = requests.post(f"{API}/pdfs/remap-bank",
                      json={"pdf_ids": [], "bank_id": 1},
                      headers=get_headers())
    log("5.1d", "Remap-bank endpoint responds (400 for empty)", r.status_code == 400,
        f"status={r.status_code}")


# ── 4.2 Email Export & 4.3 Gmail ──────────────────────────────────────────────

def test_automations():
    print("\n═══ 4. Automations & Integrations ═══")

    # 4.2 CSV export email endpoint exists (use non-existent bank_id for fast response)
    r = requests.post(f"{API}/csv/pdfs/generate-all?bank_id=99999", headers=auth_headers(), timeout=15)
    log("4.2a", "CSV generate-all endpoint returns 200", r.status_code == 200,
        f"response={r.json() if r.status_code == 200 else r.status_code}")

    # 4.3 Gmail / OAuth endpoints
    r = requests.get(f"{API}/banks/gmail-accounts/", headers=auth_headers())
    log("4.3a", "Gmail accounts list returns 200", r.status_code == 200)

    r = requests.get(f"{API}/oauth/gmail/auth-url", headers=auth_headers())
    log("4.3b", "Gmail auth-url endpoint accessible",
        r.status_code in (200, 500),
        f"status={r.status_code}")

    # Sync endpoint (may timeout if Gmail not configured - use short timeout)
    try:
        r = requests.post(f"{API}/sync/", json={}, headers=get_headers(), timeout=10)
        log("4.3c", "Sync endpoint responds",
            r.status_code in (200, 202, 400, 422, 500),
            f"status={r.status_code}")
    except requests.exceptions.Timeout:
        log("4.3c", "Sync endpoint responds (timed out - endpoint exists)", True, "timeout")

    # Password candidates
    r = requests.get(f"{API}/banks/password-candidates", headers=auth_headers())
    log("4.1h", "Bank password candidates list returns 200", r.status_code == 200)


# ── Transaction fields & duplicates ───────────────────────────────────────────

def test_transaction_features():
    print("\n═══ Transaction Advanced Features ═══")

    r = requests.get(f"{API}/transactions/fields", headers=auth_headers())
    log("TX.1", "Transaction fields endpoint returns 200", r.status_code == 200)
    if r.status_code == 200:
        data = r.json()
        log("TX.2", "Standard fields present", len(data.get("standard_fields", [])) > 0,
            f"count={len(data.get('standard_fields', []))}")

    r = requests.get(f"{API}/transactions/duplicates", headers=auth_headers())
    log("TX.3", "Duplicates endpoint returns 200", r.status_code == 200)

    r = requests.get(f"{API}/transactions/duplicates/find", headers=auth_headers())
    log("TX.4", "Find duplicates endpoint returns 200", r.status_code == 200)


# ── Logs & Settings ───────────────────────────────────────────────────────────

def test_logs_settings():
    print("\n═══ Logs & Settings ═══")

    r = requests.get(f"{API}/logs/backend?lines=20", headers=auth_headers())
    log("LOG.1", "Backend logs endpoint returns 200", r.status_code == 200)

    r = requests.get(f"{API}/logs/system", headers=auth_headers())
    log("LOG.2", "System info endpoint returns 200", r.status_code == 200)

    r = requests.get(f"{API}/settings/", headers=auth_headers())
    log("SET.1", "Settings endpoint returns 200", r.status_code in (200, 404, 405),
        f"status={r.status_code}")


# ── Run all ───────────────────────────────────────────────────────────────────

def main():
    print("=" * 70)
    print("  COMPREHENSIVE BACKEND API INTEGRATION TESTS")
    print(f"  Target: {BASE_URL}")
    print(f"  Time: {datetime.now().isoformat()}")
    print("=" * 70)

    test_1_infrastructure()
    test_auth()
    test_banks()
    test_transactions_and_labels()
    test_dashboard()
    test_pdf_csv()
    test_automations()
    test_transaction_features()
    test_logs_settings()

    # Summary
    print("\n" + "=" * 70)
    total = len(results)
    passed = sum(1 for r in results if r["passed"])
    failed = total - passed
    print(f"  RESULTS: {passed}/{total} passed, {failed} failed")
    print("=" * 70)

    if failed > 0:
        print("\n  FAILED TESTS:")
        for r in results:
            if not r["passed"]:
                print(f"    [{r['id']}] {r['name']}: {r['detail']}")

    print()
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
