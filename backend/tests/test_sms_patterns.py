"""Sample-taught SMS extraction. Amounts in the fixtures are the shapes of real alerts."""

from __future__ import annotations

import unittest


DEBIT_SMS = (
    "Your a/c XX1234 is debited for Rs.500.00 on 26-11-2026 and credited to a/c XX5678. "
    "Avl Bal Rs 12,345.67"
)
CREDIT_SMS = "Rs 1,500.00 credited to your account on 08/11/26. Avl Bal Rs 20,000.00"
OTP_SMS = "OTP for txn of INR 499.00 at AMAZON is 123456. Do not share."


class TestStructuralParse(unittest.TestCase):
    def test_outgoing_transfer_with_both_words_is_a_debit(self):
        from app.services.sms_patterns import structural_parse

        parsed = structural_parse(DEBIT_SMS)
        self.assertEqual(parsed["amount"], 500.0)
        self.assertEqual(parsed["transaction_type"], "debit")
        self.assertEqual(parsed["balance"], 12345.67)

    def test_credit_ignores_the_available_balance(self):
        from app.services.sms_patterns import structural_parse

        parsed = structural_parse(CREDIT_SMS)
        self.assertEqual(parsed["amount"], 1500.0)
        self.assertEqual(parsed["transaction_type"], "credit")
        self.assertEqual(parsed["balance"], 20000.0)

    def test_balance_only_is_not_a_transaction(self):
        from app.services.sms_patterns import structural_parse

        self.assertIsNone(structural_parse("Avl Bal Rs 20,000.00"))

    def test_two_spend_amounts_are_left_for_a_sample_or_ai(self):
        from app.services.sms_patterns import structural_parse

        text = "Rs 100.00 spent at A and Rs 40.00 spent at B"
        self.assertIsNone(structural_parse(text))


class TestSamples(unittest.TestCase):
    def _debit_sample(self):
        from app.services.sms_patterns import skeleton_for_sample

        skeleton = skeleton_for_sample(DEBIT_SMS, amount=500, balance=12345.67, is_transaction=True)
        return {
            "skeleton": skeleton,
            "is_transaction": True,
            "transaction_type": "debit",
            "description": "UPI transfer",
            "bank_id": 2,
            "source": "manual",
        }

    def test_a_saved_debit_matches_the_same_wording_with_a_new_amount(self):
        from app.services.sms_patterns import decide

        fresh = (
            "Your a/c XX9999 is debited for Rs.42.50 on 01-12-2026 and credited to a/c XX1111. "
            "Avl Bal Rs 99.00"
        )
        decision = decide(fresh, [self._debit_sample()])
        self.assertEqual(decision["action"], "transaction")
        self.assertEqual(decision["via"], "sample")
        self.assertEqual(decision["amount"], 42.50)
        self.assertEqual(decision["transaction_type"], "debit")
        self.assertEqual(decision["bank_id"], 2)

    def test_a_not_a_transaction_sample_ignores_the_next_otp(self):
        from app.services.sms_patterns import decide, skeleton_for_sample

        sample = {
            "skeleton": skeleton_for_sample(OTP_SMS, is_transaction=False),
            "is_transaction": False,
            "source": "manual",
        }
        other = "OTP for txn of INR 80.00 at FLIPKART is 654321. Do not share."
        decision = decide(other, [sample])
        self.assertEqual(decision["action"], "ignore")

    def test_no_sample_and_no_structure_asks_for_ai_then_learns(self):
        from app.services.sms_patterns import apply_ai, decide

        text = "Card purchase 250 at METRO on 26 Nov 2026"
        decision = decide(text, [])
        self.assertEqual(decision["action"], "need_ai")
        learned = apply_ai(decision, {"amount": 250, "transaction_type": "debit", "description": "METRO"})
        self.assertEqual(learned["action"], "transaction")
        self.assertEqual(learned["via"], "ai")
        self.assertTrue(learned["learn"])
        self.assertEqual(learned["amount"], 250)

    def test_a_learned_shape_matches_the_next_sms(self):
        from app.services.sms_patterns import decide, skeleton_for_sample

        text = "Card purchase 250 at METRO on 26 Nov 2026"
        sample = {
            "skeleton": skeleton_for_sample(text, amount=250, is_transaction=True),
            "is_transaction": True,
            "transaction_type": "debit",
            "description": "METRO",
            "bank_id": None,
            "source": "ai",
        }
        nxt = "Card purchase 80 at METRO on 01 Dec 2026"
        decision = decide(nxt, [sample])
        self.assertEqual(decision["via"], "sample")
        self.assertEqual(decision["amount"], 80.0)

    def test_ai_failure_is_unmatched(self):
        from app.services.sms_patterns import apply_ai, decide

        decision = decide("hello there", [])
        self.assertEqual(apply_ai(decision, None)["action"], "unmatched")

    def test_amount_missing_from_the_text_cannot_become_a_template(self):
        from app.services.sms_patterns import skeleton_for_sample

        self.assertIsNone(skeleton_for_sample("no money here", amount=10, is_transaction=True))


if __name__ == "__main__":
    unittest.main()
