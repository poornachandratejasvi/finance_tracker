"""Time helpers.

``datetime.utcnow()`` is deprecated from Python 3.12 onward. :func:`utcnow` is a
drop-in replacement that returns a timezone-naive UTC timestamp, matching the semantics
the codebase already relies on for naive ``DateTime`` columns.
"""
from datetime import datetime, timezone


def utcnow() -> datetime:
    """Return the current UTC time as a timezone-naive datetime."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
