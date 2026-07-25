"""Shared parsing helpers used across API endpoints."""
from typing import Callable, List


def parse_csv_list(value, cast: Callable = str) -> List:
    """Parse a comma-separated string (or list) into a list of cast values.

    Accepts either a list or a comma-separated string. Items that fail to cast are
    skipped rather than raising, so malformed query params never 500 the request.
    """
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
