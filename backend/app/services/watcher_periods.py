"""Period-label computation for TransactionWatcher frequencies (daily/weekly/
monthly/yearly) — shared between the Celery task and the manual run-now endpoint
so both compute the exact same "has this period already got an open task" key."""


def period_label(frequency: str, dt) -> str:
    """A stable, sortable key identifying dt's bucket for the given frequency —
    used to detect whether a new Google Task is due yet."""
    if frequency == "daily":
        return dt.strftime("%Y-%m-%d")
    if frequency == "weekly":
        iso = dt.isocalendar()
        return f"{iso[0]}-W{iso[1]:02d}"
    if frequency == "yearly":
        return dt.strftime("%Y")
    return dt.strftime("%Y-%m")  # monthly (default)


def period_title(frequency: str, dt) -> str:
    """Human-readable label for the Google Task title."""
    if frequency == "daily":
        return dt.strftime("%d %b %Y")
    if frequency == "weekly":
        iso = dt.isocalendar()
        return f"Week {iso[1]}, {iso[0]}"
    if frequency == "yearly":
        return dt.strftime("%Y")
    return dt.strftime("%B %Y")  # monthly
