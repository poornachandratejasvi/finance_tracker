"""
mock_server.py – Stand-alone FastAPI mock of the Finance Tracker backend.

Usage (outside Docker):
    pip install fastapi uvicorn httpx pytest pytest-asyncio
    python -m pytest backend/tests/mock_server.py -v
                    OR
    uvicorn backend.tests.mock_server:app --port 8001

Purpose:
  • Provides local in-process stubs for Gmail, SMTP, PDF parsing, and DB
    so that unit tests run fully offline.
  • Every endpoint mirrors the real API's request/response shapes so
    frontend, Playwright, and CI tests can run without a live backend.
"""

from __future__ import annotations

import io
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import pytest
from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.testclient import TestClient
from pydantic import BaseModel

# ──────────────────────────────────────────────────────────────────────────────
# In-memory "database"
# ──────────────────────────────────────────────────────────────────────────────

_users: Dict[int, dict] = {
    1: {"id": 1, "username": "admin", "password": "7411470935", "role": "ADMIN",
        "email": "admin@test.com", "full_name": "Admin User", "is_active": True}
}
_banks: Dict[int, dict] = {
    1: {"id": 1, "name": "HDFC Bank", "code": "HDFC", "sender_email": "alerts@hdfcbank.com",
        "account_password": "hdfc123", "has_password": True, "bank_type": "credit",
        "csv_email": "me@example.com", "current_balance": 50000.0, "is_active": True,
        "created_at": "2025-01-01T00:00:00"},
    2: {"id": 2, "name": "SBI", "code": "SBI", "sender_email": "statements@sbicard.com",
        "account_password": "", "has_password": False, "bank_type": "savings",
        "csv_email": "", "current_balance": 25000.0, "is_active": True,
        "created_at": "2025-01-01T00:00:00"},
}
_transactions: Dict[int, dict] = {
    1: {"id": 1, "user_id": 1, "bank_id": 1, "transaction_date": "2025-03-01",
        "description": "Amazon Purchase", "amount": 1500.00, "transaction_type": "debit",
        "category": "Shopping", "is_duplicate": False, "labels": []},
    2: {"id": 2, "user_id": 1, "bank_id": 1, "transaction_date": "2025-03-05",
        "description": "Salary Credit", "amount": 80000.00, "transaction_type": "credit",
        "category": "Income", "is_duplicate": False, "labels": []},
    3: {"id": 3, "user_id": 1, "bank_id": 2, "transaction_date": "2025-03-10",
        "description": "Swiggy Food", "amount": 450.00, "transaction_type": "debit",
        "category": "Food", "is_duplicate": False, "labels": []},
}
_labels: Dict[int, dict] = {
    1: {"id": 1, "name": "Shopping", "color": "#FF5733", "keywords": "amazon,flipkart"},
    2: {"id": 2, "name": "Food", "color": "#28B463", "keywords": "swiggy,zomato"},
}
_pdfs: Dict[int, dict] = {
    1: {"id": 1, "file_name": "hdfc_march_2025.pdf", "bank_id": 1, "bank_name": "HDFC Bank",
        "is_password_protected": True, "is_processed": True, "transaction_count": 2,
        "from_email": "alerts@hdfcbank.com",
        "statement_period_start": "2025-03-01", "statement_period_end": "2025-03-31"},
}
_sync_logs: Dict[int, dict] = {}
_discord_webhook: str = ""
_seq = {"user": 10, "bank": 10, "txn": 10, "label": 10, "pdf": 10, "sync": 10}


def _next(key: str) -> int:
    _seq[key] += 1
    return _seq[key]


# ──────────────────────────────────────────────────────────────────────────────
# Auth helpers
# ──────────────────────────────────────────────────────────────────────────────

_tokens: Dict[str, int] = {}  # token → user_id

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def _create_token(user_id: int) -> str:
    token = f"mock_token_{user_id}_{int(time.time())}"
    _tokens[token] = user_id
    return token


def _current_user(token: str = Depends(oauth2_scheme)) -> dict:
    uid = _tokens.get(token)
    if not uid or uid not in _users:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = _users[uid]
    if not user["is_active"]:
        raise HTTPException(status_code=403, detail="Inactive user")
    return user


