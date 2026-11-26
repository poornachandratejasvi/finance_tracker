"""Parsers for alert wordings taken from real inbox messages."""

from __future__ import annotations

import unittest
from datetime import datetime
from pathlib import Path


class TestMissedAlertParsers(unittest.TestCase):
    def test_bob_neft_acceptance_is_a_debit(self):
        from app.services.alert_email_service import parse_alert_email

        body = (
            "NEFT of Rs. 15000 to T M SRINIVASAGOWDA is accepted via bob World "
            "on 25/11/2026 with UTR no. BARBT26329054678 - Bank of Baroda."
        )
        parsed = parse_alert_email(
            "no-reply@bankofbaroda.bank.in", "bob World - Transaction Alert", body
        )
        self.assertEqual(parsed["amount"], 15000.0)
        self.assertEqual(parsed["transaction_type"], "debit")
        self.assertEqual(parsed["description"], "NEFT to T M SRINIVASAGOWDA")
        self.assertEqual(parsed["transaction_date"], datetime(2026, 11, 25))

    def test_bob_imps_debit_still_parses(self):
        from app.services.alert_email_service import parse_alert_email

        body = (
            "Rs. 15,000.00 debited from A/c no. 1234567890 on 30-10-25 via bob World "
            "and transferred to beneficiary A/c no. 9988776655 through IMPS."
        )
        parsed = parse_alert_email("no-reply@bankofbaroda.bank.in", "bob World - Transaction Alert", body)
        self.assertEqual(parsed["amount"], 15000.0)
        self.assertEqual(parsed["transaction_type"], "debit")
        self.assertEqual(parsed["transaction_date"], datetime(2025, 10, 30))

    def test_indusind_card_approval_is_a_debit(self):
        from app.services.alert_email_service import parse_alert_email

        body = (
            "The transaction on your IndusInd Bank Credit Card ending 6355 for INR 1,071.10 "
            "on 04-11-2026 11:29:52 am at Book My Show Smart G is Approved. "
            "Available Limit: INR 468,931.00."
        )
        parsed = parse_alert_email(
            "transactionalert@indusind.com",
            "Transaction Alert - IndusInd Bank Credit Card",
            body,
        )
        self.assertEqual(parsed["amount"], 1071.10)
        self.assertEqual(parsed["transaction_type"], "debit")
        self.assertEqual(parsed["description"], "Book My Show Smart G")
        self.assertEqual(parsed["card_hint"], "6355")
        self.assertEqual(parsed["transaction_date"], datetime(2026, 11, 4, 11, 29, 52))
        self.assertNotIn("updated_balance", parsed)

    def test_sbi_upi_credit_for_sets_available_balance(self):
        from app.services.alert_email_service import parse_alert_email

        body = (
            "Your A/C XXXXX474266 has credit for UPI/DRC/123456789012/ABCD/ of Rs 10.00 "
            "on 08/11/26. Avl Bal Rs 3,90,390.50.-SBI"
        )
        parsed = parse_alert_email("cbssbi.cas@alerts.sbi.bank.in", "CBSSBI ALERT", body)
        self.assertEqual(parsed["amount"], 10.0)
        self.assertEqual(parsed["transaction_type"], "credit")
        self.assertIn("UPI/DRC", parsed["description"])
        self.assertEqual(parsed["transaction_date"], datetime(2026, 11, 8))
        self.assertEqual(parsed["updated_balance"], 390390.50)

    def test_sbi_debit_by_transfer_still_parses(self):
        from app.services.alert_email_service import parse_alert_email

        body = "Your A/C 12345678901 has a debit by transfer of Rs 236.00 on 15/07/26. Avl Bal Rs 1,509.67.-SBI"
        parsed = parse_alert_email("cbssbi.cas@alerts.sbi.bank.in", "CBSSBI ALERT", body)
        self.assertEqual(parsed["amount"], 236.0)
        self.assertEqual(parsed["transaction_type"], "debit")
        self.assertEqual(parsed["transaction_date"], datetime(2026, 7, 15))
        self.assertEqual(parsed["updated_balance"], 1509.67)

    def test_sbi_cheque_notice_is_not_a_transaction(self):
        from app.services.alert_email_service import parse_alert_email

        body = "Chq 123456 for INR 9,98,000.00 fvr SOMEONE recd in clg wl be paid if in order.-SBI"
        self.assertIsNone(parse_alert_email("cbssbi.cas@alerts.sbi.bank.in", "CBSSBI ALERT", body))


class TestAlertQueryCoversWordings(unittest.TestCase):
    def test_query_fetches_templates_that_omit_debited_credited(self):
        text = Path(__file__).resolve().parents[1].joinpath("app/services/alert_sync_service.py").read_text()
        self.assertIn('from:no-reply@bankofbaroda.bank.in subject:"Transaction Alert"', text)
        self.assertIn("from:transactionalert@indusind.com", text)
        self.assertIn('"has credit for"', text)


if __name__ == "__main__":
    unittest.main()
