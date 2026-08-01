"""Create a Google Task from a Finance Tracker notification, reusing the SAME
offline (credentials.json) OAuth connection as Drive backup — one consent grants
both scopes, so there's nothing extra for the user to connect."""
import logging
import warnings
from typing import Optional

from app.services.backup_service import _build_credentials, _refresh_if_needed

logger = logging.getLogger(__name__)

TASK_LIST_NAME = "Finance Tracker Alerts"


def _tasks_service(creds_dict: dict):
    from googleapiclient.discovery import build
    warnings.filterwarnings('ignore', message='file_cache is only supported')
    creds = _build_credentials(creds_dict)
    _refresh_if_needed(creds, creds_dict)
    return build('tasks', 'v1', credentials=creds, cache_discovery=False)


def _ensure_task_list(service, name: str = TASK_LIST_NAME) -> str:
    """Return the id of the dedicated task list, creating it if it doesn't exist."""
    resp = service.tasklists().list(maxResults=100).execute()
    for tl in resp.get('items', []):
        if tl.get('title') == name:
            return tl['id']
    created = service.tasklists().insert(body={"title": name}).execute()
    return created['id']


def create_task(creds_dict: dict, title: str, notes: Optional[str] = None) -> str:
    """Create a task in the dedicated 'Finance Tracker Alerts' Google Tasks list.
    Returns the created task id. Raises on failure (caller decides how to report it)."""
    service = _tasks_service(creds_dict)
    list_id = _ensure_task_list(service)
    body = {"title": title[:1024]}
    if notes:
        body["notes"] = notes[:8192]
    created = service.tasks().insert(tasklist=list_id, body=body).execute()
    return created.get('id')


def complete_task(creds_dict: dict, task_id: str) -> None:
    """Mark a task in the 'Finance Tracker Alerts' list as completed. Looks the list id
    up again rather than requiring the caller to store it — it's a single cheap
    tasklists().list() call, and the list is stable (created once, reused after)."""
    service = _tasks_service(creds_dict)
    list_id = _ensure_task_list(service)
    service.tasks().patch(tasklist=list_id, task=task_id, body={"status": "completed"}).execute()