# ──────────────────────────────────────────────────────────────────────────────
# FastAPI mock app
# ──────────────────────────────────────────────────────────────────────────────

app = FastAPI(title="Finance Tracker Mock Server", version="test")


# ── Auth ──────────────────────────────────────────────────────────────────────

@app.post("/api/auth/login")
def login(form: OAuth2PasswordRequestForm = Depends()):
    for user in _users.values():
        if user["username"] == form.username and user["password"] == form.password:
            return {"access_token": _create_token(user["id"]), "token_type": "bearer"}
    raise HTTPException(status_code=401, detail="Invalid credentials")


@app.get("/api/users/me")
def me(user=Depends(_current_user)):
    return {k: v for k, v in user.items() if k != "password"}


# ── Banks ─────────────────────────────────────────────────────────────────────

@app.get("/api/banks/")
def list_banks(user=Depends(_current_user)):
    return list(_banks.values())


@app.post("/api/banks/", status_code=201)
def create_bank(data: dict, user=Depends(_current_user)):
    bid = _next("bank")
    bank = {
        "id": bid,
        "name": data.get("name", ""),
        "code": data.get("code", ""),
        "sender_email": data.get("sender_email", ""),
        "account_password": data.get("account_password", ""),
        "has_password": bool(data.get("account_password", "")),
        "bank_type": data.get("bank_type", "savings"),
        "csv_email": data.get("csv_email", ""),
        "current_balance": data.get("current_balance"),
        "is_active": True,
        "created_at": datetime.utcnow().isoformat(),
    }
    _banks[bid] = bank
    return bank


@app.put("/api/banks/{bank_id}")
def update_bank(bank_id: int, data: dict, user=Depends(_current_user)):
    if bank_id not in _banks:
        raise HTTPException(404, "Bank not found")
    bank = _banks[bank_id]
    # Never clear password if blank
    if "account_password" in data and not (data.get("account_password") or "").strip():
        data.pop("account_password", None)
    bank.update(data)
    bank["has_password"] = bool(bank.get("account_password"))
    return bank


@app.delete("/api/banks/{bank_id}", status_code=204)
def delete_bank(bank_id: int, user=Depends(_current_user)):
    _banks.pop(bank_id, None)


@app.get("/api/banks/{bank_id}/account-password")
def get_bank_password(bank_id: int, user=Depends(_current_user)):
    bank = _banks.get(bank_id)
    if not bank:
        raise HTTPException(404, "Bank not found")
    return {"bank_id": bank_id, "has_password": bank.get("has_password", False),
            "password": bank.get("account_password", "")}


@app.get("/api/banks/{bank_id}/password-candidates")
def get_password_candidates(bank_id: int, user=Depends(_current_user)):
    bank = _banks.get(bank_id)
    if not bank:
        raise HTTPException(404)
    candidates = [bank["account_password"]] if bank.get("account_password") else []
    return {"bank_id": bank_id, "bank_name": bank["name"], "candidates": candidates}


@app.get("/api/banks/gmail-accounts/")
def list_gmail_accounts(user=Depends(_current_user)):
    return [{"id": 1, "email": "test@gmail.com", "is_active": True,
             "last_synced": "2025-03-30T10:00:00", "created_at": "2025-01-01T00:00:00"}]


@app.get("/api/banks/gmail-accounts/status")
def gmail_status(user=Depends(_current_user)):
    return [{"id": 1, "email": "test@gmail.com", "status": "connected",
             "last_synced": "2025-03-30T10:00:00"}]


# ── Transactions ──────────────────────────────────────────────────────────────

@app.get("/api/transactions/")
def list_transactions(skip: int = 0, limit: int = 10, bank_id: Optional[int] = None,
                      user=Depends(_current_user)):
    items = list(_transactions.values())
    if bank_id:
        items = [t for t in items if t["bank_id"] == bank_id]
    total = len(items)
    return {"items": items[skip: skip + limit], "total": total, "skip": skip, "limit": limit}


@app.post("/api/transactions/", status_code=201)
def create_transaction(data: dict, user=Depends(_current_user)):
    tid = _next("txn")
    txn = {"id": tid, "user_id": user["id"], **data, "is_duplicate": False, "labels": []}
    _transactions[tid] = txn
    return txn


