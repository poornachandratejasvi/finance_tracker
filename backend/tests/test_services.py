"""
test_services.py – Unit tests for core service functions.

Run with:
    cd /home/tejasvim/personal_files/cred_transaction
    source .venv/bin/activate
    python -m pytest backend/tests/test_services.py -v
"""

from __future__ import annotations

import json
from datetime import datetime, date
from typing import Optional
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# ── In-memory SQLite engine for all DB-backed tests ──────────────────────────
from app.core.database import Base
from app.models.models import (
    Bank, BankConfig, Transaction, TransactionType, User, UserRole
)

TEST_ENGINE = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=TEST_ENGINE)

_user_counter = 0


def _make_session():
    Base.metadata.create_all(bind=TEST_ENGINE)
    return TestSessionLocal()


def _make_user(db) -> User:
    global _user_counter
    _user_counter += 1
    user = User(
        username=f"testuser_{_user_counter}",
        email=f"test{_user_counter}@example.com",
        hashed_password="fakehash",
        role=UserRole.ADMIN,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_bank(db, user_id: int, **kwargs) -> Bank:
    bank = Bank(
        user_id=user_id,
        name=kwargs.get("name", "Test Bank"),
        code=kwargs.get("code", "TEST"),
        bank_type=kwargs.get("bank_type", "savings"),
        account_password=kwargs.get("account_password", None),
    )
    db.add(bank)
    db.commit()
    db.refresh(bank)
    return bank


# ═════════════════════════════════════════════════════════════════════════════
# password_service tests
# ═════════════════════════════════════════════════════════════════════════════
from app.services.password_service import (
    _unique_passwords,
    get_password_candidates,
    parse_with_passwords,
    save_password_candidates,
)


class TestUniquePasswords:
    def test_removes_duplicates(self):
        result = _unique_passwords(["abc", "abc", "def"])
        assert result == ["abc", "def"]

    def test_strips_whitespace(self):
        result = _unique_passwords(["  abc  ", "abc"])
        assert result == ["abc"]

    def test_removes_empty_strings(self):
        result = _unique_passwords(["", "  ", "real"])
        assert result == ["real"]

    def test_preserves_order(self):
        result = _unique_passwords(["z", "a", "m"])
        assert result == ["z", "a", "m"]

    def test_handles_none_entries(self):
        result = _unique_passwords([None, "good"])
        assert result == ["good"]

    def test_empty_list(self):
        assert _unique_passwords([]) == []


class TestGetPasswordCandidates:
    def test_returns_account_password_first(self):
        db = _make_session()
        user = _make_user(db)
        bank = _make_bank(db, user.id, account_password="mainpwd")
        result = get_password_candidates(db, bank)
        assert result[0] == "mainpwd"
        db.close()

    def test_includes_candidates_from_config(self):
        db = _make_session()
        user = _make_user(db)
        bank = _make_bank(db, user.id, account_password="main")
        config = BankConfig(
            bank_id=bank.id,
            email_pattern="*",
            subject_pattern="",
            password_hints=json.dumps({"candidates": ["extra1", "extra2"]}),
        )
        db.add(config)
        db.commit()
        result = get_password_candidates(db, bank)
        assert result == ["main", "extra1", "extra2"]
        db.close()

    def test_deduplicates_between_main_and_candidates(self):
        db = _make_session()
        user = _make_user(db)
        bank = _make_bank(db, user.id, account_password="same")
        config = BankConfig(
            bank_id=bank.id,
            email_pattern="*",
            subject_pattern="",
            password_hints=json.dumps({"candidates": ["same", "other"]}),
        )
        db.add(config)
        db.commit()
        result = get_password_candidates(db, bank)
        assert result.count("same") == 1
        assert "other" in result
        db.close()

    def test_no_password_returns_empty(self):
        db = _make_session()
        user = _make_user(db)
        bank = _make_bank(db, user.id)
        result = get_password_candidates(db, bank)
        assert result == []
        db.close()

    def test_invalid_json_in_config_is_ignored(self):
        db = _make_session()
        user = _make_user(db)
        bank = _make_bank(db, user.id, account_password="pwd")
        config = BankConfig(
            bank_id=bank.id,
            email_pattern="*",
            subject_pattern="",
            password_hints="NOT_VALID_JSON",
        )
        db.add(config)
        db.commit()
        result = get_password_candidates(db, bank)
        assert result == ["pwd"]
        db.close()


class TestSavePasswordCandidates:
    def test_saves_and_deduplicates(self):
        db = _make_session()
        user = _make_user(db)
        bank = _make_bank(db, user.id)
        saved = save_password_candidates(db, bank, ["abc", "abc", "def"])
        assert saved == ["abc", "def"]
        db.close()

    def test_creates_config_if_missing(self):
        db = _make_session()
        user = _make_user(db)
        bank = _make_bank(db, user.id)
        save_password_candidates(db, bank, ["p1"])
        config = db.query(BankConfig).filter(BankConfig.bank_id == bank.id).first()
        assert config is not None
        data = json.loads(config.password_hints)
        assert data["candidates"] == ["p1"]
        db.close()


class TestParseWithPasswords:
    def test_returns_first_successful_parse(self):
        mock_result = {"success": True, "transactions": []}
        with patch("app.services.password_service.PDFParser.parse_statement", return_value=mock_result):
            result, used = parse_with_passwords("fake.pdf", "HDFC", ["wrongpwd", "rightpwd"])
        assert result["success"] is True
        assert used == "wrongpwd"  # first tried password succeeds

    def test_tries_next_password_on_failure(self):
        call_count = {"n": 0}
        def fake_parse(pdf_path, bank_code, password, field_mapping):
            call_count["n"] += 1
            if password == "correct":
                return {"success": True, "transactions": []}
            return {"success": False, "error": "wrong password"}

        with patch("app.services.password_service.PDFParser.parse_statement", side_effect=fake_parse):
            result, used = parse_with_passwords("fake.pdf", "HDFC", ["wrong1", "correct"])
        assert result["success"] is True
        assert used == "correct"
        assert call_count["n"] == 2

    def test_returns_last_failure_if_all_fail(self):
        fail = {"success": False, "error": "bad"}
        with patch("app.services.password_service.PDFParser.parse_statement", return_value=fail):
            result, used = parse_with_passwords("fake.pdf", "X", ["a", "b"])
        assert result["success"] is False
        assert used is None

    def test_no_passwords_tries_none(self):
        mock_result = {"success": True, "transactions": []}
        with patch("app.services.password_service.PDFParser.parse_statement", return_value=mock_result) as mock:
            result, used = parse_with_passwords("fake.pdf", "X", [])
        mock.assert_called_once_with(pdf_path="fake.pdf", bank_code="X", password=None, field_mapping=None)
        assert result["success"] is True


# ═════════════════════════════════════════════════════════════════════════════
# balance_service tests
# ═════════════════════════════════════════════════════════════════════════════
from app.services.balance_service import apply_statement_balance


class TestApplyStatementBalance:
    def _bank(self):
        b = MagicMock()
        b.current_balance = None
        b.balance_updated_at = None
        return b

    def test_sets_ending_balance(self):
        bank = self._bank()
        result = apply_statement_balance(bank, {"ending_balance": 12345.67})
        assert result is True
        assert bank.current_balance == 12345.67

    def test_falls_back_to_last_transaction_balance(self):
        bank = self._bank()
        pr = {
            "transactions": [
                {"balance": 1000.0},
                {"balance": 2500.0},
                {"balance": 3100.0},
            ]
        }
        result = apply_statement_balance(bank, pr)
        assert result is True
        assert bank.current_balance == 3100.0

    def test_returns_false_when_no_balance(self):
        bank = self._bank()
        result = apply_statement_balance(bank, {"transactions": [{"description": "tx"}]})
        assert result is False
        assert bank.current_balance is None

    def test_sets_balance_updated_at_from_period_end(self):
        bank = self._bank()
        end = datetime(2025, 3, 31)
        apply_statement_balance(bank, {"ending_balance": 500.0, "statement_period": {"end": end}})
        assert bank.balance_updated_at == end

    def test_fallback_date_used_when_no_period(self):
        bank = self._bank()
        fallback = datetime(2025, 1, 1)
        apply_statement_balance(bank, {"ending_balance": 100.0}, fallback_date=fallback)
        assert bank.balance_updated_at == fallback

    def test_ending_balance_zero_is_valid(self):
        bank = self._bank()
        result = apply_statement_balance(bank, {"ending_balance": 0.0})
        assert result is True
        assert bank.current_balance == 0.0

    def test_ending_balance_takes_priority_over_transactions(self):
        bank = self._bank()
        pr = {
            "ending_balance": 999.0,
            "transactions": [{"balance": 111.0}],
        }
        apply_statement_balance(bank, pr)
        assert bank.current_balance == 999.0


# ═════════════════════════════════════════════════════════════════════════════
# transaction_service tests
# ═════════════════════════════════════════════════════════════════════════════
from app.services.transaction_service import TransactionService


class TestCategorizeTransaction:
    def test_food_category(self):
        assert TransactionService.categorize_transaction("Swiggy food order") == "Food & Dining"

    def test_shopping_category(self):
        assert TransactionService.categorize_transaction("Amazon shopping order") == "Shopping"

    def test_transportation_category(self):
        assert TransactionService.categorize_transaction("Uber ride payment") == "Transportation"

    def test_bills_category(self):
        assert TransactionService.categorize_transaction("Electricity bill payment") == "Bills & Utilities"

    def test_entertainment_category(self):
        assert TransactionService.categorize_transaction("Netflix subscription") == "Entertainment"

    def test_healthcare_category(self):
        assert TransactionService.categorize_transaction("Apollo hospital payment") == "Healthcare"

    def test_transfer_category(self):
        assert TransactionService.categorize_transaction("UPI transfer to John") == "Transfer"

    def test_atm_category(self):
        assert TransactionService.categorize_transaction("ATM withdrawal") == "ATM Withdrawal"

    def test_unknown_returns_others(self):
        assert TransactionService.categorize_transaction("some random payment xyz") == "Others"

    def test_case_insensitive(self):
        assert TransactionService.categorize_transaction("ZOMATO ORDER") == "Food & Dining"

    def test_empty_string_returns_others(self):
        assert TransactionService.categorize_transaction("") == "Others"


class TestGenerateTransactionHash:
    def test_same_inputs_produce_same_hash(self):
        t = {"transaction_date": date(2025, 3, 1), "amount": 100.0, "description": "Test"}
        h1 = TransactionService.generate_transaction_hash(t)
        h2 = TransactionService.generate_transaction_hash(t)
        assert h1 == h2

    def test_different_amounts_produce_different_hashes(self):
        t1 = {"transaction_date": date(2025, 3, 1), "amount": 100.0, "description": "Test"}
        t2 = {"transaction_date": date(2025, 3, 1), "amount": 200.0, "description": "Test"}
        assert TransactionService.generate_transaction_hash(t1) != TransactionService.generate_transaction_hash(t2)

    def test_case_insensitive_description(self):
        t1 = {"transaction_date": date(2025, 3, 1), "amount": 100.0, "description": "TEST"}
        t2 = {"transaction_date": date(2025, 3, 1), "amount": 100.0, "description": "test"}
        assert TransactionService.generate_transaction_hash(t1) == TransactionService.generate_transaction_hash(t2)

    def test_datetime_is_converted_to_date(self):
        t1 = {"transaction_date": datetime(2025, 3, 1, 12, 30), "amount": 50.0, "description": "hi"}
        t2 = {"transaction_date": date(2025, 3, 1), "amount": 50.0, "description": "hi"}
        assert TransactionService.generate_transaction_hash(t1) == TransactionService.generate_transaction_hash(t2)


class TestFindAndMarkDuplicates:
    def _setup(self):
        db = _make_session()
        user = _make_user(db)
        bank = _make_bank(db, user.id)
        return db, user, bank

    def _add_transaction(self, db, user_id, bank_id, txdate, amount, description):
        tx = Transaction(
            user_id=user_id,
            bank_id=bank_id,
            transaction_date=txdate,
            amount=amount,
            description=description,
            transaction_type=TransactionType.DEBIT,
        )
        db.add(tx)
        db.commit()
        db.refresh(tx)
        return tx

    def test_finds_exact_duplicate(self):
        db, user, bank = self._setup()
        dt = datetime(2025, 3, 10)
        tx1 = self._add_transaction(db, user.id, bank.id, dt, 500.0, "Amazon")
        tx2 = self._add_transaction(db, user.id, bank.id, dt, 500.0, "Amazon")

        trans_dicts = [{"transaction_date": dt, "amount": 500.0, "description": "Amazon"}]
        groups = TransactionService.find_duplicates(db, user.id, trans_dicts)
        assert len(groups) == 1
        ids = list(groups.values())[0]
        assert tx1.id in ids
        assert tx2.id in ids
        db.close()

    def test_no_duplicates_for_unique_transactions(self):
        db, user, bank = self._setup()
        self._add_transaction(db, user.id, bank.id, datetime(2025, 3, 1), 100.0, "Uber")
        trans_dicts = [{"transaction_date": datetime(2025, 3, 2), "amount": 200.0, "description": "Pizza"}]
        groups = TransactionService.find_duplicates(db, user.id, trans_dicts)
        assert len(groups) == 0
        db.close()

    def test_mark_duplicates_updates_flag(self):
        db, user, bank = self._setup()
        dt = datetime(2025, 3, 15)
        tx1 = self._add_transaction(db, user.id, bank.id, dt, 300.0, "Swiggy")
        tx2 = self._add_transaction(db, user.id, bank.id, dt, 300.0, "Swiggy")

        groups = TransactionService.find_duplicates(
            db, user.id,
            [{"transaction_date": dt, "amount": 300.0, "description": "Swiggy"}]
        )
        count = TransactionService.mark_duplicates(db, groups)
        assert count == 2

        db.expire_all()
        assert db.get(Transaction, tx1.id).is_duplicate is True
        assert db.get(Transaction, tx2.id).is_duplicate is True
        db.close()

    def test_mark_duplicates_skips_single_matches(self):
        """A group with only one transaction should NOT be marked as duplicate."""
        db, user, bank = self._setup()
        dt = datetime(2025, 4, 1)
        self._add_transaction(db, user.id, bank.id, dt, 50.0, "coffee")

        trans_dicts = [{"transaction_date": dt, "amount": 50.0, "description": "coffee"}]
        groups = TransactionService.find_duplicates(db, user.id, trans_dicts)
        count = TransactionService.mark_duplicates(db, groups)
        assert count == 0
        db.close()


# ═════════════════════════════════════════════════════════════════════════════
# dashboard._parse_csv_list tests (utility kept in dashboard.py)
# ═════════════════════════════════════════════════════════════════════════════
# ═════════════════════════════════════════════════════════════════════════════
# _parse_csv_list tests (copied here to avoid importing the full FastAPI app)
# The function lives in app.api.endpoints.dashboard but is a pure utility.
# ═════════════════════════════════════════════════════════════════════════════

def _parse_csv_list(value, cast=str):
    """Local copy of dashboard._parse_csv_list for isolated unit testing."""
    if value is None:
        return []
    if isinstance(value, list):
        items = value
    else:
        items = [v.strip() for v in str(value).split(',') if v.strip()]
    parsed = []
    for item in items:
        try:
            parsed.append(cast(item))
        except Exception:
            continue
    return parsed


class TestParseCsvList:
    def test_parses_comma_separated_string(self):
        assert _parse_csv_list("1,2,3", int) == [1, 2, 3]

    def test_handles_list_input(self):
        assert _parse_csv_list([1, 2, 3], int) == [1, 2, 3]

    def test_returns_empty_for_none(self):
        assert _parse_csv_list(None) == []

    def test_skips_invalid_casts(self):
        result = _parse_csv_list("1,bad,3", int)
        assert result == [1, 3]

    def test_trims_whitespace(self):
        assert _parse_csv_list(" 1 , 2 , 3 ", int) == [1, 2, 3]

    def test_string_cast_default(self):
        assert _parse_csv_list("a,b,c") == ["a", "b", "c"]

    def test_empty_string_returns_empty(self):
        assert _parse_csv_list("") == []


# ═════════════════════════════════════════════════════════════════════════════
# shipment_email_service tests
# ═════════════════════════════════════════════════════════════════════════════
from app.services.shipment_email_service import parse_shipment_email


# Fixtures below mirror the REAL structure of Amazon.in shipment emails
# (verified against actual inbox samples -- see shipment_email_service.py's
# module docstring), with item names genericized. Amazon never exposes a
# raw carrier tracking number in these emails -- only an order id and a
# link to its own progress-tracker page -- so tracking_number is always None.
_AMAZON_SHIPPED_BODY = (
    "Your Orders\nYour Account\nBuy Again\n"
    "Your package was shipped!\nOrdered\nShipped\nOut for delivery\nDelivered\n\n\n"
    "Arriving tomorrow\n\nPoorna – Mysore, KARNATAKA\nOrder #\n403-4826656-9069124\n\n"
    "Track package\nhttps://www.amazon.in/progress-tracker/package?orderId=403-4826656-9069124&packageIndex=0\n"
    "* Plastic Storage Box With Partitions (Pack of 2)\n  Quantity: 1\n  669 INR\n\nTotal\n658.77 INR\n"
)
_AMAZON_ORDERED_MULTI_BODY = (
    "Thanks for your order!\nOrdered\nShipped\nOut for delivery\nDelivered\n\n\n"
    "Arriving tomorrow 8 am – 12 pm\n\nPoorna – Mysore, KARNATAKA\nOrder #\n403-5851435-0121927\n\n"
    "View or edit order\nhttps://www.amazon.in/your-orders/order-details?orderID=403-5851435-0121927\n"
    "* Craft Storage Organizer With Dividers\n  Quantity: 1\n  399 INR\n\nTotal\n400.85 INR\n\n\n"
    "Arriving Saturday\n\nPoorna – Mysore, KARNATAKA\nOrder #\n403-9586913-9674705\n\n"
    "View or edit order\nhttps://www.amazon.in/your-orders/order-details?orderID=403-9586913-9674705\n"
    "* Rubber Bands Pack, Elastic Ponytail Accessories\n  Quantity: 1\n  199 INR\n\nTotal\n199.15 INR\n"
)
_AMAZON_DELIVERED_BODY = (
    "Your package was delivered!\n\n\n\n\n\nDelivered today\n"
    "Package was handed to resident\nPoorna – Mysore, KARNATAKA\nOrder #\n403-5741252-8575545\n\n"
    "Track package\nhttps://www.amazon.in/progress-tracker/package?orderId=403-5741252-8575545\n"
    "* Hair Clips for Girls, Set of 10\n  Quantity: 1\n\n"
    "Tell us how we did! Rate your delivery\n"
)


class TestParseShipmentEmail:
    def test_amazon_shipped(self):
        result = parse_shipment_email(
            "shipment-tracking@amazon.in", 'Shipped: "Plastic Storage Box..."', _AMAZON_SHIPPED_BODY,
        )
        assert len(result) == 1
        pkg = result[0]
        assert pkg["carrier"] == "amazon"
        assert pkg["status"] == "shipped"
        assert pkg["order_id"] == "403-4826656-9069124"
        assert pkg["tracking_number"] is None
        assert pkg["item_description"] == "Plastic Storage Box With Partitions (Pack of 2)"
        assert pkg["tracking_url"].startswith("https://www.amazon.in/progress-tracker/package")

    def test_amazon_ordered_digest_covers_multiple_orders(self):
        # Amazon's combined "Ordered" digest email bundles unrelated orders
        # placed close together -- must yield one Package entry per order, not
        # just the first one found.
        result = parse_shipment_email(
            "auto-confirm@amazon.in", 'Ordered: "Craft Storage..." and 1 more item', _AMAZON_ORDERED_MULTI_BODY,
        )
        assert len(result) == 2
        assert {p["order_id"] for p in result} == {"403-5851435-0121927", "403-9586913-9674705"}
        assert all(p["status"] == "ordered" for p in result)
        first, second = result
        assert first["item_description"] == "Craft Storage Organizer With Dividers"
        assert second["item_description"] == "Rubber Bands Pack, Elastic Ponytail Accessories"

    def test_amazon_delivered(self):
        result = parse_shipment_email(
            "order-update@amazon.in", 'Delivered: "Hair Clips..."', _AMAZON_DELIVERED_BODY,
            received_date=datetime(2026, 9, 1, 6, 23, 50),
        )
        assert len(result) == 1
        pkg = result[0]
        assert pkg["status"] == "delivered"
        assert pkg["actual_delivery_date"] == datetime(2026, 9, 1, 0, 0, 0)
        assert pkg["expected_delivery_date"] is None

    def test_amazon_subject_without_status_prefix_returns_empty(self):
        # Confirmed-noisy real senders (diamonds/return/review-request mail
        # from *.amazon.in) must never produce a Package just because the
        # sender substring matches.
        result = parse_shipment_email(
            "no-reply@amazon.in", "Did your recent Amazon order meet your expectations?", "Please review your order.",
        )
        assert result == []

    def test_flipkart_shipped(self):
        body = "Order ID: OD123456789012345\nYour Wireless Mouse has been shipped and will arrive by Friday, 14 March."
        result = parse_shipment_email("noreply@flipkart.com", "Shipped", body)
        assert len(result) == 1
        assert result[0]["carrier"] == "flipkart"
        assert result[0]["status"] == "shipped"
        assert result[0]["order_id"] == "OD123456789012345"

    def test_unrecognized_sender_returns_empty_list(self):
        assert parse_shipment_email("someone@example.com", "hello", "just a normal email") == []

    def test_recognized_sender_unmatched_body_returns_empty_list(self):
        assert parse_shipment_email("shipment-tracking@amazon.in", "Newsletter", "Check out our deals!") == []

    def test_never_raises_on_garbage_body(self):
        # Malformed/empty body must degrade to an empty list, not raise.
        assert parse_shipment_email("shipment-tracking@amazon.in", "", "") == []
        assert parse_shipment_email("delhivery.com", "", "") == []


# ═════════════════════════════════════════════════════════════════════════════
# calendar_service tests
# ═════════════════════════════════════════════════════════════════════════════
from app.services.calendar_service import expand_occurrences


class TestExpandOccurrences:
    def test_none_recurrence_in_window(self):
        due = datetime(2026, 3, 15)
        result = expand_occurrences(due, "none", datetime(2026, 3, 1), datetime(2026, 3, 31))
        assert result == [due]

    def test_none_recurrence_outside_window(self):
        due = datetime(2026, 4, 15)
        result = expand_occurrences(due, "none", datetime(2026, 3, 1), datetime(2026, 3, 31))
        assert result == []

    def test_none_recurrence_overdue_still_surfaces(self):
        # An overdue one-off within the window (window_start is typically "now - 1 day")
        due = datetime(2026, 3, 5)
        result = expand_occurrences(due, "none", datetime(2026, 3, 4), datetime(2026, 3, 31))
        assert result == [due]

    def test_weekly_expands_multiple_occurrences(self):
        due = datetime(2026, 3, 1)
        result = expand_occurrences(due, "weekly", datetime(2026, 3, 1), datetime(2026, 3, 22))
        assert result == [datetime(2026, 3, 1), datetime(2026, 3, 8), datetime(2026, 3, 15), datetime(2026, 3, 22)]

    def test_monthly_handles_31st_across_short_months(self):
        due = datetime(2026, 1, 31)
        result = expand_occurrences(due, "monthly", datetime(2026, 1, 1), datetime(2026, 4, 30))
        # February has no 31st -- clamps to the 28th (2026 is not a leap year).
        assert result == [datetime(2026, 1, 31), datetime(2026, 2, 28), datetime(2026, 3, 31), datetime(2026, 4, 30)]

    def test_yearly_steps_forward(self):
        due = datetime(2024, 6, 1)
        result = expand_occurrences(due, "yearly", datetime(2026, 1, 1), datetime(2026, 12, 31))
        assert result == [datetime(2026, 6, 1)]

    def test_window_boundary_inclusive(self):
        due = datetime(2026, 3, 1)
        result = expand_occurrences(due, "weekly", datetime(2026, 3, 8), datetime(2026, 3, 8))
        assert result == [datetime(2026, 3, 8)]

    def test_no_due_date_returns_empty(self):
        assert expand_occurrences(None, "none", datetime(2026, 1, 1), datetime(2026, 12, 31)) == []
