"""Sends OS-level push notifications to the mobile app via Expo's push service
-- works for both iOS and Android through one HTTP API (Expo handles the
APNs/FCM split behind the scenes), so this is the one place that needs to know
about device tokens at all. See push_tokens.py for how a token gets
registered by the app on launch.

Fire-and-forget: this does NOT check Expo's delivery-receipt API (a second,
separate call Expo requires to know if a message actually reached the device)
-- good enough for a reminder that also always goes out over Discord in
parallel, not worth the extra complexity for a first version.
"""
import logging

import requests

logger = logging.getLogger(__name__)

_EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
_BATCH_SIZE = 100
_TIMEOUT = 10


def send_push_to_user(db, user_id: int, title: str, body: str, data: dict = None) -> int:
    """Send to every device this user has registered. Returns how many
    messages were accepted by Expo (not proof of on-device delivery). Never
    raises -- a dead token or an Expo outage degrades to "sent 0", not a
    broken reminder task."""
    from app.models.models import PushToken

    tokens = [t.token for t in db.query(PushToken).filter(PushToken.user_id == user_id).all()]
    if not tokens:
        return 0

    messages = [{"to": tok, "title": title, "body": body, "data": data or {}, "sound": "default"} for tok in tokens]
    sent = 0
    for i in range(0, len(messages), _BATCH_SIZE):
        batch = messages[i:i + _BATCH_SIZE]
        try:
            resp = requests.post(
                _EXPO_PUSH_URL, json=batch,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
                timeout=_TIMEOUT,
            )
            if resp.status_code == 200:
                sent += len(batch)
            else:
                logger.warning("Expo push send failed (%s): %s", resp.status_code, resp.text[:300])
        except Exception:
            logger.warning("Expo push send raised", exc_info=True)
    return sent
