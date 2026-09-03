"""Celery task: resolve a Paperless-ngx consume task into a real document ID
for an archived payslip -- same shape as vehicle_document_tasks.resolve_vehicle_document.
"""
import logging

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="payslip_documents.resolve", bind=True, max_retries=24)
def resolve_payslip_document(self, payslip_id: int, task_id: str):
    from app.core.database import SessionLocal
    from app.models.models import Payslip
    from app.services import paperless_service

    db = SessionLocal()
    try:
        document_id = paperless_service.resolve_document_id(db, task_id)
        if document_id is None:
            raise self.retry(countdown=min(10 * (self.request.retries + 1), 60))
        payslip = db.query(Payslip).filter(Payslip.id == payslip_id).first()
        if payslip:
            payslip.paperless_document_id = document_id
            db.commit()
            logger.info("Linked payslip %s to Paperless document %s", payslip_id, document_id)
    finally:
        db.close()
