"""Celery task: resolve a Paperless-ngx consume task into a real document ID
for a vehicle document -- same shape as paperless_tasks.resolve_paperless_document
(receipts), just updating VehicleDocument instead of Transaction.
"""
import logging

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="vehicle_documents.resolve", bind=True, max_retries=24)
def resolve_vehicle_document(self, vehicle_document_id: int, task_id: str):
    from app.core.database import SessionLocal
    from app.models.models import VehicleDocument
    from app.services import paperless_service

    db = SessionLocal()
    try:
        document_id = paperless_service.resolve_document_id(db, task_id)
        if document_id is None:
            raise self.retry(countdown=min(10 * (self.request.retries + 1), 60))
        doc = db.query(VehicleDocument).filter(VehicleDocument.id == vehicle_document_id).first()
        if doc:
            doc.paperless_document_id = document_id
            db.commit()
            logger.info("Linked vehicle document %s to Paperless document %s", vehicle_document_id, document_id)
    finally:
        db.close()
