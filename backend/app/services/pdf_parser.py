import pdfplumber
import PyPDF2
import pikepdf
import os
import re
import tempfile
from typing import List, Dict, Optional, Tuple
from datetime import datetime
import pandas as pd
import logging

# OCR imports for image-based PDFs
try:
    import pytesseract
    from pdf2image import convert_from_path
    OCR_AVAILABLE = True
except ImportError:
    OCR_AVAILABLE = False
    logging.warning("OCR libraries not available. Install pytesseract and pdf2image for image PDF support")

logger = logging.getLogger(__name__)


class PDFParser:
    """Service to parse PDF bank statements"""
    
    @staticmethod
    def is_password_protected(pdf_path: str) -> bool:
        """Check if PDF is password protected"""
        try:
            with open(pdf_path, 'rb') as file:
                reader = PyPDF2.PdfReader(file)
                return reader.is_encrypted
        except Exception as e:
            logger.error(f"Error checking PDF encryption: {e}")
            return False
    
    @staticmethod
    def unlock_pdf(pdf_path: str, password: str, output_path: str) -> bool:
        """Unlock password-protected PDF"""
        try:
            with pikepdf.open(pdf_path, password=password) as pdf:
                pdf.save(output_path)
            return True
        except Exception as e:
            logger.error(f"Error unlocking PDF: {e}")
            return False
    
    @staticmethod
    def extract_text(pdf_path: str, password: Optional[str] = None) -> str:
        """Extract all text from PDF, with OCR fallback for image-based PDFs"""
        unlocked_pdf_path = None
        try:
            # Handle password-protected PDFs
            if password:
                with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
                    tmp_path = tmp.name

                if not PDFParser.unlock_pdf(pdf_path, password, tmp_path):
                    return ""
                unlocked_pdf_path = tmp_path
                pdf_path = tmp_path
            
            text = ""
            with pdfplumber.open(pdf_path) as pdf:
                for page in pdf.pages:
                    page_text = page.extract_text() or ""
                    text += page_text
            
            # If no text extracted, try OCR
            if not text.strip() and OCR_AVAILABLE:
                logger.info(f"No text found in PDF, attempting OCR extraction for {pdf_path}")
                text = PDFParser.extract_text_ocr(pdf_path)
            elif not text.strip():
                logger.warning(f"PDF appears to be image-based but OCR is not available. Install pytesseract and pdf2image")
            
            return text
        except Exception as e:
            logger.error(f"Error extracting PDF text: {e}")
            # If pdfplumber failed but OCR is available, try OCR anyway
            # But first check if it's a password-protected PDF and unlock it
            if OCR_AVAILABLE and not unlocked_pdf_path:
                # Check if PDF is password-protected
                if PDFParser.is_password_protected(pdf_path):
                    logger.warning("PDF is password-protected and no password provided. Cannot extract text.")
                    return ""
                else:
                    # PDF is not password-protected, might be image-based, try OCR
                    logger.info("Attempting OCR extraction after pdfplumber failure")
                    return PDFParser.extract_text_ocr(pdf_path)
            return ""
        finally:
            # Always remove the temporary decrypted copy (created with delete=False).
            if unlocked_pdf_path and os.path.exists(unlocked_pdf_path):
                try:
                    os.remove(unlocked_pdf_path)
                except OSError:
                    pass
    
    @staticmethod
    def extract_text_ocr(pdf_path: str) -> str:
        """Extract text from image-based PDF using OCR"""
        if not OCR_AVAILABLE:
            return ""
        
        try:
            logger.info(f"Running OCR on {pdf_path}")
            # Convert PDF to images
            images = convert_from_path(pdf_path, dpi=300)
            
            text = ""
            for i, image in enumerate(images):
                # Extract text from each page image
                page_text = pytesseract.image_to_string(image, lang='eng')
                text += page_text + "\n"
                logger.debug(f"OCR extracted {len(page_text)} characters from page {i+1}")
            
            logger.info(f"OCR completed: extracted {len(text)} total characters")
            return text
        except Exception as e:
            logger.error(f"Error during OCR extraction: {e}")
            return ""
    
    @staticmethod
    def extract_tables(pdf_path: str, password: Optional[str] = None) -> List[pd.DataFrame]:
        """Extract tables from PDF"""
        unlocked_pdf_path = None
        try:
            # Handle password-protected PDFs
            if password:
                with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
                    tmp_path = tmp.name

                if not PDFParser.unlock_pdf(pdf_path, password, tmp_path):
                    return []
                unlocked_pdf_path = tmp_path
                pdf_path = tmp_path

            tables = []
            with pdfplumber.open(pdf_path) as pdf:
                for page in pdf.pages:
                    page_tables = page.extract_tables()
                    for table in page_tables:
                        if table:
                            df = pd.DataFrame(table[1:], columns=table[0])
                            tables.append(df)

            return tables
        except Exception as e:
            logger.error(f"Error extracting PDF tables: {e}")
            return []
        finally:
            if unlocked_pdf_path and os.path.exists(unlocked_pdf_path):
                try:
                    os.remove(unlocked_pdf_path)
                except OSError:
                    pass
    
    @staticmethod
    def detect_bank(text: str) -> Optional[str]:
        """Detect bank from PDF content"""
        bank_patterns = {
            'HDFC': r'HDFC\s+BANK',
            'ICICI': r'ICICI\s+BANK',
            'SCBANK': r'STANDARD\s+CHARTERED|SC\s+BANK|SCBL',
            'AXIS': r'AXIS\s+BANK',
            'KOTAK': r'KOTAK\s+MAHINDRA',
            'YES': r'YES\s+BANK',
            'SBI': r'STATE\s+BANK\s+OF\s+INDIA|SBI\s+BANK|SBI\s+CARD',
            'CITI': r'CITI\s*BANK',
            'HSBC': r'HSBC',
            'IDFC': r'IDFC\s+FIRST',
            'RBL': r'RBL\s+BANK|RBL',
            'BOB': r'BANK\s+OF\s+BARODA|BANK\s+OF\s+BARODA|BARODA',
        }
        
        text_upper = text.upper()
        for bank_code, pattern in bank_patterns.items():
            if re.search(pattern, text_upper):
                return bank_code
        
        return None
    
    @staticmethod
    def extract_statement_period(text: str) -> Tuple[Optional[datetime], Optional[datetime]]:
        """Extract statement period from PDF"""
        patterns = [
            r'Statement\s+Period[:\s]+(\d{2}[/-]\d{2}[/-]\d{4})\s+to\s+(\d{2}[/-]\d{2}[/-]\d{4})',
            r'From[:\s]+(\d{2}[/-]\d{2}[/-]\d{4})\s+To[:\s]+(\d{2}[/-]\d{2}[/-]\d{4})',
            r'(\d{2}[/-]\d{2}[/-]\d{4})\s+to\s+(\d{2}[/-]\d{2}[/-]\d{4})',
            r'(\d{2}\s+[A-Za-z]{3}\s+\d{4})\s+to\s+(\d{2}\s+[A-Za-z]{3}\s+\d{4})',
            r'(\d{2}\s+[A-Za-z]{3}\s+\d{2})\s+to\s+(\d{2}\s+[A-Za-z]{3}\s+\d{2})',
        ]
        
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                try:
                    start_str, end_str = match.groups()
                    start_date = pd.to_datetime(start_str, dayfirst=True)
                    end_date = pd.to_datetime(end_str, dayfirst=True)
                    return start_date, end_date
                except Exception:
                    continue
        
        return None, None
    
    @staticmethod
    def parse_hdfc_credit_card(text: str, tables: List[pd.DataFrame]) -> List[Dict]:
        """Parse HDFC credit card statement"""
        logger.info("Parsing HDFC credit card statement")
        transactions = []
        
        # Try table-based parsing first (for newer format)
        for df in tables:
            if df.empty:
                continue
            
            # Check if this is a transaction table
            header_text = ' '.join([str(col).upper() for col in df.columns if str(col) != 'nan' and col])
            
            if ('DATE' in header_text and ('TRANSACTION' in header_text or 'DESCRIPTION' in header_text)) or \
               ('DATE' in header_text and 'AMOUNT' in header_text):
                logger.info(f"Found transaction table with {len(df)} rows, columns: {list(df.columns)}")
                
                for idx, row in df.iterrows():
                    try:
                        # Get all row values as strings
                        row_str = ' '.join([str(val) for val in row if str(val).strip() and str(val) != 'nan'])
                        
                        if not row_str or len(row_str) < 10:
                            continue
                        
                        # Match date patterns: DD/MM/YYYY or DD/MM/YYYY| HH:MM
                        date_match = re.search(r'(\d{2}/\d{2}/\d{4})', row_str)
                        if not date_match:
                            continue
                        
                        date_str = date_match.group(1)
                        
                        # Extract the trailing amount. Handle every HDFC variant:
                        #  - optional credit/debit prefix  C / + / -
                        #  - integer OR decimal amount     1234  or  1,234.56
                        #  - optional Cr/Dr suffix          1,234.56 Cr
                        #  - a stray OCR 'l'/'I' artifact at the very end
                        amount_match = re.search(
                            r'([C\+\-]?)\s*([\d,]+(?:\.\d{1,2})?)\s*(Cr|Dr)?\s*[lI]?\s*$',
                            row_str,
                            re.IGNORECASE,
                        )
                        if not amount_match:
                            logger.debug(f"No amount found in row: {row_str}")
                            continue

                        prefix = amount_match.group(1) or ''
                        amount_str = amount_match.group(2).replace(',', '')
                        suffix = (amount_match.group(3) or '').lower()
                        try:
                            amount = float(amount_str)
                        except ValueError:
                            logger.debug(f"Invalid amount: {amount_str}")
                            continue

                        # Extract description - everything between date and amount
                        desc_start = date_match.end()
                        desc_end = amount_match.start()
                        description = row_str[desc_start:desc_end].strip()

                        # Remove time if present (| HH:MM)
                        description = re.sub(r'\|\s*\d{2}:\d{2}', '', description).strip()
                        # Remove extra pipe markers
                        description = re.sub(r'\|+', ' ', description).strip()
                        # Remove trailing markers
                        description = re.sub(r'\s+[lI]+\s*$', '', description).strip()

                        if not description or len(description) < 3:
                            logger.debug(f"Description too short: {description}")
                            continue

                        # Determine transaction type. NOTE: a leading 'C' is NOT a credit
                        # marker here — HDFC's table extraction garbles the ₹ glyph into a
                        # literal 'C' that appears before EVERY amount (purchases and
                        # payments alike), confirmed against raw extracted rows where a
                        # plain dining charge reads "DISTRICT DINING ... C 50.00". Only an
                        # explicit '+' prefix or trailing 'Cr' suffix are genuine credit
                        # markers; a trailing 'Dr' is an explicit debit and wins.
                        # Bare 'PAYMENT'/'CREDIT' are too broad — many merchants have those
                        # words IN their business name ("Flipkart Payments Bangalore" is a
                        # purchase, not a bill payment), so only specific bill-payment /
                        # bank-transfer phrasings count as a genuine credit signal.
                        desc_upper = description.upper()
                        is_credit_marker = prefix == '+' or suffix == 'cr'
                        is_keyword_credit = any(k in desc_upper for k in (
                            'CC PAYMENT', 'CREDIT CARD PAYMENT', 'TRANSFER CREDIT',
                            'REVERSAL', 'REFUND', 'CASHBACK',
                        ))
                        if suffix == 'dr':
                            transaction_type = 'debit'
                        elif is_credit_marker or is_keyword_credit:
                            transaction_type = 'credit'
                        else:
                            transaction_type = 'debit'
                        
                        transaction_date = pd.to_datetime(date_str, format='%d/%m/%Y')
                        
                        transaction = {
                            'transaction_date': transaction_date,
                            'description': description,
                            'amount': amount,
                            'transaction_type': transaction_type,
                            'balance': None,
                            'reference_number': None,
                            'original_description': description
                        }
                        
                        transactions.append(transaction)
                        logger.debug(f"Parsed: {date_str} {description[:30]} {amount}")
                        
                    except Exception as e:
                        logger.debug(f"Error parsing HDFC table row: {e}")
                        continue
        
        if len(transactions) > 0:
            logger.info(f"Extracted {len(transactions)} transactions from HDFC tables")
            return transactions
        
        # Fallback to text-based parsing for old format
        logger.info("Trying text-based parsing (old format)")
        lines = text.split('\n')
        in_transaction_section = False
        
        for i, line in enumerate(lines):
            line = line.strip()
            
            # Start of transaction section
            if 'Domestic Transactions' in line or 'International Transactions' in line:
                in_transaction_section = True
                logger.info(f"Found transaction section: {line}")
                continue
            
            # End of transaction section
            if in_transaction_section and ('Reward Points' in line or 'GST Details' in line or 'IMPORTANT' in line):
                in_transaction_section = False
                continue
            
            # Parse transaction lines
            if in_transaction_section and line:
                # Match date pattern DD/MM/YYYY at start
                date_match = re.match(r'(\d{2}/\d{2}/\d{4})\s+(.+?)\s+(\d+[\d,]*\.\d{2})(Cr|Dr)?$', line)
                
                if date_match:
                    try:
                        date_str = date_match.group(1)
                        description = date_match.group(2).strip()
                        amount_str = date_match.group(3).replace(',', '')
                        credit_marker = date_match.group(4)
                        
                        transaction_date = pd.to_datetime(date_str, format='%d/%m/%Y')
                        amount = float(amount_str)
                        
                        # Determine transaction type
                        if credit_marker == 'Cr' or 'CREDIT' in description.upper() or 'PAYMENT' in description.upper():
                            transaction_type = 'credit'
                        else:
                            transaction_type = 'debit'
                        
                        transaction = {
                            'transaction_date': transaction_date,
                            'description': description,
                            'amount': amount,
                            'transaction_type': transaction_type,
                            'balance': None,
                            'reference_number': None,
                            'original_description': description
                        }
                        
                        transactions.append(transaction)
                        logger.debug(f"Parsed transaction: {date_str} {description} {amount}")
                        
                    except Exception as e:
                        logger.debug(f"Error parsing HDFC transaction line: {e}")
                        continue
        
        logger.info(f"Extracted {len(transactions)} transactions from HDFC statement")
        return transactions
    
    @staticmethod
    def parse_transactions_generic(
        tables: List[pd.DataFrame],
        bank_code: Optional[str] = None,
        field_mapping: Optional[Dict] = None
    ) -> List[Dict]:
        """
        Parse transactions from tables using generic patterns
        
        Returns:
            List of transaction dictionaries
        """
        logger.info(f"Parsing transactions using generic parser for bank: {bank_code}")
        transactions = []

        def resolve_column(columns, mapped_value):
            if mapped_value is None:
                return None
            if isinstance(mapped_value, int):
                return mapped_value if 0 <= mapped_value < len(columns) else None
            target = str(mapped_value).strip().lower()
            if not target:
                return None
            for col in columns:
                if str(col).strip().lower() == target:
                    return col
            return None
        
        for df in tables:
            # Skip empty tables
            if df.empty or len(df.columns) < 3:
                continue
            
            # Try to identify transaction table by column patterns
            header = ' '.join([str(col).lower() for col in df.columns])
            
            # Common column patterns
            if not any(word in header for word in ['date', 'description', 'amount', 'debit', 'credit']):
                continue
            
            mapping = field_mapping or {}

            date_col = resolve_column(df.columns, mapping.get('date_field'))
            desc_col = resolve_column(df.columns, mapping.get('description_field'))
            amount_col = resolve_column(df.columns, mapping.get('amount_field'))
            debit_col = resolve_column(df.columns, mapping.get('debit_field'))
            credit_col = resolve_column(df.columns, mapping.get('credit_field'))
            type_col = resolve_column(df.columns, mapping.get('type_field'))
            balance_col = resolve_column(df.columns, mapping.get('balance_field'))
            ref_col = resolve_column(df.columns, mapping.get('reference_field'))

            if date_col is None:
                date_col = PDFParser._find_column(df.columns, ['date', 'txn date', 'transaction date', 'value date'])
            if desc_col is None:
                desc_col = PDFParser._find_column(df.columns, ['description', 'particulars', 'narration', 'details', 'transaction details'])
            if amount_col is None:
                amount_col = PDFParser._find_column(df.columns, ['amount', 'amt'])
            if debit_col is None:
                debit_col = PDFParser._find_column(df.columns, ['debit', 'withdrawal', 'dr'])
            if credit_col is None:
                credit_col = PDFParser._find_column(df.columns, ['credit', 'deposit', 'cr'])
            if balance_col is None:
                balance_col = PDFParser._find_column(df.columns, ['balance', 'closing balance'])
            if ref_col is None:
                ref_col = PDFParser._find_column(df.columns, ['reference', 'ref no', 'cheque no'])

            if date_col is None:
                date_col = PDFParser._detect_date_column(df)

            if date_col is None or desc_col is None:
                continue
            
            # Parse each row
            for idx, row in df.iterrows():
                try:
                    # Parse date
                    date_str = str(row.iloc[date_col] if isinstance(date_col, int) else row[date_col]).strip()
                    if not date_str or date_str == 'nan':
                        continue
                    
                    transaction_date = pd.to_datetime(date_str, dayfirst=True)
                    
                    # Get description
                    description = str(row.iloc[desc_col] if isinstance(desc_col, int) else row[desc_col]).strip()
                    if not description or description == 'nan':
                        continue
                    
                    debit = 0.0
                    credit = 0.0
                    transaction_type = None
                    amount = None

                    if debit_col is not None and credit_col is not None and debit_col == credit_col:
                        amount_col = debit_col
                        debit_col = None
                        credit_col = None

                    if debit_col is not None or credit_col is not None:
                        if debit_col is not None:
                            debit = PDFParser._parse_amount(row.iloc[debit_col] if isinstance(debit_col, int) else row[debit_col])
                        if credit_col is not None:
                            credit = PDFParser._parse_amount(row.iloc[credit_col] if isinstance(credit_col, int) else row[credit_col])

                        if debit and debit > 0:
                            amount = debit
                            transaction_type = 'debit'
                        elif credit and credit > 0:
                            amount = credit
                            transaction_type = 'credit'

                    if amount is None and amount_col is not None:
                        raw_amount = str(row.iloc[amount_col] if isinstance(amount_col, int) else row[amount_col]).strip()
                        parsed_amount = PDFParser._parse_amount(raw_amount)
                        amount = abs(parsed_amount)

                        if type_col is not None:
                            type_raw = str(row.iloc[type_col] if isinstance(type_col, int) else row[type_col]).lower()
                            if any(token in type_raw for token in ['cr', 'credit', 'deposit']):
                                transaction_type = 'credit'
                            elif any(token in type_raw for token in ['dr', 'debit', 'withdraw']):
                                transaction_type = 'debit'

                        if transaction_type is None:
                            lowered = raw_amount.lower()
                            if lowered.startswith('-') or '(' in lowered:
                                transaction_type = 'debit'
                            elif lowered.startswith('+'):
                                transaction_type = 'credit'
                            elif 'cr' in lowered:
                                transaction_type = 'credit'
                            elif 'dr' in lowered:
                                transaction_type = 'debit'

                    if amount is None or amount == 0:
                        continue

                    if transaction_type is None:
                        transaction_type = 'debit'
                    
                    # Get balance
                    balance = PDFParser._parse_amount(row.iloc[balance_col] if isinstance(balance_col, int) else row[balance_col]) if balance_col is not None else None
                    
                    # Get reference
                    reference = str(row.iloc[ref_col] if isinstance(ref_col, int) else row[ref_col]).strip() if ref_col is not None else None
                    if reference == 'nan':
                        reference = None
                    
                    transaction = {
                        'transaction_date': transaction_date,
                        'description': description,
                        'amount': amount,
                        'transaction_type': transaction_type,
                        'balance': balance,
                        'reference_number': reference,
                        'original_description': description
                    }
                    
                    transactions.append(transaction)
                
                except Exception as e:
                    logger.debug(f"Error parsing transaction row: {e}")
                    continue
        
        return transactions

    @staticmethod
    def _detect_date_column(df: pd.DataFrame) -> Optional[int]:
        """Detect date column by inspecting row values when headers are missing."""
        date_regex = re.compile(r'\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4}\b')
        best_col = None
        best_score = 0

        for idx, col in enumerate(df.columns):
            score = 0
            sample = df.iloc[:10, idx]
            for value in sample:
                if pd.isna(value):
                    continue
                if date_regex.search(str(value)):
                    score += 1
            if score > best_score:
                best_score = score
                best_col = idx

        return best_col if best_score >= 2 else None

    @staticmethod
    def parse_rbl_credit_card(text: str, tables: List[pd.DataFrame]) -> List[Dict]:
        """Parse RBL credit card statement transactions"""
        logger.info("Parsing RBL credit card statement")
        transactions = []

        # Prefer table-based parsing when table has a single column like "Date Description Amount"
        for df in tables:
            if df.empty:
                continue

            if len(df.columns) == 1:
                header = str(df.columns[0]).lower()
                if "date" in header and "description" in header and "amount" in header:
                    for _, row in df.iterrows():
                        row_text = str(row.iloc[0]).strip()
                        if not row_text or row_text.lower() == 'nan':
                            continue

                        parsed = PDFParser._parse_text_transaction_row(row_text)
                        if parsed:
                            transactions.append(parsed)

        if transactions:
            logger.info(f"Extracted {len(transactions)} transactions from RBL tables")
            return transactions

        # Fallback to text-based parsing
        return PDFParser.parse_transactions_text_generic(text, bank_code='RBL')

    @staticmethod
    def parse_hsbc_credit_card(
        text: str,
        statement_period: Optional[Tuple[Optional[datetime], Optional[datetime]]] = None
    ) -> List[Dict]:
        """Parse HSBC credit card statement (DDMMM format without year)."""
        logger.info("Parsing HSBC credit card statement")
        transactions: List[Dict] = []

        if not text:
            return transactions

        skip_keywords = [
            'TOTAL PURCHASE', 'TOTAL CASH', 'TOTAL BALANCE', 'TOTAL LOAN',
            'NET OUTSTANDING', 'GRAND TOTAL', 'OPENING BALANCE', 'CLOSING BALANCE',
            'CUSTOMER NAME', 'CUSTOMER DETAILS', 'USER DETAILS', 'DELIVERY ADDRESS',
            'TAX INVOICE', 'INVOICE NO', 'INVOICE DATE', 'RESTAURANT', 'ORIGINAL FOR',
            'HSN CODE', 'PLACE OF SUPPLY', 'GSTIN', 'FSSAI',
        ]

        start_date = statement_period[0] if statement_period else None
        end_date = statement_period[1] if statement_period else None

        lines = text.split('\n')
        txn_re = re.compile(
            r'^(\d{2})([A-Za-z]{3})\s+(.+?)\s+([\d,]+\.\d{2})\s*(CR)?\s*$',
            re.IGNORECASE,
        )
        seen = set()

        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue

            upper = stripped.upper()
            if any(kw in upper for kw in skip_keywords):
                continue

            m = txn_re.match(stripped)
            if not m:
                continue

            day_str, month_str, description, amount_str, cr_marker = m.groups()
            month_num = PDFParser._month_str_to_number(month_str)
            if not month_num:
                continue

            year = PDFParser._infer_year_for_month(month_num, start_date, end_date)
            try:
                transaction_date = datetime(year, month_num, int(day_str))
            except (ValueError, OverflowError):
                continue

            description = description.strip()
            if not description or not re.search(r'[A-Za-z]', description):
                continue

            amount = PDFParser._parse_amount(amount_str)
            if amount <= 0:
                continue

            transaction_type = 'credit' if cr_marker else 'debit'
            if PDFParser._is_credit_description(description) and not cr_marker:
                transaction_type = 'credit'

            # Keep repeated identical lines: a statement that legitimately lists the same
            # merchant/amount twice in a day represents two real transactions. Genuine
            # cross-statement duplicates are FLAGGED (not dropped) by the DB dedup pass.
            transactions.append({
                'transaction_date': transaction_date,
                'description': description,
                'amount': amount,
                'transaction_type': transaction_type,
                'balance': None,
                'reference_number': None,
                'original_description': description,
            })

        logger.info(f"Extracted {len(transactions)} transactions from HSBC statement")
        return transactions

    @staticmethod
    def parse_sbi_credit_card(
        text: str,
        statement_period: Optional[Tuple[Optional[datetime], Optional[datetime]]] = None
    ) -> List[Dict]:
        """Parse SBI credit card statement transactions"""
        logger.info("Parsing SBI credit card statement")
        transactions = []

        if not text:
            return transactions

        lines = [line.strip() for line in text.split('\n') if line.strip()]
        seen = set()

        def parse_line(line: str) -> Optional[Dict]:
            parsed = PDFParser._parse_sbi_transaction_line(line, statement_period)
            if not parsed:
                return None
            # Do not silently drop repeated identical lines (see note above); the DB
            # dedup pass flags true duplicates for user review instead.
            return parsed

        # Parse within transaction section first
        in_section = False
        for line in lines:
            upper_line = line.upper()
            if 'TRANSACTIONS FOR' in upper_line:
                in_section = True
                continue
            if in_section and (
                'TRANSACTIONS HIGHLIGHTED' in upper_line
                or 'IMPORTANT MESSAGES' in upper_line
                or upper_line.startswith('C=')
            ):
                break

            if in_section:
                parsed = parse_line(line)
                if parsed:
                    transactions.append(parsed)

        # Parse all lines to catch transactions outside the section
        i = 0
        while i < len(lines):
            line = lines[i]
            parsed = parse_line(line)
            if parsed:
                transactions.append(parsed)
                i += 1
                continue

            # Attempt to merge multi-line descriptions
            if re.match(r'^\d{1,2}\s+[A-Za-z]{3}\s+\d{2}\b', line):
                merged = line
                j = i + 1
                while j < len(lines) and j <= i + 2:
                    if re.match(r'^\d{1,2}\s+[A-Za-z]{3}\s+\d{2}\b', lines[j]):
                        break
                    merged = f"{merged} {lines[j]}"
                    parsed = parse_line(merged)
                    if parsed:
                        transactions.append(parsed)
                        break
                    j += 1
            i += 1

        if transactions:
            return transactions

        # Fallback to generic text parsing
        return PDFParser.parse_transactions_text_generic(
            text,
            bank_code='SBI',
            statement_period=statement_period
        )

    @staticmethod
    def parse_transactions_text_generic(
        text: str,
        bank_code: Optional[str] = None,
        statement_period: Optional[Tuple[Optional[datetime], Optional[datetime]]] = None
    ) -> List[Dict]:
        """Parse transactions from raw text using common patterns"""
        logger.info(f"Parsing transactions from text for bank: {bank_code}")
        transactions = []
        seen = set()

        if not text:
            return transactions

        normalized = re.sub(r'\s+', ' ', text).strip()

        patterns = [
            # DD Mon YYYY ... amount [CR/DR]
            r'(\d{2}\s+[A-Za-z]{3}\s+\d{4})\s+(.+?)\s+([\d,]+\.\d{2})\s*(CR|DR)?',
            # DD/MM/YYYY ... amount [CR/DR]
            r'(\d{2}[/-]\d{2}[/-]\d{2,4})\s+(.+?)\s+([\d,]+\.\d{2})\s*(CR|DR)?',
            # DDMMM ... amount [CR/DR]
            r'(\d{2})([A-Za-z]{3})\s+(.+?)\s+([\d,]+\.\d{2})\s*(CR|DR)?'
        ]

        start_date = statement_period[0] if statement_period else None
        end_date = statement_period[1] if statement_period else None

        for pattern in patterns:
            for match in re.finditer(pattern, normalized, re.IGNORECASE):
                try:
                    if len(match.groups()) == 4:
                        date_str, description, amount_str, marker = match.groups()
                        transaction_date = pd.to_datetime(date_str, dayfirst=True)
                    else:
                        day_str, month_str, description, amount_str, marker = match.groups()
                        month_num = PDFParser._month_str_to_number(month_str)
                        if not month_num:
                            continue
                        year = PDFParser._infer_year_for_month(month_num, start_date, end_date)
                        transaction_date = datetime(year, month_num, int(day_str))

                    description = description.strip()
                    if not re.search(r'[A-Za-z]', description):
                        continue
                    if re.match(r'^[\d,\.]+', description):
                        continue

                    amount = PDFParser._parse_amount(amount_str)
                    if amount <= 0:
                        continue

                    marker_norm = (marker or '').strip().upper()
                    transaction_type = PDFParser._infer_transaction_type(description, marker_norm)

                    # Keep repeated identical lines (real repeat purchases); the DB dedup
                    # pass flags genuine cross-statement duplicates rather than dropping.
                    transactions.append({
                        'transaction_date': transaction_date,
                        'description': description,
                        'amount': amount,
                        'transaction_type': transaction_type,
                        'balance': None,
                        'reference_number': None,
                        'original_description': description
                    })
                except Exception as e:
                    logger.debug(f"Error parsing text transaction: {e}")
                    continue

        return transactions
    
    @staticmethod
    def _find_column(columns: List, keywords: List[str]) -> Optional[int]:
        """Find column index by keywords"""
        for i, col in enumerate(columns):
            col_lower = str(col).lower()
            for keyword in keywords:
                if keyword.lower() in col_lower:
                    return i
        return None

    @staticmethod
    def _month_str_to_number(month_str: str) -> Optional[int]:
        if not month_str:
            return None
        month_map = {
            'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
            'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12
        }
        return month_map.get(month_str.strip().lower())

    @staticmethod
    def _infer_year_for_month(
        month: int,
        start_date: Optional[datetime],
        end_date: Optional[datetime]
    ) -> int:
        if start_date and end_date:
            if start_date.year != end_date.year:
                return start_date.year if month >= start_date.month else end_date.year
            return start_date.year
        if end_date:
            return end_date.year
        if start_date:
            return start_date.year
        return datetime.now().year

    @staticmethod
    def _is_credit_description(description: str) -> bool:
        credit_keywords = ['PAYMENT', 'REFUND', 'CASHBACK', 'REVERSAL', 'CREDIT']
        desc_upper = description.upper()
        return any(keyword in desc_upper for keyword in credit_keywords)

    @staticmethod
    def _infer_transaction_type(description: str, marker_norm: str) -> str:
        desc_upper = description.upper()
        if marker_norm == 'CR':
            return 'credit'
        if marker_norm == 'DR':
            return 'debit'
        if marker_norm == 'C':
            return 'credit'
        if marker_norm == 'D':
            return 'debit'
        if 'DEPOSIT' in desc_upper:
            return 'credit'
        if 'WITHDRAW' in desc_upper or 'WITHDRAWAL' in desc_upper:
            return 'debit'
        if 'DEBIT' in desc_upper:
            return 'debit'
        if 'CREDIT' in desc_upper:
            return 'credit'
        if PDFParser._is_credit_description(description):
            return 'credit'
        return 'debit'

    @staticmethod
    def _parse_sbi_transaction_line(
        line: str,
        statement_period: Optional[Tuple[Optional[datetime], Optional[datetime]]] = None
    ) -> Optional[Dict]:
        """Parse SBI transaction line like '16 Jan 26 ... 17,219.58 D'"""
        pattern = r'^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2})\s+(.+?)\s+([\d,]+\.\d{2})\s*([DC])$'
        match = re.search(pattern, line.strip(), re.IGNORECASE)
        if not match:
            return None

        day_str, month_str, year_str, description, amount_str, marker = match.groups()
        month_num = PDFParser._month_str_to_number(month_str)
        if not month_num:
            return None

        year = PDFParser._infer_year_for_two_digit(int(year_str), statement_period)
        try:
            transaction_date = datetime(year, month_num, int(day_str))
        except Exception:
            return None

        description = description.strip()
        if not description or not re.search(r'[A-Za-z]', description):
            return None

        amount = PDFParser._parse_amount(amount_str)
        if amount <= 0:
            return None

        transaction_type = PDFParser._infer_transaction_type(description, marker.upper())

        return {
            'transaction_date': transaction_date,
            'description': description,
            'amount': amount,
            'transaction_type': transaction_type,
            'balance': None,
            'reference_number': None,
            'original_description': description
        }

    @staticmethod
    def _infer_year_for_two_digit(
        year_two_digit: int,
        statement_period: Optional[Tuple[Optional[datetime], Optional[datetime]]] = None
    ) -> int:
        if statement_period:
            start_date, end_date = statement_period
            for candidate in [start_date, end_date]:
                if candidate and candidate.year % 100 == year_two_digit:
                    return candidate.year
        return 2000 + year_two_digit

    @staticmethod
    def _parse_text_transaction_row(row_text: str) -> Optional[Dict]:
        """Parse a single-line transaction row like '26 Dec 2025 PAYMENT RECEIVED 12,748.00'"""
        pattern = r'(\d{2}\s+[A-Za-z]{3}\s+\d{4})\s+(.+?)\s+([\d,]+\.\d{2})\s*(CR|DR)?$'
        match = re.search(pattern, row_text.strip(), re.IGNORECASE)
        if not match:
            return None

        date_str, description, amount_str, marker = match.groups()
        try:
            transaction_date = pd.to_datetime(date_str, dayfirst=True)
        except Exception:
            return None

        description = description.strip()
        if not description:
            return None

        amount = PDFParser._parse_amount(amount_str)
        if amount <= 0:
            return None

        marker_norm = (marker or '').strip().upper()
        transaction_type = PDFParser._infer_transaction_type(description, marker_norm)

        return {
            'transaction_date': transaction_date,
            'description': description,
            'amount': amount,
            'transaction_type': transaction_type,
            'balance': None,
            'reference_number': None,
            'original_description': description
        }
    
    @staticmethod
    def _parse_amount(value) -> float:
        """Parse amount from string"""
        if pd.isna(value) or value is None:
            return 0.0
        try:
            amount_str = str(value).replace(',', '').replace('₹', '').replace('Rs', '').strip()
            is_negative = False
            if amount_str.startswith('-'):
                is_negative = True
                amount_str = amount_str[1:].strip()
            if '(' in amount_str and ')' in amount_str:
                is_negative = True
                amount_str = amount_str.replace('(', '').replace(')', '').strip()
            amount = float(amount_str) if amount_str else 0.0
            return -amount if is_negative else amount
        except Exception:
            return 0.0

    # Page-break / footer text that leaks into a transaction row (e.g. "... Page 1 | 2",
    # "Page 1 of 5", "Continued on next page", carried-forward/brought-forward markers).
    _PAGE_ARTIFACT_RE = re.compile(
        r'(page\s*\d+\s*(?:\||of|/)\s*\d+|continued\s+on|carried\s+forward|brought\s+forward|b/f|c/f)',
        re.IGNORECASE,
    )

    @staticmethod
    def _drop_page_artifacts(transactions: List[Dict]) -> List[Dict]:
        """Clean page-boundary/footer text (e.g. 'Page 1 | 2') that leaked into a
        transaction's description. NON-destructive: strips the marker and keeps the
        transaction; only drops a row if, after stripping, nothing meaningful remains
        (i.e. it was a pure page-footer line, not a real transaction)."""
        cleaned = []
        for t in transactions or []:
            desc = str(t.get('description') or '')
            if not PDFParser._PAGE_ARTIFACT_RE.search(desc):
                cleaned.append(t)
                continue
            stripped = PDFParser._PAGE_ARTIFACT_RE.sub(' ', desc)
            stripped = re.sub(r'\s{2,}', ' ', stripped).strip(' -|/')
            # A row whose description is JUST a page marker and carries no amount is a
            # pure footer line — drop it. Otherwise keep it with the marker removed.
            if not stripped and not t.get('amount'):
                logger.info("Dropping pure page-footer row: %s", desc[:60])
                continue
            new_t = dict(t)
            new_t['description'] = stripped or desc
            cleaned.append(new_t)
        return cleaned

    @staticmethod
    def _infer_ending_balance(transactions: List[Dict]) -> Optional[float]:
        balances = [t.get('balance') for t in transactions if t.get('balance') is not None]
        return balances[-1] if balances else None

    @staticmethod
    def extract_total_amount_due(text: str) -> Optional[float]:
        """Extract a credit-card statement's outstanding (Total Amount Due).

        Credit-card statements print the outstanding as a labelled line rather
        than a per-row running balance, so this is the reliable owed figure. We
        try a set of common Indian-issuer labels and return the first amount as a
        positive float, or None if not found.
        """
        if not text:
            return None
        labels = [
            r'total\s+amount\s+due',
            r'total\s+payment\s+due',
            r'total\s+amount\s+payable',
            r'net\s+outstanding\s+balance',
            r'total\s+dues?',
            r'closing\s+balance',
            r'net\s+amount\s+due',
        ]
        # amount like 1,23,456.78 or 12345.67, optionally prefixed by Rs/INR/₹
        amount_re = r'(?:rs\.?|inr|₹)?\s*([0-9][0-9,]*\.?[0-9]{0,2})'
        for label in labels:
            m = re.search(label + r'\s*[:\-]?\s*' + amount_re, text, re.IGNORECASE)
            if m:
                try:
                    val = float(m.group(1).replace(',', ''))
                    if val > 0:
                        return val
                except (ValueError, AttributeError):
                    continue
        return None

    @staticmethod
    def extract_reward_points(text: str) -> Optional[float]:
        """Extract a credit-card statement's reward/loyalty points closing balance,
        if printed. Best-effort: layouts vary at least as much as Total Amount
        Due (see credit_balance_service.py's docstring), and plenty of statements
        never print this at all -- ai_pdf_extraction.extract_reward_points_ai is
        the fallback for a layout this misses.
        """
        if not text:
            return None
        labels = [
            r'(?:total\s+)?reward\s+points?(?:\s+(?:balance|summary|earned|available|closing))?',
            r'loyalty\s+points?',
            r'bonus\s+points?',
            r'(?:neu|cash)\s*points?(?:\s+balance)?',
        ]
        # Same shape as extract_total_amount_due's amount_re, but reward-point
        # figures are usually whole numbers and never have a currency prefix --
        # instead allow up to 2 stray non-digit characters (a mis-rendered symbol,
        # "Pts", ":" etc.) immediately before the digits, the same failure mode
        # that made Total Amount Due extraction miss HDFC's "C11,537.00".
        number_re = r'[^\d\n]{0,2}\s*([0-9][0-9,]*(?:\.[0-9]+)?)'
        # HDFC (and likely others) print the label followed by a run of column
        # headers before the actual figure appears on its own line, e.g.
        # "Reward Points Opening Balance Earned Disbursed Adjusted/Lapsed\n2,998\n...".
        # The strict number_re above never reaches past those header words, so
        # widen the gap allowance (still digit-free, just longer) for this one
        # label -- it's the only one seen paired with a summary-table header row.
        wide_number_re = r'[^\d]{0,80}([0-9][0-9,]*(?:\.[0-9]+)?)'
        for i, label in enumerate(labels):
            gap = wide_number_re if i == 0 else number_re
            m = re.search(label + r'\s*[:\-]?\s*' + gap, text, re.IGNORECASE)
            if m:
                try:
                    val = float(m.group(1).replace(',', ''))
                    if val >= 0:
                        return val
                except (ValueError, AttributeError):
                    continue
        return None

    @staticmethod
    def extract_reward_points_breakdown(text: str) -> Optional[dict]:
        """Extract this cycle's reward-points activity (opening/earned/redeemed/
        expired), when the issuer prints a per-cycle summary table rather than
        just a closing balance. Confirmed against 4 consecutive real HDFC
        statements: "Reward Points Opening Balance Earned Disbursed
        Adjusted/Lapsed\\n<closing>\\n<opening> <earned> <disbursed> <adjusted>".
        Best-effort/single-layout for now -- returns None (never raises) for any
        statement that doesn't match, same as extract_reward_points.
        """
        if not text:
            return None
        number = r'([0-9][0-9,]*(?:\.[0-9]+)?)'
        m = re.search(
            r'reward\s+points\s+opening\s+balance\s+earned\s+disbursed\s+adjusted\s*/\s*lapsed'
            r'\s*\n\s*[0-9][0-9,]*(?:\.[0-9]+)?'  # closing total, printed first -- extract_reward_points already grabs this
            rf'\s*\n\s*{number}\s+{number}\s+{number}\s+{number}',
            text, re.IGNORECASE,
        )
        if not m:
            return None
        try:
            opening, earned, disbursed, adjusted = (float(g.replace(',', '')) for g in m.groups())
        except (ValueError, AttributeError):
            return None
        return {"opening": opening, "earned": earned, "redeemed": disbursed, "expired": adjusted}

    @staticmethod
    def parse_sc_savings(text: str, statement_period: Optional[Tuple[Optional[datetime], Optional[datetime]]] = None) -> List[Dict]:
        """Parse Standard Chartered savings account statement.

        SC statements use text layout:
          DD MMM YY  DD MMM YY  DESCRIPTION  AMOUNT  BALANCE
        Transactions may span multiple lines. Sub-transactions within a
        date group appear as continuation lines that also end with
        amount + balance.  Credit/debit is inferred from balance changes.
        """
        logger.info("Parsing Standard Chartered savings statement")
        transactions: List[Dict] = []

        if not text:
            return transactions

        lines = text.split('\n')
        date_re = re.compile(
            r'^(\d{2}\s+[A-Za-z]{3}\s+\d{2,4})\s+(\d{2}\s+[A-Za-z]{3}\s+\d{2,4})\s+(.*)',
        )
        two_nums_re = re.compile(r'([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$')
        one_num_re = re.compile(r'([\d,]+\.\d{2})\s*$')

        in_section = False
        prev_balance: Optional[float] = None
        current_date_str: Optional[str] = None
        last_txn_idx: Optional[int] = None

        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue

            upper = stripped.upper()
            if upper.startswith('TOTAL'):
                break

            if not in_section:
                if ('DEPOSIT' in upper or 'WITHDRAWAL' in upper) and 'BALANCE' in upper:
                    in_section = True
                continue

            if upper.startswith('BANK DEPOSITS') or upper.startswith('PLEASE REGISTER') or upper.startswith('REPORT IRREG') or upper.startswith('PAGE '):
                continue

            dm = date_re.match(stripped)
            if dm:
                current_date_str = dm.group(1)
                rest = dm.group(3)
            else:
                rest = stripped

            if 'BALANCE FORWARD' in rest.upper() or 'OPENING BALANCE' in rest.upper():
                m = one_num_re.search(rest)
                if m:
                    prev_balance = float(m.group(1).replace(',', ''))
                continue

            two_m = two_nums_re.search(rest)
            if two_m and current_date_str:
                amount = float(two_m.group(1).replace(',', ''))
                new_balance = float(two_m.group(2).replace(',', ''))
                desc = rest[:two_m.start()].strip()
                desc = re.sub(r'\s+', ' ', desc).strip()

                if prev_balance is not None:
                    transaction_type = 'credit' if new_balance > prev_balance else 'debit'
                else:
                    transaction_type = 'debit'

                try:
                    fmt = '%d %b %y' if len(current_date_str.split()[-1]) <= 2 else '%d %b %Y'
                    transaction_date = datetime.strptime(current_date_str, fmt)
                except Exception:
                    try:
                        transaction_date = pd.to_datetime(current_date_str, dayfirst=True)
                    except Exception:
                        prev_balance = new_balance
                        continue

                transactions.append({
                    'transaction_date': transaction_date,
                    'description': desc if desc else 'Transaction',
                    'amount': amount,
                    'transaction_type': transaction_type,
                    'balance': new_balance,
                    'reference_number': None,
                    'original_description': desc if desc else 'Transaction',
                })
                last_txn_idx = len(transactions) - 1
                prev_balance = new_balance
            else:
                if last_txn_idx is not None and not dm:
                    extra = rest.strip()
                    if extra and not one_num_re.match(extra):
                        existing = transactions[last_txn_idx]['description']
                        if len(existing) < 120:
                            transactions[last_txn_idx]['description'] = f"{existing} {extra}"
                            transactions[last_txn_idx]['original_description'] = transactions[last_txn_idx]['description']

        logger.info(f"Extracted {len(transactions)} transactions from SC statement")
        return transactions

    @staticmethod
    def parse_bob_savings(text: str, statement_period: Optional[Tuple[Optional[datetime], Optional[datetime]]] = None) -> List[Dict]:
        """Parse Bank of Baroda savings account statement.

        BOB text layout (columns):
          DATE | NARRATION | CHQ.NO. | WITHDRAWAL(DR) | DEPOSIT(CR) | BALANCE
        Narration wraps across lines both above and below the date+amount line.
        Uses a two-pass approach: first find anchors (date+amount lines), then
        collect narration text from surrounding non-anchor lines.
        """
        logger.info("Parsing Bank of Baroda savings statement")
        transactions: List[Dict] = []

        if not text:
            return transactions

        lines = text.split('\n')
        date_re = re.compile(r'^(\d{2}-\d{2}-\d{4})\s*(.*)')
        num_re = re.compile(r'([\d,]+\.\d{2})')
        balance_suffix = re.compile(r'([\d,]+\.\d{2})\s*(?:Cr|Dr)\s*$', re.IGNORECASE)

        in_section = False
        section_start = 0
        section_end = len(lines)

        for i, line in enumerate(lines):
            upper = line.strip().upper()
            if not in_section and 'WITHDRAWAL' in upper and 'DEPOSIT' in upper and 'BALANCE' in upper:
                in_section = True
                section_start = i + 1
                continue
            if in_section and (upper.startswith('ABBREVIATIONS') or upper.startswith('NOMINEE')
                              or upper.startswith('BASE BRANCH') or upper.startswith('IMPORTANT')):
                section_end = i
                break

        anchors = []
        for i in range(section_start, section_end):
            stripped = lines[i].strip()
            if not stripped:
                continue
            dm = date_re.match(stripped)
            if not dm:
                continue
            date_str = dm.group(1)
            rest = dm.group(2)
            if balance_suffix.search(rest):
                nums = num_re.findall(rest)
                if len(nums) >= 1:
                    anchors.append({'idx': i, 'date_str': date_str, 'rest': rest, 'nums': nums})

        prev_balance: Optional[float] = None
        for ai, anchor in enumerate(anchors):
            nums = anchor['nums']
            rest = anchor['rest']

            skip = any(kw in rest.upper() for kw in ['OPENING BALANCE', 'CLOSING BALANCE'])
            balance_val = float(nums[-1].replace(',', ''))

            if skip:
                prev_balance = balance_val
                continue

            if len(nums) >= 2:
                amount_val = float(nums[-2].replace(',', ''))
            else:
                if prev_balance is not None:
                    amount_val = abs(balance_val - prev_balance)
                else:
                    continue

            if prev_balance is not None:
                transaction_type = 'credit' if balance_val > prev_balance else 'debit'
            else:
                transaction_type = 'debit'

            prev_anchor_idx = anchors[ai - 1]['idx'] if ai > 0 else section_start - 1
            next_anchor_idx = anchors[ai + 1]['idx'] if ai < len(anchors) - 1 else section_end

            new_narration_re = re.compile(
                r'^(UPI/|IMPS/|NEFT|IN\d{5,}|LB\d{5,}|\d{12,}|SMS\s|[A-Z]{2,}\s)', re.IGNORECASE,
            )
            before_parts = []
            started = False
            for j in range(prev_anchor_idx + 1, anchor['idx']):
                line_text = lines[j].strip()
                if not line_text or balance_suffix.search(line_text):
                    continue
                if not started and not new_narration_re.match(line_text) and len(line_text) < 25:
                    continue
                started = True
                cleaned = re.sub(r'[\d,]+\.\d{2}', '', line_text).strip()
                cleaned = re.sub(r'\b(Cr|Dr)\b', '', cleaned, flags=re.IGNORECASE).strip()
                if cleaned and len(cleaned) > 1:
                    before_parts.append(cleaned)

            inline_desc = re.sub(r'[\d,]+\.\d{2}', '', rest).strip()
            inline_desc = re.sub(r'\b(Cr|Dr)\b', '', inline_desc, flags=re.IGNORECASE).strip()

            after_parts = []
            for j in range(anchor['idx'] + 1, next_anchor_idx):
                line_text = lines[j].strip()
                if not line_text or date_re.match(line_text):
                    continue
                is_new_narration = bool(re.match(
                    r'^(UPI/|IMPS/|NEFT|IN\d{5,}|LB\d{5,}|\d{12,})', line_text, re.IGNORECASE
                ))
                if is_new_narration:
                    break
                cleaned = re.sub(r'[\d,]+\.\d{2}', '', line_text).strip()
                cleaned = re.sub(r'\b(Cr|Dr)\b', '', cleaned, flags=re.IGNORECASE).strip()
                if cleaned and len(cleaned) > 1:
                    after_parts.append(cleaned)

            desc_parts = before_parts
            if inline_desc:
                desc_parts.append(inline_desc)
            desc_parts.extend(after_parts)

            description = ' '.join(desc_parts).strip()
            description = re.sub(r'\s+', ' ', description)

            try:
                transaction_date = datetime.strptime(anchor['date_str'], '%d-%m-%Y')
            except Exception:
                prev_balance = balance_val
                continue

            transactions.append({
                'transaction_date': transaction_date,
                'description': description if description else 'Transaction',
                'amount': amount_val,
                'transaction_type': transaction_type,
                'balance': balance_val,
                'reference_number': None,
                'original_description': description if description else 'Transaction',
            })
            prev_balance = balance_val

        logger.info(f"Extracted {len(transactions)} transactions from BOB statement")
        return transactions

    @staticmethod
    def parse_yes_credit_card(text: str, statement_period: Optional[Tuple[Optional[datetime], Optional[datetime]]] = None) -> List[Dict]:
        """Parse YES Bank credit card statement.

        YES text layout (under 'Statement Details'):
          DD/MM/YYYY  TRANSACTION_DETAILS  MERCHANT_CATEGORY  AMOUNT Dr/Cr
        """
        logger.info("Parsing YES Bank credit card statement")
        transactions: List[Dict] = []

        if not text:
            return transactions

        lines = text.split('\n')
        in_section = False
        txn_re = re.compile(
            r'^(\d{2}/\d{2}/\d{4})\s+(.+?)\s+([\d,]+\.\d{2})\s*(Dr|Cr)\s*$',
            re.IGNORECASE,
        )

        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue

            upper = stripped.upper()
            if 'STATEMENT DETAILS' in upper or ('DATE' in upper and 'TRANSACTION' in upper and 'AMOUNT' in upper):
                in_section = True
                continue

            if not in_section:
                continue

            if upper.startswith('SMS') or upper.startswith('CIN') or upper.startswith('PAGE') or 'YESTOUCHCC' in upper:
                in_section = False
                continue

            m = txn_re.match(stripped)
            if m:
                date_str, description, amount_str, marker = m.groups()
                try:
                    transaction_date = datetime.strptime(date_str, '%d/%m/%Y')
                except Exception:
                    continue

                amount = PDFParser._parse_amount(amount_str)
                if amount <= 0:
                    continue

                description = description.strip()
                description = re.sub(r'\s{2,}', ' | ', description)

                transaction_type = 'credit' if marker.upper() == 'CR' else 'debit'

                transactions.append({
                    'transaction_date': transaction_date,
                    'description': description,
                    'amount': amount,
                    'transaction_type': transaction_type,
                    'balance': None,
                    'reference_number': None,
                    'original_description': description,
                })

        if not transactions:
            return PDFParser.parse_transactions_text_generic(
                text, bank_code='YES', statement_period=statement_period,
            )

        logger.info(f"Extracted {len(transactions)} transactions from YES Bank statement")
        return transactions

    @staticmethod
    def parse_statement(
        pdf_path: str,
        password: Optional[str] = None,
        bank_code: Optional[str] = None,
        field_mapping: Optional[Dict] = None
    ) -> Dict:
        """
        Parse complete bank statement
        
        Args:
            pdf_path: Path to PDF file
            password: PDF password if protected
            bank_code: Bank code for custom parsing
            field_mapping: Custom field mapping
        
        Returns:
            Dictionary with statement data and transactions
        """
        result = {
            'success': False,
            'bank_code': None,
            'statement_period': {'start': None, 'end': None},
            'transactions': [],
            'ending_balance': None,
            'total_amount_due': None,  # credit-card outstanding, when present on the statement
            'error': None
        }
        
        try:
            logger.info(f"Processing PDF: {pdf_path}")
            
            # Extract text
            text = PDFParser.extract_text(pdf_path, password)
            if not text:
                result['error'] = "Could not extract text from PDF"
                return result

            logger.info(f"Extracted {len(text)} characters from PDF")
            # Kept for callers that want an AI-assisted fallback (e.g. credit-card Total
            # Amount Due when regex misses it) without re-extracting/re-decrypting the PDF.
            result['_raw_text'] = text
            
            # Detect bank if not provided
            if not bank_code:
                bank_code = PDFParser.detect_bank(text)
            
            result['bank_code'] = bank_code
            logger.info(f"Detected bank code: {bank_code}")
            
            # Extract statement period
            start_date, end_date = PDFParser.extract_statement_period(text)
            result['statement_period'] = {
                'start': start_date,
                'end': end_date
            }
            
            # Extract tables
            tables = PDFParser.extract_tables(pdf_path, password)
            logger.info(f"Extracted {len(tables)} tables from PDF")
            
            # Parse transactions based on bank
            bc = (bank_code or '').upper()
            if 'HDFC' in bc:
                logger.info("Using HDFC-specific parser")
                transactions = PDFParser.parse_hdfc_credit_card(text, tables)
            elif 'RBL' in bc:
                logger.info("Using RBL-specific parser")
                transactions = PDFParser.parse_rbl_credit_card(text, tables)
            elif 'SBI' in bc:
                logger.info("Using SBI-specific parser")
                transactions = PDFParser.parse_sbi_credit_card(text, (start_date, end_date))
            elif 'HSBC' in bc:
                logger.info("Using HSBC-specific parser")
                transactions = PDFParser.parse_hsbc_credit_card(text, (start_date, end_date))
            elif bc in ('SC', 'SCBANK', 'STANDARD CHARTERED'):
                logger.info("Using Standard Chartered savings parser")
                transactions = PDFParser.parse_sc_savings(text, (start_date, end_date))
            elif bc in ('BOB', 'BANK OF BARODA', 'BARODA'):
                logger.info("Using Bank of Baroda savings parser")
                transactions = PDFParser.parse_bob_savings(text, (start_date, end_date))
            elif bc in ('YES', 'YES BANK'):
                logger.info("Using YES Bank credit card parser")
                transactions = PDFParser.parse_yes_credit_card(text, (start_date, end_date))
            else:
                logger.info("Using generic parser")
                transactions = PDFParser.parse_transactions_generic(tables, bank_code, field_mapping)

            has_dedicated_parser = bc in (
                'HDFC', 'RBL', 'SBI', 'HSBC', 'SC', 'SCBANK',
                'STANDARD CHARTERED', 'BOB', 'BANK OF BARODA', 'BARODA',
                'YES', 'YES BANK',
            )
            if not transactions and not has_dedicated_parser:
                logger.info("No transactions found in tables; trying text-based parsing")
                transactions = PDFParser.parse_transactions_text_generic(
                    text,
                    bank_code=bank_code,
                    statement_period=(start_date, end_date)
                )
            
            transactions = PDFParser._drop_page_artifacts(transactions)
            result['transactions'] = transactions
            result['ending_balance'] = PDFParser._infer_ending_balance(transactions)
            result['total_amount_due'] = PDFParser.extract_total_amount_due(text)
            result['success'] = True
            
            logger.info(f"Successfully parsed {len(transactions)} transactions from PDF")
            
        except Exception as e:
            logger.error(f"Error parsing statement: {e}")
            result['error'] = str(e)
        
        return result
