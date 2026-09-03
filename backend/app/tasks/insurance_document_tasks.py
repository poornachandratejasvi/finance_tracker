"""Celery task: resolve a Paperless-ngx consume task into a real document ID
for an insurance document -- same shape as vehicle_document_tasks.resolve_vehicle_document,
just updating InsuranceDocument instead of VehicleDocument.
"""
import logging

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="insurance_documents.resolve", bind=True, max_retries=24)
def resolve_insurance_document(self, insurance_document_id: int, task_id: str):
    from app.core.database import SessionLocal
    from app.models.models import InsuranceDocument
    from app.services import paperless_service

    db = SessionLocal()
    try:
        document_id = paperless_service.resolve_document_id(db, task_id)
        if document_id is None:
            raise self.retry(countdown=min(10 * (self.request.retries + 1), 60))
        doc = db.query(InsuranceDocument).filter(InsuranceDocument.id == insurance_document_id).first()
        if doc:
            doc.paperless_document_id = document_id
            db.commit()
            logger.info("Linked insurance document %s to Paperless document %s", insurance_document_id, document_id)
    finally:
        db.close()
