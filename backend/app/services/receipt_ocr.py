"""OCR text extraction for receipt photos, using the same open-source Tesseract
engine (pytesseract) already used for image-based bank-statement PDFs in
pdf_parser.py -- no new OCR engine needed, just pointed at a plain photo
instead of a PDF-page render.
"""
import logging
from io import BytesIO

logger = logging.getLogger(__name__)

try:
    import pytesseract
    from PIL import Image
    OCR_AVAILABLE = True
except ImportError:
    OCR_AVAILABLE = False
    logger.warning("OCR libraries not available. Install pytesseract and Pillow for receipt scanning.")


def extract_receipt_text(image_bytes: bytes) -> str:
    """OCR a receipt photo. Returns '' (never raises) if OCR isn't available
    or the image can't be read -- caller falls back to manual entry."""
    if not OCR_AVAILABLE:
        return ""
    try:
        image = Image.open(BytesIO(image_bytes))
        return pytesseract.image_to_string(image, lang="eng")
    except Exception as e:
        logger.error("Receipt OCR failed: %s", e)
        return ""
