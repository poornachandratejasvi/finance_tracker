"""Celery task: resolve a Paperless-ngx consume task into a real document ID
once processing finishes, and store it on the transaction it belongs to.
Paperless's post_document API returns immediately with just a task ID -- the
actual OCR/indexing happens asynchronously, sometimes taking well past what an
HTTP request should ever block waiting for.
"""
import logging

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="paperless.resolve_document", bind=True, max_retries=24)
def resolve_paperless_document(self, transaction_id: int, task_id: str):
    from app.core.database import SessionLocal
    from app.models.models import Transaction
    from app.services import paperless_service

    db = SessionLocal()
    try:
        document_id = paperless_service.resolve_document_id(db, task_id)
        if document_id is None:
            # Not finished yet -- retry with backoff. 24 retries at up to 60s apart
            # gives a slow/backlogged Paperless instance a real chance to finish
            # OCR before giving up (the receipt is still safely in Paperless
            # either way; this only affects whether the app can deep-link to it).
            raise self.retry(countdown=min(10 * (self.request.retries + 1), 60))
        txn = db.query(Transaction).filter(Transaction.id == transaction_id).first()
        if txn:
            txn.paperless_document_id = document_id
            db.commit()
            logger.info("Linked transaction %s to Paperless document %s", transaction_id, document_id)
    finally:
        db.close()