@app.put("/api/transactions/{txn_id}")
def update_transaction(txn_id: int, data: dict, user=Depends(_current_user)):
    if txn_id not in _transactions:
        raise HTTPException(404)
    _transactions[txn_id].update(data)
    return _transactions[txn_id]


@app.delete("/api/transactions/{txn_id}", status_code=204)
def delete_transaction(txn_id: int, user=Depends(_current_user)):
    _transactions.pop(txn_id, None)


@app.get("/api/transactions/duplicates/find")
def find_duplicates(user=Depends(_current_user)):
    return {"duplicate_groups": [], "total_duplicates": 0}


# ── Labels ────────────────────────────────────────────────────────────────────

@app.get("/api/labels/")
def list_labels(user=Depends(_current_user)):
    return list(_labels.values())


@app.post("/api/labels/", status_code=201)
def create_label(data: dict, user=Depends(_current_user)):
    lid = _next("label")
    label = {"id": lid, **data}
    _labels[lid] = label
    return label


@app.delete("/api/labels/{label_id}", status_code=204)
def delete_label(label_id: int, user=Depends(_current_user)):
    _labels.pop(label_id, None)


# ── PDFs ──────────────────────────────────────────────────────────────────────

@app.get("/api/pdfs/")
def list_pdfs(skip: int = 0, limit: int = 25, bank_id: Optional[int] = None,
              from_email: Optional[str] = None, user=Depends(_current_user)):
    items = list(_pdfs.values())
    if bank_id:
        items = [p for p in items if p["bank_id"] == bank_id]
    if from_email:
        items = [p for p in items if from_email.lower() in (p.get("from_email") or "").lower()]
    total = len(items)
    return {"items": items[skip: skip + limit], "total": total}


@app.get("/api/pdfs/stats")
def pdf_stats(user=Depends(_current_user)):
    total = len(_pdfs)
    processed = sum(1 for p in _pdfs.values() if p["is_processed"])
    protected = sum(1 for p in _pdfs.values() if p["is_password_protected"])
    return {"total": total, "processed": processed, "password_protected": protected,
            "total_transactions": sum(p.get("transaction_count", 0) for p in _pdfs.values())}


@app.post("/api/pdfs/{pdf_id}/reprocess")
def reprocess_pdf(pdf_id: int, user=Depends(_current_user)):
    pdf = _pdfs.get(pdf_id)
    if not pdf:
        raise HTTPException(404)
    pdf["is_processed"] = True
    return {"success": True, "pdf_id": pdf_id, "transactions_added": pdf.get("transaction_count", 0)}


@app.post("/api/pdfs/reprocess-all")
def reprocess_all(user=Depends(_current_user)):
    for pdf in _pdfs.values():
        pdf["is_processed"] = True
    return {"success": True, "processed": len(_pdfs)}


@app.post("/api/pdfs/delete-by-sender")
def delete_by_sender(data: dict, user=Depends(_current_user)):
    from_email = data.get("from_email", "")
    to_delete = [k for k, v in _pdfs.items() if
                 from_email.lower() in (v.get("from_email") or "").lower()]
    for k in to_delete:
        del _pdfs[k]
    return {"deleted": len(to_delete), "from_email": from_email}


# ── CSV Exports ───────────────────────────────────────────────────────────────

@app.post("/api/csv/pdfs/{pdf_id}/generate")
def generate_csv(pdf_id: int, user=Depends(_current_user)):
    return {"success": True, "pdf_id": pdf_id, "csv_path": f"/tmp/mock_{pdf_id}.csv",
            "row_count": _pdfs.get(pdf_id, {}).get("transaction_count", 0)}


@app.post("/api/csv/banks/{bank_id}/email-latest")
def email_bank_csv(bank_id: int, data: dict, user=Depends(_current_user)):
    bank = _banks.get(bank_id)
    if not bank:
        raise HTTPException(404)
    to_email = data.get("to_email") or bank.get("csv_email")
    if not to_email:
        raise HTTPException(400, "Recipient email is required")
    return {"success": True, "sent_to": to_email, "bank": bank["name"]}


