"""Shared helper for any email-sync pipeline that needs to see past a
manually-forwarded copy of a message -- originally written for
alert_sync_service.py (bank alerts landing at a work inbox and getting
forwarded to the Gmail account this app watches), reused as-is by
insurance_email_sync.py for the same reason.
"""
import re
from typing import Optional

# Matches the "From: Display Name <address@domain>" line Outlook/Exchange
# inserts as plain text at the top of a forwarded message's body (e.g. "From:
# Pluxee IN <noreply-cardinfo@services.pluxee.in>"). Used as a fallback when
# the Gmail envelope sender doesn't match any configured source -- some
# accounts only ever receive certain emails at a work inbox and manually
# forward them to the Gmail account this app actually watches, at which point
# the envelope sender becomes the forwarder's own address, not the original
# sender's.
FORWARDED_FROM_RE = re.compile(r"From:\s*(?:[^<\n]*)<([\w.+-]+@[\w.-]+)>", re.IGNORECASE)


def extract_forwarded_sender(body: str) -> Optional[str]:
    match = FORWARDED_FROM_RE.search(body or "")
    return match.group(1) if match else None