@app.post("/api/csv/pdfs/generate-all")
def generate_all_csv(bank_id: Optional[int] = None, user=Depends(_current_user)):
    count = sum(1 for p in _pdfs.values() if not bank_id or p["bank_id"] == bank_id)
    return {"generated": count, "bank_id": bank_id}


# ── Sync ──────────────────────────────────────────────────────────────────────

@app.post("/api/sync/", status_code=202)
def start_sync(data: dict, user=Depends(_current_user)):
    sid = _next("sync")
    log = {"id": sid, "status": "success", "emails_processed": 1,
           "transactions_added": 2, "duplicates_found": 0,
           "started_at": datetime.utcnow().isoformat(),
           "completed_at": datetime.utcnow().isoformat()}
    _sync_logs[sid] = log
    return {"sync_log_id": sid, "status": "accepted", "message": "Sync started"}


@app.get("/api/sync/status/{sync_log_id}")
def sync_status(sync_log_id: int, user=Depends(_current_user)):
    log = _sync_logs.get(sync_log_id)
    if not log:
        return {"id": sync_log_id, "status": "success", "emails_processed": 0,
                "transactions_added": 0}
    return log


# ── Dashboard ────────────────────────────────────────────────────────────────

@app.get("/api/dashboard/summary")
def dashboard_summary(user=Depends(_current_user)):
    txns = list(_transactions.values())
    total_credit = sum(t["amount"] for t in txns if t["transaction_type"] == "credit")
    total_debit = sum(t["amount"] for t in txns if t["transaction_type"] == "debit")
    return {
        "total_banks": len(_banks),
        "total_transactions": len(txns),
        "total_credit": total_credit,
        "total_debit": total_debit,
        "net_balance": total_credit - total_debit,
    }


@app.get("/api/dashboard/latest-month")
def latest_month(user=Depends(_current_user)):
    txns = list(_transactions.values())
    total_credit = sum(t["amount"] for t in txns if t["transaction_type"] == "credit")
    total_debit = sum(t["amount"] for t in txns if t["transaction_type"] == "debit")
    return {
        "month": "2025-03",
        "month_label": "March 2025",
        "total_credit": total_credit,
        "total_debit": total_debit,
        "net": total_credit - total_debit,
        "transaction_count": len(txns),
        "showing": "Showing March 2025 (latest data)",
    }


@app.get("/api/dashboard/monthly-summary")
def monthly_summary(year: int = 2025, user=Depends(_current_user)):
    return {"year": year, "months": [
        {"month": 3, "month_label": "March", "total_credit": 80000, "total_debit": 1950, "net": 78050}
    ]}


@app.get("/api/dashboard/monthly-bank-summary")
def monthly_bank_summary(year: int = 2025, user=Depends(_current_user)):
    return {"year": year, "banks": [b["name"] for b in _banks.values()], "data": []}


# ── Settings / Discord ────────────────────────────────────────────────────────

@app.get("/api/settings/discord-webhook")
def get_webhook(user=Depends(_current_user)):
    return {"webhook_url": _discord_webhook}


@app.post("/api/settings/discord-webhook")
def save_webhook(data: dict, user=Depends(_current_user)):
    global _discord_webhook
    _discord_webhook = data.get("webhook_url", "")
    return {"success": True, "webhook_url": _discord_webhook}


@app.post("/api/settings/discord-webhook/test")
def send_discord_test(user=Depends(_current_user)):
    if not _discord_webhook:
        raise HTTPException(400, "No webhook URL configured")
    # In mock mode we just return success without actually calling Discord
    return {"success": True, "message": "Test notification sent (mock)"}


# ── Analytics ────────────────────────────────────────────────────────────────

@app.get("/api/dashboard/daily-bank-summary")
def daily_bank_summary(year: int = 2025, month: int = 3, user=Depends(_current_user)):
    return {"year": year, "month": month, "days": []}


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "mock": True}

@app.get("/")
def root():
    return {"message": "Finance Tracker Mock Server"}


# ──────────────────────────────────────────────────────────────────────────────
# pytest tests that use the mock server via TestClient
# ──────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def client():
    return TestClient(app)


@pytest.fixture(scope="module")
def auth_headers(client):
    resp = client.post("/api/auth/login", data={"username": "admin", "password": "7411470935"})
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# ── Auth tests ────────────────────────────────────────────────────────────────

class TestAuth:
    def test_login_success(self, client):
        r = client.post("/api/auth/login", data={"username": "admin", "password": "7411470935"})
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_login_wrong_password(self, client):
        r = client.post("/api/auth/login", data={"username": "admin", "password": "wrong"})
        assert r.status_code == 401

    def test_me_authenticated(self, client, auth_headers):
        r = client.get("/api/users/me", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["username"] == "admin"

    def test_me_unauthenticated(self, client):
        r = client.get("/api/users/me")
        assert r.status_code == 401


# ── Banks tests ───────────────────────────────────────────────────────────────

class TestBanks:
    def test_list_banks(self, client, auth_headers):
        r = client.get("/api/banks/", headers=auth_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        assert len(r.json()) >= 2

    def test_create_bank(self, client, auth_headers):
        r = client.post("/api/banks/", json={
            "name": "Test Bank", "code": "TEST", "sender_email": "test@bank.com",
            "account_password": "secret123"
        }, headers=auth_headers)
        assert r.status_code == 201
        data = r.json()
        assert data["name"] == "Test Bank"
        assert data["has_password"] is True

    def test_update_bank_does_not_clear_password(self, client, auth_headers):
        # Create bank with password
        r = client.post("/api/banks/", json={
            "name": "PwdBank", "code": "PWD", "sender_email": "pwd@bank.com",
            "account_password": "mypassword"
        }, headers=auth_headers)
        bank_id = r.json()["id"]

        # Update bank name but send blank password (simulates frontend behaviour)
        r2 = client.put(f"/api/banks/{bank_id}", json={"name": "PwdBank Updated", "account_password": ""},
                        headers=auth_headers)
        assert r2.status_code == 200
        data = r2.json()
        # Password must NOT be cleared
        assert data["has_password"] is True
        assert data["account_password"] == "mypassword"  # mock returns it (real API masks it)

    def test_view_bank_password(self, client, auth_headers):
        r = client.get("/api/banks/1/account-password", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert "has_password" in data
        assert "password" in data

    def test_delete_bank(self, client, auth_headers):
        r = client.post("/api/banks/", json={
            "name": "Del Bank", "code": "DEL", "sender_email": "del@bank.com"
        }, headers=auth_headers)
        bid = r.json()["id"]
        r2 = client.delete(f"/api/banks/{bid}", headers=auth_headers)
        assert r2.status_code == 204


# ── Transactions tests ────────────────────────────────────────────────────────

class TestTransactions:
    def test_list_transactions(self, client, auth_headers):
        r = client.get("/api/transactions/", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert "total" in data

    def test_create_transaction(self, client, auth_headers):
        r = client.post("/api/transactions/", json={
            "bank_id": 1, "transaction_date": "2025-03-15",
            "description": "Test Purchase", "amount": 999.0,
            "transaction_type": "debit", "category": "Shopping"
        }, headers=auth_headers)
        assert r.status_code == 201
        assert r.json()["description"] == "Test Purchase"

    def test_update_transaction(self, client, auth_headers):
        r = client.put("/api/transactions/1", json={"description": "Updated Desc"},
                       headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["description"] == "Updated Desc"

    def test_delete_transaction(self, client, auth_headers):
        r = client.delete("/api/transactions/3", headers=auth_headers)
        assert r.status_code == 204


# ── Labels tests ──────────────────────────────────────────────────────────────

class TestLabels:
    def test_list_labels(self, client, auth_headers):
        r = client.get("/api/labels/", headers=auth_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_label(self, client, auth_headers):
        r = client.post("/api/labels/", json={
            "name": "Travel", "color": "#3498DB", "keywords": "airlines,hotel"
        }, headers=auth_headers)
        assert r.status_code == 201
        assert r.json()["name"] == "Travel"

    def test_delete_label(self, client, auth_headers):
        r = client.delete("/api/labels/1", headers=auth_headers)
        assert r.status_code == 204


# ── PDFs tests ────────────────────────────────────────────────────────────────

class TestPDFs:
    def test_list_pdfs(self, client, auth_headers):
        r = client.get("/api/pdfs/", headers=auth_headers)
        assert r.status_code == 200
        assert "items" in r.json()

    def test_pdf_stats(self, client, auth_headers):
        r = client.get("/api/pdfs/stats", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert "total" in data and "processed" in data

    def test_reprocess_pdf(self, client, auth_headers):
        r = client.post("/api/pdfs/1/reprocess", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["success"] is True

    def test_pdf_from_email_filter(self, client, auth_headers):
        r = client.get("/api/pdfs/?from_email=alerts@hdfcbank.com", headers=auth_headers)
        assert r.status_code == 200

    def test_delete_by_sender(self, client, auth_headers):
        r = client.post("/api/pdfs/delete-by-sender",
                        json={"from_email": "nobody@example.com"},
                        headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["deleted"] == 0  # nothing matched


# ── CSV tests ─────────────────────────────────────────────────────────────────

class TestCSV:
    def test_generate_csv(self, client, auth_headers):
        r = client.post("/api/csv/pdfs/1/generate", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["success"] is True

    def test_email_csv_no_email(self, client, auth_headers):
        # SBI has no csv_email and we send no to_email → should 400
        r = client.post("/api/csv/banks/2/email-latest",
                        json={"to_email": None}, headers=auth_headers)
        assert r.status_code == 400

    def test_email_csv_with_email(self, client, auth_headers):
        r = client.post("/api/csv/banks/1/email-latest",
                        json={"to_email": "dest@example.com"}, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["success"] is True

    def test_generate_all_csv(self, client, auth_headers):
        r = client.post("/api/csv/pdfs/generate-all?bank_id=1", headers=auth_headers)
        assert r.status_code == 200


# ── Sync tests ────────────────────────────────────────────────────────────────

class TestSync:
    def test_start_sync(self, client, auth_headers):
        r = client.post("/api/sync/", json={"sync_type": "manual"}, headers=auth_headers)
        assert r.status_code == 202
        data = r.json()
        assert "sync_log_id" in data

    def test_sync_status(self, client, auth_headers):
        r = client.post("/api/sync/", json={"sync_type": "manual"}, headers=auth_headers)
        sid = r.json()["sync_log_id"]
        r2 = client.get(f"/api/sync/status/{sid}", headers=auth_headers)
        assert r2.status_code == 200
        assert r2.json()["status"] in ("success", "processing", "failed")


# ── Dashboard tests ───────────────────────────────────────────────────────────

class TestDashboard:
    def test_summary(self, client, auth_headers):
        r = client.get("/api/dashboard/summary", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert "total_transactions" in data
        assert "total_credit" in data

    def test_latest_month(self, client, auth_headers):
        r = client.get("/api/dashboard/latest-month", headers=auth_headers)
        assert r.status_code == 200
        assert "month_label" in r.json()


# ── Discord tests ─────────────────────────────────────────────────────────────

class TestDiscord:
    def test_get_webhook_initially_empty(self, client, auth_headers):
        r = client.get("/api/settings/discord-webhook", headers=auth_headers)
        assert r.status_code == 200

    def test_save_and_test_webhook(self, client, auth_headers):
        r = client.post("/api/settings/discord-webhook",
                        json={"webhook_url": "https://discord.com/api/webhooks/test/mock"},
                        headers=auth_headers)
        assert r.status_code == 200

        r2 = client.post("/api/settings/discord-webhook/test", headers=auth_headers)
        assert r2.status_code == 200
        assert r2.json()["success"] is True

    def test_test_webhook_no_url(self, client, auth_headers):
        # Reset webhook to empty
        client.post("/api/settings/discord-webhook", json={"webhook_url": ""},
                    headers=auth_headers)
        r = client.post("/api/settings/discord-webhook/test", headers=auth_headers)
        assert r.status_code == 400


# ── Health test ───────────────────────────────────────────────────────────────

class TestHealth:
    def test_health(self, client):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


# ──────────────────────────────────────────────────────────────────────────────
# Entrypoint — run server standalone for Playwright / manual testing
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
